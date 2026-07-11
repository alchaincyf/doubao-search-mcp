#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = "https://open.feedcoopapi.com/search_api/global_search";

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

const server = new McpServer({
  name: "doubao-search",
  version: "0.1.0",
});

server.registerTool(
  "doubao_search",
  {
    title: "豆包搜索",
    description:
      "Web search via Doubao Search (豆包搜索), the search API built for AI agents. " +
      "Strong on Chinese content (exclusive ByteDance sources: Toutiao 今日头条, Douyin Baike 抖音百科), " +
      "cross-language (English queries return first-party sources), fresh results with publish timestamps " +
      "and traceable source URLs. Snippets are long-form text ready for direct consumption. " +
      "Use for: fact-checking, recent news/events, research on Chinese internet topics, entity lookups.",
    inputSchema: {
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
    },
  },
  async ({ query, count, snippet_length, images }) => {
    const apiKey = process.env.DOUBAO_SEARCH_API_KEY;
    if (!apiKey) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              "Error: DOUBAO_SEARCH_API_KEY is not set. " +
              "Get a key at https://console.volcengine.com/search-infinity/web-search-exp (500 free searches/month), " +
              "then set it in the MCP server env.",
          },
        ],
        isError: true,
      };
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        doc_count: count,
        max_snippet_length: snippet_length,
        max_image_count_per_doc: images,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        content: [
          {
            type: "text" as const,
            text: `Doubao Search API error (HTTP ${res.status}): ${body.slice(0, 500)}`,
          },
        ],
        isError: true,
      };
    }

    const data = (await res.json()) as {
      Result?: { TotalDocCount?: number; Documents?: SearchDocument[] };
    };
    const docs = data.Result?.Documents ?? [];
    if (docs.length === 0) {
      return { content: [{ type: "text" as const, text: `No results for: ${query}` }] };
    }

    const header = `共 ${data.Result?.TotalDocCount ?? docs.length} 条结果，返回前 ${docs.length} 条：`;
    const body = docs.map(formatDocument).join("\n\n---\n\n");
    return { content: [{ type: "text" as const, text: `${header}\n\n${body}` }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
