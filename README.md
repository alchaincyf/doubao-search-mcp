# doubao-search-mcp

MCP server for [Doubao Search](https://console.volcengine.com/search-infinity/web-search-exp) (豆包搜索) — the web search API built for AI agents, now open to developers with **500 free searches/month**.

Give your Claude Code / Cursor / any MCP client real web search, backed by ByteDance-exclusive Chinese sources (今日头条 Toutiao, 抖音百科 Douyin Baike) plus the open web, with publish timestamps and traceable source URLs on every result.

## Why

Claude Code's built-in WebSearch is an Anthropic server-side tool. The moment you switch the model to a Chinese LLM via an Anthropic-compatible endpoint (Doubao Seed, Kimi, GLM, DeepSeek...), WebSearch stops working — your agent goes offline. This MCP server plugs that gap, and its Chinese-content quality is a step up from overseas search APIs even if you don't switch models.

What the API actually returns (all verified by hand):

- **Long-form snippets** (up to 2000 chars of article body per result), ready for direct LLM consumption — not blue links you have to re-crawl
- **Publish time down to the second** + source name on every result, so the agent can judge freshness and authority
- **Exclusive ByteDance sources**: Toutiao articles, Douyin Baike (top-ranked for entity/concept lookups)
- **Cross-language**: English queries return first-party sources (official docs, changelogs, blogs)
- **Images as CDN URLs** with dimensions, opt-in per query

## Install

### 1. Get an API key

Go to [Doubao Search on Volcengine](https://console.volcengine.com/search-infinity/web-search-exp), activate the service, and create an API key. 500 searches/month are free; pay-as-you-go beyond that.

### 2. Add to Claude Code

```bash
claude mcp add doubao-search \
  -e DOUBAO_SEARCH_API_KEY=your-key-here \
  -- npx -y github:alchaincyf/doubao-search-mcp
```

Add `--scope user` to enable it in every project.

### 3. Or any other MCP client (Cursor, Codex, etc.)

```json
{
  "mcpServers": {
    "doubao-search": {
      "command": "npx",
      "args": ["-y", "github:alchaincyf/doubao-search-mcp"],
      "env": {
        "DOUBAO_SEARCH_API_KEY": "your-key-here"
      }
    }
  }
}
```

### From source

```bash
git clone https://github.com/alchaincyf/doubao-search-mcp.git
cd doubao-search-mcp
npm install && npm run build
claude mcp add doubao-search \
  -e DOUBAO_SEARCH_API_KEY=your-key-here \
  -- node /path/to/doubao-search-mcp/dist/index.js
```

## Tool

`doubao_search`

| Param | Type | Default | Description |
|---|---|---|---|
| `query` | string | — | Search query, Chinese or English; natural language works |
| `count` | int 1-20 | 10 | Number of results |
| `snippet_length` | int 50-2000 | 600 | Max chars per snippet; raise for deep reading |
| `images` | int 0-3 | 0 | Max images per result (CDN URLs) |

Example result entry:

```
[1] "一人公司"与"手搓经济"，两个新词寓春意-新华网
来源: 新华网 | 2026-03-19T09:00:22+08:00
URL: http://www.xinhuanet.com/tech/20260319/...
<article body snippet, up to snippet_length chars>
```

## 中文说明

豆包搜索是火山引擎面向AI Agent的联网信息服务，现已向企业和开发者开放，每月免费500次。这个MCP server把它接进Claude Code、Cursor等任何支持MCP的agent：

- 把Claude Code模型换成国产模型后WebSearch会失效（那是Anthropic的服务端工具），装上本server即可补上联网能力
- 返回千字级正文摘要（不是链接列表）、精确到秒的发布时间、可追溯信源，字节系独家内容（今日头条、抖音百科）
- 安装方式见上：一条 `claude mcp add` 命令即可

## License

MIT
