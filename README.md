<div align="center">

# doubao-search-mcp

> *「你给 Claude Code 换上了国产模型，然后发现它不会上网了」*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-Server-green)](https://modelcontextprotocol.io)
[![Runtime](https://img.shields.io/badge/Runtime-Claude%20Code%20·%20Codex%20·%20Cursor%20·%20任何%20MCP%20client-blueviolet)](#安装)

<br>

**一条命令，让你的 Agent 用上豆包搜索：字节系独家信源、千字级正文摘要、发布时间精确到秒，每月 500 次免费。**

<sub>豆包搜索是火山引擎为 AI Agent 构建的联网信息服务，2026 年 7 月起面向企业和开发者开放。</sub>

<br>

[为什么需要它](#为什么需要它) · [效果](#效果) · [安装](#安装) · [工具参数](#工具参数) · [AI 增强层](#可选ai-增强层)

<br>

[English](#english)

</div>

---

## 为什么需要它

Claude Code 内置的 WebSearch 是 Anthropic 的服务端工具，跑在 Anthropic 的服务器上。一旦你把 `ANTHROPIC_BASE_URL` 指向国产模型的兼容端点（豆包 Seed、Kimi、GLM、DeepSeek……），WebSearch 就没了执行器：工具看着还在，agent 实际上断网了。很多人是切完模型才发现这件事。

海外搜索 API 能补上这个缺口，但对中文开发者有三个现实问题：美元结算（有的还强制绑信用卡）、Google 系索引搜不到中文生态内容、国内直连不稳定。

豆包搜索正好把这三个问题一起解决了，这个 MCP server 把它变成任何 agent 一条命令就能装上的搜索工具。

## 效果

以下是真实返回（工具调用一次的原始输出节选）：

```
共 20 条结果，返回前 10 条：

[1] "一人公司"与"手搓经济"，两个新词寓春意-新华网
来源: 新华网 | 2026-03-19T09:00:22+08:00
URL: http://www.xinhuanet.com/tech/20260319/259b0a6eb28c...
当AI技术高歌猛进，"机器换人"的焦虑如影随形。近期走红的"一人公司"与
"手搓经济"两个新词，则为我们揭示了技术进步的另一面……（千字级正文摘要）
```

几个实测过的细节：

- **千字级正文摘要**，不是两行摘要加一堆蓝链接。别家要「搜索 API + 抓取 API」两跳才能凑齐的链路，它一次返回
- **发布时间精确到秒**，agent 自己就能判断信息新鲜度。实测查行业热点，返回过发布时间是「查询前一晚」的文章
- **字节系独家信源**：今日头条正文高频返回；查「XX 是什么」「XX 是谁」这类实体问题，抖音百科基本排第一
- **每条结果自带正文 token 计数**（`ContentTokenCount`），你可以精确控制塞进上下文的量——这个字段暴露了它确实是为 Agent 设计的
- **跨语言**：英文查询返回官方文档、changelog 这类一手信源，不用中英文各配一个搜索

## 安装

### 第一步：拿一个 API Key

去 [火山引擎豆包搜索控制台](https://console.volcengine.com/search-infinity/web-search-exp) 开通服务并创建 API Key。**每月 500 次搜索免费**，超出按量付费。

### 第二步：加进你的 Agent

**Claude Code**（一条命令）：

```bash
claude mcp add doubao-search \
  -e DOUBAO_SEARCH_API_KEY=你的Key \
  -- npx -y github:alchaincyf/doubao-search-mcp
```

加 `--scope user` 则所有项目可用。

**Cursor / Codex / 其他 MCP client**（配置文件）：

```json
{
  "mcpServers": {
    "doubao-search": {
      "command": "npx",
      "args": ["-y", "github:alchaincyf/doubao-search-mcp"],
      "env": {
        "DOUBAO_SEARCH_API_KEY": "你的Key"
      }
    }
  }
}
```

**最省事的方式**：把这个仓库链接直接丢给你的 agent，说一句：

```
帮我安装这个 MCP：https://github.com/alchaincyf/doubao-search-mcp
```

### 从源码安装

```bash
git clone https://github.com/alchaincyf/doubao-search-mcp.git
cd doubao-search-mcp
npm install && npm run build
claude mcp add doubao-search \
  -e DOUBAO_SEARCH_API_KEY=你的Key \
  -- node /绝对路径/doubao-search-mcp/dist/index.js
```

## 工具参数

装好后 agent 多出一个 `doubao_search` 工具：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `query` | string | — | 搜索词，中英文都行，自然语言效果就很好 |
| `count` | int 1-20 | 10 | 返回条数 |
| `snippet_length` | int 50-2000 | 600 | 每条摘要的最大字符数，深度阅读时调大 |
| `images` | int 0-3 | 0 | 每条结果最多返回几张图（CDN 直链，带宽高） |
| `max_age_days` | int 1-365 | 关 | 时效过滤：剔除 N 天前发布的结果（无时间戳的保留）。纯代码实现，不花钱 |

## 可选：AI 增强层

搜索结果拿回来之后，还可以让一个便宜的小模型再加工一道。这层是**可选项，不是默认行为**，三层开关都在你手里：

1. 不配 `ARK_API_KEY`，这层完全不存在，行为和纯搜索版一模一样，连参数都不会出现在工具里
2. 配了 key，增强能力才注册进来，但每次调用仍然是原始结果直出
3. 只有 agent 显式传 `max_tokens` 参数、或点名调用 `doubao_cross_check` 工具时，AI 加工才真正发生

加工层只做**筛选和压缩**，不做理解和结论——来源名、发布时间、URL 一律保留，判断留给你的主模型。

### 开启方式

在安装命令里多加两个环境变量（[方舟控制台](https://console.volcengine.com/ark) 创建 API Key）：

```bash
claude mcp add doubao-search \
  -e DOUBAO_SEARCH_API_KEY=你的搜索Key \
  -e ARK_API_KEY=你的方舟Key \
  -- npx -y github:alchaincyf/doubao-search-mcp
```

默认用 `doubao-seed-2-0-lite-260215`（Seed 2.0 Lite，输入 0.6 元/百万 token，一次加工的成本约等于零），可用 `ARK_MODEL` 换模型、`ARK_BASE_URL` 换端点。

### 能力一：token 预算器（`doubao_search` 的 `max_tokens` 参数）

搜索 API 每条结果自带 `ContentTokenCount`，这个参数把它用起来：传 `max_tokens: 800`，10 条千字级结果就被压缩筛选到约 800 token 再进你的上下文——不相关的剔掉，留下的每条保留来源、时间、URL 和原文关键句。搜索工具最常见的翻车是「一次返回撑爆上下文」，这个参数就是给上下文预算装的阀门。AI 加工失败时自动降级为原始结果，搜索永远不会因为加工层挂掉。

### 能力二：多信源交叉核查（`doubao_cross_check` 工具）

给一个问题或一句待核实的说法，它在一次调用里完成：从不同角度生成 3-4 路搜索词（事实本身/最新进展/官方口径/相反说法）→ 并行搜索、按 URL 去重 → 逐信源比对，输出结构化报告：**核查结论、信源共识、信源分歧（各方说法+发布时间）、信源清单、时效提示**。硬规则是只用搜到的内容、不引入模型自己的知识，信源不够就明说无法确认。

这是个重工具（多路搜索 + 两次 LLM 调用，几十秒），适合核实传闻、信源打架的突发新闻、任何值得多方求证的事实。日常搜索请继续用 `doubao_search`。

## 背后的故事

我天天泡在 Claude Code 里干活，也经常把国产模型接进来当主力。撞到搜索断网这堵墙之后查了一圈，现有方案对中文开发者各有各的别扭：美元结算、中文内容搜不到、国内连接不稳。

正好豆包搜索在 7 月对开发者开放了。我开通后先自己测了一轮：返回结构里那个 token 计数字段让我确认这个 API 值得包一层 MCP——它不是把「给人看的搜索结果」转给 agent，是从设计上就在替 agent 的上下文预算着想。于是有了这个仓库。

## 关于作者

**花叔 Huashu** — AI Native Coder，独立开发者，代表作：小猫补光灯（AppStore 付费榜 Top1）

| 平台 | 链接 |
|------|------|
| 🌐 官网 | [bookai.top](https://bookai.top) · [huasheng.ai](https://www.huasheng.ai) |
| 𝕏 Twitter | [@AlchainHust](https://x.com/AlchainHust) |
| 📺 B站 | [花叔v](https://space.bilibili.com/14097567) |
| ▶️ YouTube | [@Alchain](https://www.youtube.com/@Alchain) |
| 📕 小红书 | [花叔](https://www.xiaohongshu.com/user/profile/5abc6f17e8ac2b109179dfdf) |
| 💬 公众号 | 微信搜「花叔」或扫码关注 ↓ |

<img src="wechat-qrcode.jpg" alt="公众号二维码" width="360">

## 许可证

MIT — 随便用，随便改，随便造。

---

<div align="center">
<sub>作者的其他项目 · also by 花叔</sub>

[![FanBox · Coding Agent 的驾驶舱](https://raw.githubusercontent.com/alchaincyf/fanbox/master/assets/promo-banner.jpg)](https://github.com/alchaincyf/fanbox)

[女娲.skill — 蒸馏任何人的思维方式](https://github.com/alchaincyf/nuwa-skill) · [达尔文.skill — 让 Skill 无限进化](https://github.com/alchaincyf/darwin-skill) · [huashu-design — HTML 原生设计 skill](https://github.com/alchaincyf/huashu-design)

</div>

---

## English

> *"You switched Claude Code to a Chinese LLM — and it can't browse the web anymore."*

Claude Code's built-in WebSearch is an Anthropic **server-side** tool. Point `ANTHROPIC_BASE_URL` at any Anthropic-compatible endpoint (Doubao Seed, Kimi, GLM, DeepSeek...) and your agent silently goes offline.

**doubao-search-mcp** plugs that gap with [Doubao Search](https://console.volcengine.com/search-infinity/web-search-exp) — the search API Volcengine built for AI agents, now open to developers with **500 free searches/month**:

- **Long-form snippets** (up to 2000 chars of article body per result) — consumable directly, no second crawl needed
- **Publish time down to the second** + source name on every result
- **Exclusive ByteDance sources**: Toutiao articles, Douyin Baike (top-ranked for entity lookups)
- **Cross-language**: English queries return first-party sources (official docs, changelogs)
- **`ContentTokenCount` per result** — budget your context window precisely

Install (Claude Code):

```bash
claude mcp add doubao-search \
  -e DOUBAO_SEARCH_API_KEY=your-key \
  -- npx -y github:alchaincyf/doubao-search-mcp
```

Or add the JSON config above to any MCP client. Tool: `doubao_search(query, count, snippet_length, images, max_age_days)`.

**Optional AI layer** (strictly opt-in — without `ARK_API_KEY` the server behaves exactly like the plain version): set `ARK_API_KEY` (Volcengine Ark) to unlock a `max_tokens` context-budget compressor on `doubao_search` (filter + compress only, sources/URLs/timestamps preserved, no conclusions added) and a `doubao_cross_check` tool (fans out 3-4 query angles, dedupes sources, returns a structured report: verdict / consensus / discrepancies / source list / freshness caveat). Powered by Doubao Seed 2.0 Lite by default (`ARK_MODEL` to override).

MIT License © [花叔 Huashu](https://github.com/alchaincyf)
