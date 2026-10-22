# AWS Builder notes

The agent host is built on Strands Agents (TypeScript SDK 1.21.0), and every text, voice and
simulator conversation goes through it. Our runs used a local OpenAI-compatible model through
Strands; no AWS service was called.

## Strands Agents: used

| Where | What it does |
| --- | --- |
| [`packages/agent/src/session.ts`](../packages/agent/src/session.ts) | `new Agent(...)` with the MCP client and host timer tools; `BeforeModelCallEvent` injects host context (last plan ID, version, device, clock) and, in voice mode, an `AfterToolsEvent` hook ends the turn with the tool's validated `say` |
| [`packages/agent/src/mcp.ts`](../packages/agent/src/mcp.ts) | `OneOvenMcpClient extends McpClient`, connected over `StreamableHTTPClientTransport` to the local MCP server. It overrides `listTools` (hides host-owned retry fields from the model) and `callTool` (keeps `structuredContent`, see [F-12](friction/entries/F-12-strands-structured-content.md)) |
| [`packages/agent/src/host-tools.ts`](../packages/agent/src/host-tools.ts) | `tool(...)` definitions for `set_timer`, `cancel_timer` and `list_timers`, which run in the host, not on the MCP server |
| [`packages/agent/src/models.ts`](../packages/agent/src/models.ts) | One `AGENT_MODEL` value picks `OpenAIModel`, `AnthropicModel`, `BedrockModel` or the scripted model |
| [`packages/simulator/src/host/`](../packages/simulator/src/host/) | The web simulator opens the same Strands session as the text gateway |

Measured results through this Strands path are in the Korean stage reports:
[S2](ko/results/RESULT_S2.md) (text, 4/5 trials),
[S3](ko/results/RESULT_S3.md) (voice-mode latency A/B), and
[S4](ko/results/RESULT_S4.md) (19/20 scenario trials, 4/4 voice runs).
The optimized voice path (this hook, host-applied timers and a trimmed context) cut the 20-turn p50
from 6.52 s to 2.45 s ([LATENCY_AB.json](results/s3/LATENCY_AB.json)).
