# S2-0: 경로 A 결정

2026-10-15. npm registry의 최신 `@strands-agents/sdk@1.21.0`을 설치했다.

- `dist/src/models/openai/index.d.ts`: `OpenAIModel`; `types.d.ts`의
  `OpenAIModelOptions`는 `api: 'chat'`, `clientConfig.baseURL`을 지원한다.
- `dist/src/models/anthropic.d.ts`: `AnthropicModel`.
- `dist/src/models/model.d.ts`: 공개 abstract `Model`, `stream(messages, options)`,
  `getConfig()`, `updateConfig()`. scripted 공급자는 이 계약을 구현한다.
- `dist/src/mcp/client.d.ts`: `McpClient`, `McpTransport`가 legacy MCP SDK transport도
  명시적으로 수용한다. SDK 내부 MCP client는 v2 패키지지만 서버/transport는 v1이다.
- `scripts/spike.ts`에서 `StreamableHTTPClientTransport`를 넘겨 실제 localhost 서버에
  initialize → tools/list → tools/call을 실행했다. 협상 버전 2025-11-25, 툴 6개.
- native OpenAI 공급자가 있어 B의 custom API 구현은 불필요하다. HTTP/Model이 열려 있으므로 C도 불필요하다.

재현: `npm run spike -w @one-oven/agent` (모델 요청 없음).

```text
initialize: 2025-11-25
tools/list: set_kitchen, list_dishes, plan_meal, next_step, report_delay, swap_dish
Public exports: Agent, BedrockModel, OpenAIModel, AnthropicModel, abstract Model
Raw structuredContent present: true
McpTool converted result: {"toolResult":{"toolUseId":"spike","status":"success","content":[{"text":"Your kitchen has 1 oven, with capacity 4 pans respectively."}]}}
Decision: A — native TypeScript providers and Streamable HTTP work. No cloud/model requests.
```

`McpTool.stream()`은 content만 옮기고 structuredContent를 버린다. ID 체인 보존을 위한
작은 `McpClient.callTool()` override가 필요하다. F-12에 기록했다. 공급자 경로 결정과는 무관하다.

공식 문서 확인: [MCP transports](https://strandsagents.com/docs/user-guide/sdk/tools/mcp-transports/),
[TypeScript SDK](https://github.com/strands-agents/sdk-typescript).
설계의 F-10(공급자 부족 가능성)은 이번 버전에서는 장애가 아니므로 신규 사고로 만들지 않는다.
