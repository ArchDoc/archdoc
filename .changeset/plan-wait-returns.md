---
"@archdoc/analyzers": patch
"@archdoc/mcp": patch
---

`archdoc_plan` `wait` returns at once when the person has already marked the plan ready, instead of waiting out its timeout, and a wait through MCP (plans and Triage) holds a call at most 50 seconds, under the minute MCP clients give a tool call, then says to wait again.
