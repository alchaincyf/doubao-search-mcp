#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = "https://open.feedcoopapi.com/search_api/global_search";

// AI 增强层（可选）：配置 ARK_API_KEY 后解锁，不配则是纯搜索，行为与 0.1.x 完全一致
const ARK_API_KEY = process.env.ARK_API_KEY;
const ARK_BASE_URL = process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3";
const ARK_MODEL = process.env.ARK_MODEL ?? "doubao-seed-2-0-lite-260215";

interface SnippetPart {
  Type: string;
  Text?: string;
  Image?: { Width: number; Height: number; ImageUrl: string };
}

interface SearchDocument {
  Rank: number;
  Url: string;
  Title: string;
  Snippet: SnippetPart[];
  DocumentInfo?: {
    ContentCharCount?: number;
    ContentTokenCount?: number;
    Filetype?: string;
    PublishTime?: string;
  };
  HostInfo?: { Hostname?: string };
}

function formatDocument(doc: SearchDocument): string {
  const lines: string[] = [];
  const host = doc.HostInfo?.Hostname ?? "";
  const time = doc.DocumentInfo?.PublishTime ?? "";
  const meta = [host, time].filter(Boolean).join(" | ");
  lines.push(`[${doc.Rank + 1}] ${doc.Title}`);
  if (meta) lines.push(`来源: ${meta}`);
  lines.push(`URL: ${doc.Url}`);
  const texts: string[] = [];
  const images: string[] = [];
  for (const part of doc.Snippet ?? []) {
    if (part.Type === "text" && part.Text) texts.push(part.Text.trim());
    if (part.Type === "image" && part.Image?.ImageUrl) images.push(part.Image.ImageUrl);
  }
  if (texts.length) lines.push(texts.join("\n"));
  for (const img of images) lines.push(`图片: ${img}`);
  return lines.join("\n");
}

async function searchDoubao(params: {
  query: string;
  count: number;
  snippet_length: number;
  images: number;
}): Promise<SearchDocument[]> {
  const apiKey = process.env.DOUBAO_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error(
      "DOUBAO_SEARCH_API_KEY is not set. " +
        "Get a key at https://console.volcengine.com/search-infinity/web-search-exp (500 free searches/month), " +
        "then set it in the MCP server env."
    );
  }
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: params.query,
      doc_count: params.count,
      max_snippet_length: params.snippet_length,
      max_image_count_per_doc: params.images,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Doubao Search API error (HTTP ${res.status}): ${body.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    Result?: { TotalDocCount?: number; Documents?: SearchDocument[] };
  };
  return data.Result?.Documents ?? [];
}

