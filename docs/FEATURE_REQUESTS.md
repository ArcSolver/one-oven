# Feature requests

Requests that come out of the [friction log](friction/FRICTION_LOG.md) and [FEEDBACK.md](FEEDBACK.md).
Priority: **Critical** blocks part of the intended experience, **Important** needs a workaround we had to
build, **Nice to have** costs time but has an easy workaround.

## 1. Alexa+: a timer handoff contract for add-ons (Critical)

From [F-09](friction/entries/F-09-alexa-timer-handoff-contract.md).

Cooking runs on timers. Every One Oven plan result already returns `timer_suggestions`
with `step_id`, `label`, `minutes`, an absolute `ends_at` and a spoken line, but we found no documented
way for an add-on to ask Alexa to create those as built-in timers. Today the host emulates them
(`HostTimers` in [`packages/agent/src/host-tools.ts`](../packages/agent/src/host-tools.ts)), and the video
has to label that part as simulated.

Request:
- A documented tool-result field (for example in `_meta`) that Alexa may turn into built-in timers after
  the customer confirms, with label, duration and absolute end time.
- A defined way to replace or cancel a suggested timer when the plan changes. After a delay only the
  late dish's steps change, so the add-on needs to say which timer an update refers to.
- A statement of whether timer completion is reported back to the add-on. One Oven does not need it to
  advance a step (steps are confirmed by the cook), but the answer changes how hosts should be built.

## 2. Alexa+: test access for hackathon participants (Important)

From [F-05](friction/entries/F-05-no-participant-simulator-access.md).

We could not run the six tools against the real Alexa+ host, its web simulator or the MCP Toolkit, so
we built our own simulator. A sandboxed web simulator for participants, or a published reference trace of
how Alexa+ calls an MCP add-on (discovery, the order of `tools/call` requests, and how `content` and
`structuredContent` are used), would let builders test against the real calling pattern.

## 3. Strands Agents: pass `structuredContent` to the model (Important)

From [F-12](friction/entries/F-12-strands-structured-content.md).

`McpTool.stream` in the TypeScript SDK 1.21.0 keeps only `content`. IDs that a later tool call needs
(`kitchen_id`, `plan_id`) live in `structuredContent`, so the model cannot chain calls without our
`callTool` override in [`packages/agent/src/mcp.ts`](../packages/agent/src/mcp.ts). Request: map
`structuredContent` into a JSON block in the tool result, with a regression test that uses an ID in a
second call.

## 4. Strands Agents: a supported hook to shape the model-facing tool schema (Nice to have)

From [FEEDBACK.md](FEEDBACK.md#strands-agents-typescript-sdk-strands-agentssdk-1210).

Our server accepts host-owned retry fields (`request_id`, `based_on_version`). When the model saw them it
filled them in and the first live evaluation failed 0/5. We hide them by overriding `listTools`. A
documented way to filter or rewrite an MCP tool's input schema before it reaches the model would make
that override unnecessary.

## 5. MCP TypeScript SDK: custom input-validation errors on high-level tools (Nice to have)

From [FEEDBACK.md](FEEDBACK.md#mcp-typescript-sdk-modelcontextprotocolsdk-1321).

Our tool errors must be speakable (`say`, `error_code`, `retryable`). We replaced the default handling with
a low-level `CallToolRequestSchema` handler. An option on high-level tool registration to format validation
failures as an `isError` result with custom structured content would remove that step.

## 6. whisper.cpp: document how to move a build (Nice to have)

From [FEEDBACK.md](FEEDBACK.md#whispercpp-v182-baseen).

A macOS build kept absolute `LC_RPATH` entries and a source path in `CMakeCache.txt`, so moving it needed
`install_name_tool` and re-signing. A note in the build docs, and a recipe for a copy that can be moved,
would help projects that keep the build under a project-local tools directory.
