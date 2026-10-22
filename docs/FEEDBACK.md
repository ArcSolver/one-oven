# Product feedback

Feedback on the tools One Oven was built with. Incidents that met the
friction-log bar are also in the [friction log](friction/FRICTION_LOG.md); requests are collected in [FEATURE_REQUESTS.md](FEATURE_REQUESTS.md).

## MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.1)

Used for the server (`McpServer`, `StreamableHTTPServerTransport`) and for the plain MCP client in the
smoke test and scenario runner.

- **Worked:** Streamable HTTP with JSON responses, protocol 2025-11-25 negotiation, Host checks,
  resources with templates. The smoke test asserts the negotiated version
  ([`packages/server/scripts/smoke.ts`](../packages/server/scripts/smoke.ts)).
- **Friction:** the SDK's default input-validation errors did not match our tool error contract, where
  every failure must carry a speakable `say`, an `error_code` and `retryable`. We registered a handler on
  the low-level server (`server.server.setRequestHandler(CallToolRequestSchema, ...)`) and run our own
  Zod validation and error envelope there
  ([`packages/server/src/mcp/tools.ts`](../packages/server/src/mcp/tools.ts) line 51;
  [S1 report, Korean](ko/results/RESULT_S1.md), design changes, item 5).
- **Observation:** Strands 1.21.0 declares `@modelcontextprotocol/client` ^2 as a peer dependency, so
  npm installed 2.3.1 next to the v1 package our server and transport use. The mix worked over HTTP, but we only learned about it by reading
  the installed `dist/` ([S2 report, Korean](ko/results/RESULT_S2.md), section 1).
- **Suggestion:** a documented option on the high-level tool registration to format input-validation
  failures as a normal `isError` result with custom structured content.

## Strands Agents, TypeScript SDK (`@strands-agents/sdk` 1.21.0)

Used for the agent loop, the MCP client and the model providers; see [AWS_BUILDER.md](AWS_BUILDER.md).

- **Worked:** native OpenAI, Anthropic and Bedrock providers exist, so no custom model adapter was needed
  ([S2-0 spike, Korean](ko/results/S2_SPIKE.md)). `McpClient` accepted the MCP SDK's
  `StreamableHTTPClientTransport` directly.
- **Worked:** the public `AfterToolsEvent.endTurn` hook let voice mode speak the tool's validated `say`
  instead of asking the model to rephrase it. Together with host-applied timers and a trimmed context,
  this optimized voice path cut model requests per 20-turn flow from 54 to 20 and the turn p50 from
  6.52 s to 2.45 s ([LATENCY_AB.json](results/s3/LATENCY_AB.json),
  [S3 report, Korean](ko/results/RESULT_S3.md)).
- **Friction ([F-12](friction/entries/F-12-strands-structured-content.md)):** `McpTool.stream` forwards only
  `content` and drops `structuredContent`, so the model never saw the `kitchen_id` it needed for the next
  call. We override the public `McpClient.callTool` and append the structured result as a JSON text block
  ([`packages/agent/src/mcp.ts`](../packages/agent/src/mcp.ts)). Still present in 1.21.0.
- **Friction:** in the first live evaluation the model filled optional host-owned fields (`request_id`,
  `based_on_version: 1`), and `set_kitchen` failed with `version_conflict` in all five trials. A `listTools`
  override now removes those fields from the model-facing schema and allows null for unused optionals
  ([`mcp.ts`](../packages/agent/src/mcp.ts), [INITIAL_FAILURES.json](results/s2/INITIAL_FAILURES.json)).
- **Suggestion:** map `structuredContent` into the tool result the model receives, and document a
  supported way to transform an MCP tool's input schema before it is shown to the model.

## whisper.cpp (v1.8.2, `base.en`)

Used for local speech recognition, as a warm `whisper-server` on loopback or one CLI process per clip
([packages/voice](../packages/voice/README.md)).

- **Worked:** the warm HTTP server and the CLI both passed the 12-clip round trip
  ([ROUNDTRIP_BASE.json](results/s3/ROUNDTRIP_BASE.json), [ROUNDTRIP_CLI.json](results/s3/ROUNDTRIP_CLI.json)).
  One shared list of cooking words as the prompt hint was enough.
- **Recognition:** with an en-us synthetic voice `base.en` got 6/12 (“burners” → “burgers”,
  “green beans” → “marine beans”); an en-gb voice plus the shared hints reached 12/12
  ([ROUNDTRIP_EN_US_FAILURE.json](results/s3/ROUNDTRIP_EN_US_FAILURE.json)).
- **Friction:** a macOS build made inside a Git worktree was not relocatable. After moving `build/`, the
  binaries' `LC_RPATH` entries still pointed at the old absolute path; we rewrote them with
  `install_name_tool -rpath` and re-signed with `codesign --force --sign -`. `CMakeCache.txt` also keeps
  the old source path, so rebuilding in place fails.
- **Suggestion:** state in the build docs that the build tree embeds absolute paths, and show how to
  produce a copy that can be moved.

## Alexa+ developer documentation

We read the Alexa+ add-on docs and the hackathon rules and FAQ.

- **Worked:** the conversation-surface guide is clear that Alexa phrases replies from returned data:
  “You influence Alexa’s response through the data you return, not by scripting it directly.” We kept every
  tool result speakable (`say`, at most two sentences and 30 words), enforced by the speech lint in
  [packages/contracts](../packages/contracts).
- **Worked:** the rules allow a simulated experience (“Optionally, developers can simulate the Alexa+
  experience in a web app using their own agentic tools.”), which is the path this project took
  ([packages/simulator](../packages/simulator/README.md)).
- **Friction ([F-09](friction/entries/F-09-alexa-timer-handoff-contract.md)):** we found no documented way for
  an add-on to hand a cooking timer to Alexa's built-in timers. Our results already carry
  `timer_suggestions` with label, minutes, absolute end time and a spoken line, but the host has to emulate
  the timers.
- **Friction ([F-05](friction/entries/F-05-no-participant-simulator-access.md)):**
  the docs home says “At this time, Category SDK and MCP Toolkit are available to select partners only,”
  and the hackathon FAQ says participants do not get the official toolkit, CLI or web simulator. We could
  not test how Alexa+ would call our six tools, so we built our own simulator.
- **Suggestion:** see [FEATURE_REQUESTS.md](FEATURE_REQUESTS.md), items 1 and 2.