async function callArk(
  system: string,
  user: string,
  maxTokens: number
): Promise<{ text: string; truncated: boolean }> {
  const res = await fetch(`${ARK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ARK_API_KEY}`,
    },
    body: JSON.stringify({
      model: ARK_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
      thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ark API error (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const choice = data.choices?.[0];
  const text = choice?.message?.content;
  if (!text) throw new Error("Ark API returned empty content");
  return { text, truncated: choice?.finish_reason === "length" };
}

// PublishTime 见过两种格式："2026-07-10 20:00:00" 和 ISO 带时区；无时间戳的结果保留不过滤
function filterByAge(docs: SearchDocument[], maxAgeDays: number): { kept: SearchDocument[]; dropped: number } {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const kept: SearchDocument[] = [];
  let dropped = 0;
  for (const doc of docs) {
    const raw = doc.DocumentInfo?.PublishTime?.trim();
    if (raw) {
      const t = new Date(raw.includes("T") ? raw : raw.replace(" ", "T")).getTime();
      if (!Number.isNaN(t) && t < cutoff) {
        dropped++;
        continue;
      }
    }
    kept.push(doc);
  }
  return { kept, dropped };
}

const COMPRESS_SYSTEM = `你是搜索结果压缩器。只做筛选和压缩，不做推断、不下结论、不添加搜索结果之外的任何信息。
规则：
1. 剔除与查询无关或高度重复的结果，其余全部保留；
2. 保留的每条结果必须带：来源名、发布时间、URL；关键事实句尽量用原文，含图片URL的也保留；
3. 各结果之间用 --- 分隔，保持编号，按相关性从高到低排列；
4. 输出总长度必须明显短于用户给出的 token 预算：预算不够时直接整条舍弃排在后面的结果，绝不写半条、绝不写到被截断，优先压缩正文、绝不牺牲来源信息。`;

const server = new McpServer({
  name: "doubao-search",
  version: "0.2.0",
});

const searchInputSchema: Record<string, z.ZodTypeAny> = {
  query: z.string().describe("Search query, Chinese or English. Natural language works well."),
  count: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe("Number of results to return (1-20, default 10)"),
  snippet_length: z
    .number()
    .int()
    .min(50)
    .max(2000)
    .default(600)
    .describe("Max characters per result snippet (default 600; raise for deep reading)"),
  images: z
    .number()
    .int()
    .min(0)
    .max(3)
    .default(0)
    .describe("Max images per result, returned as CDN URLs (default 0)"),
  max_age_days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe(
      "Freshness filter: drop results published more than N days ago (results without a timestamp are kept). Omit to disable."
    ),
};

if (ARK_API_KEY) {
  searchInputSchema.max_tokens = z
    .number()
    .int()
    .min(200)
    .max(8000)
    .optional()
    .describe(
      "Context budget: AI-compress results to fit within ~N tokens (filter + compress only, sources/URLs/timestamps preserved, no conclusions added). Costs one cheap LLM call. Omit for raw results."
    );
}

server.registerTool(
  "doubao_search",
  {
    title: "豆包搜索",
    description:
      "Web search via Doubao Search (豆包搜索), the search API built for AI agents. " +
      "Strong on Chinese content (exclusive ByteDance sources: Toutiao 今日头条, Douyin Baike 抖音百科), " +
      "cross-language (English queries return first-party sources), fresh results with publish timestamps " +
      "and traceable source URLs. Snippets are long-form text ready for direct consumption. " +
      "Use for: fact-checking, recent news/events, research on Chinese internet topics, entity lookups." +
      (ARK_API_KEY
        ? " Optional AI layer available: pass max_tokens to compress results into a context budget."
        : ""),
    inputSchema: searchInputSchema,
  },
  async (args) => {
    const { query, count, snippet_length, images, max_age_days, max_tokens } = args as {
      query: string;
      count: number;
      snippet_length: number;
      images: number;
      max_age_days?: number;
      max_tokens?: number;
    };
    let docs: SearchDocument[];
    try {
      docs = await searchDoubao({ query, count, snippet_length, images });
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
    if (docs.length === 0) {
      return { content: [{ type: "text" as const, text: `No results for: ${query}` }] };
    }

    const notes: string[] = [];
    if (max_age_days !== undefined) {
      const { kept, dropped } = filterByAge(docs, max_age_days);
      docs = kept;
      if (dropped > 0) notes.push(`时效过滤: 已剔除 ${dropped} 条 ${max_age_days} 天前的结果`);
      if (docs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No results within ${max_age_days} days for: ${query}（更早的结果有 ${dropped} 条，去掉 max_age_days 可见）`,
            },
          ],
        };
      }
    }

    const body = docs.map(formatDocument).join("\n\n---\n\n");

    if (max_tokens !== undefined && ARK_API_KEY) {
      try {
        // 输出上限给 15% 余量；仍被截断时回退到最后一个完整结果，不留半条
        const result = await callArk(
          COMPRESS_SYSTEM,
          `查询: ${query}\ntoken 预算: ${max_tokens}\n\n搜索结果:\n\n${body}`,
          Math.ceil(max_tokens * 1.15)
        );
        let compressed = result.text;
        if (result.truncated) {
          const cut = compressed.lastIndexOf("\n---");
          if (cut > 0) compressed = compressed.slice(0, cut).trimEnd();
        }
        const header = [`共 ${docs.length} 条结果，已由 ${ARK_MODEL} 压缩至约 ${max_tokens} token 预算内`, ...notes].join("；");
        return {
          content: [
            {
              type: "text" as const,
              text: `${header}\n\n${compressed}\n\n（以上为 AI 压缩摘要，只做筛选压缩不做结论；需完整原文请不带 max_tokens 重搜）`,
            },
          ],
        };
      } catch (err) {
        notes.push(`AI 压缩失败已降级为原始结果: ${(err as Error).message}`);
      }
    }

    const header = [`共返回 ${docs.length} 条结果`, ...notes].join("；");
    return { content: [{ type: "text" as const, text: `${header}：\n\n${body}` }] };
  }
);

// —— 以下增强工具仅在配置 ARK_API_KEY 后注册 ——

const QUERY_GEN_SYSTEM = `你是搜索策划。针对给出的事实性问题或待核查说法，生成 3-4 个不同角度的搜索词（与问题同语言），用于多信源交叉核查。角度参考：事实本身、最新进展、官方口径或权威信源、质疑或相反说法。只输出 JSON 字符串数组，不要输出任何其他内容。`;

const CROSS_CHECK_SYSTEM = `你是信源交叉核查员。基于提供的多路搜索结果（每条带来源名、发布时间、URL），核查用户的问题或说法。
硬规则：只使用提供的搜索结果，不引入任何外部知识；每条结论标注支持它的信源；信源不足以判断时明确写"现有信源无法确认"。
输出 Markdown，结构如下：
## 核查结论
（一两句话：当前信源能支持什么、不能支持什么）
## 信源共识
（各信源一致的事实，每条末尾标注 [信源: 名称1, 名称2]）
## 信源分歧
（信源间冲突的细节，逐条列出各方说法+来源名+发布时间；没有则写"未发现明显分歧"）
## 信源清单
（来源名 | 发布时间 | URL，一行一条）
## 时效提示
（信息截至最新一条结果的发布时间；提示无法排除后续反转或辟谣）`;

function parseQueryArray(text: string, fallback: string): string[] {
  try {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1) throw new Error("no array");
    const arr = JSON.parse(text.slice(start, end + 1));
    const queries = (arr as unknown[]).filter((q): q is string => typeof q === "string" && q.trim().length > 0);
    if (queries.length === 0) throw new Error("empty array");
    return queries.slice(0, 4);
  } catch {
    return [fallback];
  }
}

if (ARK_API_KEY) {
  server.registerTool(
    "doubao_cross_check",
    {
      title: "豆包搜索·多信源交叉核查",
      description:
        "Multi-source cross-check via Doubao Search + AI. Fans out 3-4 search queries from different angles " +
        "(the fact itself, latest developments, official/authoritative sources, opposing claims), then compares " +
        "sources against each other and returns a structured report: verdict, consensus, discrepancies (with each " +
        "source's version + timestamp), source list, and freshness caveat. Strictly grounded in search results — " +
        "no outside knowledge added. Heavier than doubao_search (multiple searches + 2 LLM calls); " +
        "use for: verifying claims/rumors, breaking news where sources conflict, any fact worth double-checking.",
      inputSchema: {
        question: z
          .string()
          .describe("The factual question or claim to cross-check, e.g. '某航班舷窗破裂事件的原因和目的地' or a rumor to verify"),
        queries: z
          .array(z.string())
          .min(1)
          .max(4)
          .optional()
          .describe("Optional: bring your own search queries (skips AI query planning)"),
        count: z
          .number()
          .int()
          .min(3)
          .max(10)
          .default(6)
          .describe("Results per search query (default 6)"),
      },
    },
    async ({ question, queries, count }) => {
      try {
        const searchQueries =
          queries && queries.length > 0
            ? queries
            : parseQueryArray((await callArk(QUERY_GEN_SYSTEM, question, 500)).text, question);

        const resultsPerQuery = await Promise.all(
          searchQueries.map((q) =>
            searchDoubao({ query: q, count, snippet_length: 800, images: 0 }).catch(() => [] as SearchDocument[])
          )
        );

        const seen = new Set<string>();
        const merged: SearchDocument[] = [];
        for (const docs of resultsPerQuery) {
          for (const doc of docs) {
            if (doc.Url && seen.has(doc.Url)) continue;
            if (doc.Url) seen.add(doc.Url);
            merged.push({ ...doc, Rank: merged.length });
          }
        }
        if (merged.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No results for any query. 搜索词: ${searchQueries.join(" / ")}`,
              },
            ],
          };
        }

        const corpus = merged.map(formatDocument).join("\n\n---\n\n");
        const report = await callArk(
          CROSS_CHECK_SYSTEM,
          `待核查问题/说法: ${question}\n\n多路搜索结果（搜索词: ${searchQueries.join(" / ")}）:\n\n${corpus}`,
          4000
        );
        const footer = `——\n交叉核查元信息: ${searchQueries.length} 路搜索（${searchQueries.join(" / ")}），去重后 ${merged.length} 条信源，核查模型 ${ARK_MODEL}`;
        return { content: [{ type: "text" as const, text: `${report.text}\n\n${footer}` }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
