# Friction log

External-product blocks of 15 minutes or more, and documentation/behavior mismatches, found while
building One Oven. Severity: critical = blocked, high = workaround over an hour,
medium = easy workaround, low = minor.

## Entries, by severity

| ID | Severity | Product | Summary | Status |
| --- | --- | --- | --- | --- |
| [F-05](entries/F-05-no-participant-simulator-access.md) | high | Alexa+ docs, hackathon FAQ | Participants have no access to the official MCP Toolkit, CLI or web simulator | Worked around with our own simulator |
| [F-09](entries/F-09-alexa-timer-handoff-contract.md) | medium | Alexa+ add-on docs | No documented way to hand an add-on's timers to Alexa's built-in timers | Host emulates timers |
| [F-12](entries/F-12-strands-structured-content.md) | medium | Strands TypeScript SDK 1.21.0 | `McpTool.stream` drops `structuredContent` before the model sees it | Public `callTool` override in place |

Tool-by-tool feedback is in [docs/FEEDBACK.md](../FEEDBACK.md). Requests are in [docs/FEATURE_REQUESTS.md](../FEATURE_REQUESTS.md).
