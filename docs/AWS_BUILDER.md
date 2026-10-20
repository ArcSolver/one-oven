# AWS Builder notes

This page lists what One Oven uses from the AWS side and what it does not. Status as of 2026-10-20.

**Short version:** the agent host is built on Strands Agents (TypeScript SDK 1.21.0), and every
text, voice and simulator conversation goes through it. No AWS service has been called from this
repository. Bedrock is a selectable provider that is **not validated**.

## Strands Agents: used

| Where | What it does |
| --- | --- |
| [`packages/agent/src/session.ts`](../packages/agent/src/session.ts) | `new Agent(...)` with the MCP client and host timer tools; `BeforeModelCallEvent` injects host context (last plan ID, version, device, clock) and, in voice mode, an `AfterToolsEvent` hook ends the turn with the tool's validated `say` |
| [`packages/agent/src/mcp.ts`](../packages/agent/src/mcp.ts) | `OneOvenMcpClient extends McpClient`, connected over `StreamableHTTPClientTransport` to the local MCP server. It overrides `listTools` (hides host-owned retry fields from the model) and `callTool` (keeps `structuredContent`, see [F-12](friction/entries/F-12-strands-structured-content.md)) |
| [`packages/agent/src/host-tools.ts`](../packages/agent/src/host-tools.ts) | `tool(...)` definitions for `set_timer`, `cancel_timer` and `list_timers`, which run in the host, not on the MCP server |
| [`packages/agent/src/models.ts`](../packages/agent/src/models.ts) | One `AGENT_MODEL` value picks `OpenAIModel`, `AnthropicModel`, `BedrockModel` or the scripted test model |
| [`packages/simulator/src/host/`](../packages/simulator/src/host/) | The web simulator opens the same Strands session as the text gateway |

Measured results through this Strands path, all with a local OpenAI-compatible model, are in the
Korean stage reports:
[S2](ko/results/RESULT_S2.md) (text, 4/5 trials),
[S3](ko/results/RESULT_S3.md) (voice-mode latency A/B), and
[S4](ko/results/RESULT_S4.md) (19/20 scenario trials, 4/4 voice runs).
The optimized voice path (this hook, host-applied timers and a trimmed context) cut the 20-turn p50
from 6.52 s to 2.46 s in the S3 measurement
([LATENCY_AB.json](results/s3/LATENCY_AB.json)).

## AWS services: not called

| Service | State in the code | Real calls |
| --- | --- | --- |
| Amazon Bedrock | `BedrockModel` is constructed when `AGENT_MODEL=bedrock:<model-or-inference-profile-id>`; `AWS_REGION` selects the region. A request handler records `x-amzn-requestid` headers. Tests construct the object only ([`core.test.ts`](../packages/agent/test/core.test.ts)) | 0. **Not validated** |
| Amazon Polly | `PollyTts` adapter with `@aws-sdk/client-polly` 3.1152.0; tested with an injected mock client. It refuses to send unless `allowAws: true` | 0 |
| Amazon Transcribe | `TranscribeStt` adapter with `@aws-sdk/client-transcribe-streaming` 3.1152.0; mock-tested only, with the same `allowAws` guard | 0 |

The live runners refuse Bedrock and non-local endpoints on purpose
([`e2e-text.ts`](../packages/agent/scripts/e2e-text.ts), [`run.ts`](../packages/scenarios/scripts/run.ts)).
No AWS account was used, so there are no Bedrock request IDs, latencies or error reports to share.
No default cloud model ID is embedded in the code or in `.env.example`.

## To validate Bedrock

1. Set `AGENT_MODEL=bedrock:<id>` and `AWS_REGION` with AWS credentials the AWS SDK can find.
2. Run `npm run chat` against `npm run dev` for one weekday meal and keep the trace, which records request IDs.
3. Add an explicit Bedrock option to the scenario runner and run the same 4 × 5 trials as the local model.

Until those steps have run, any statement about Bedrock behavior in this project is unverified.
