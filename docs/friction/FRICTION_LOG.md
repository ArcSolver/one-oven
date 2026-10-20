# Friction log

External-product friction found while building One Oven. Internal code bugs are not entries.
Record external-product blocks lasting 15+ minutes or documentation/behavior mismatches with
`npm run friction:new -- "Title"`. Severity: critical = blocked, high = workaround over an hour,
medium = easy workaround, low = minor. Each entry keeps its evidence and time lost.

## Verified entries, by severity

| ID | Severity | Product | Summary | Status |
| --- | --- | --- | --- | --- |
| [F-05](entries/F-05-no-participant-simulator-access.md) | high | Alexa+ docs, hackathon FAQ | Participants have no access to the official MCP Toolkit, CLI or web simulator | Worked around with our own simulator |
| [F-09](entries/F-09-alexa-timer-handoff-contract.md) | medium | Alexa+ add-on docs | No documented way to hand an add-on's timers to Alexa's built-in timers | Host emulates timers; video labels them simulated |
| [F-12](entries/F-12-strands-structured-content.md) | medium | Strands TypeScript SDK 1.21.0 | `McpTool.stream` drops `structuredContent` before the model sees it | Public `callTool` override in place |

Tool-by-tool feedback, including observations that did not meet this bar, is in
[docs/FEEDBACK.md](../FEEDBACK.md). Requests are in [docs/FEATURE_REQUESTS.md](../FEATURE_REQUESTS.md).

## Reserved seed IDs from DESIGN.md

Rows marked **Verified** have an entry above. The others are unverified leads.

| ID | Topic | Evidence to collect |
| --- | --- | --- |
| F-01 | Lifecycle protocol example | Reopen original documentation |
| F-02 | Elicitation capability | Reopen original documentation |
| F-03 | Tasks support | Reopen original documentation |
| F-04 | Household member metadata | Reopen original documentation |
| F-05 | Official simulator availability | **Verified**, see entry |
| F-06 | Display tokens and scaling | S7 render comparison |
| F-07 | 401 authentication discovery | S5 test trace and both standards |
| F-08 | Client preregistration | S5 documentation review |
| F-09 | Native timer handoff | **Verified** in S4, see entry |
| F-10 | Strands TS model providers | Resolved in S2: providers exist, no incident |
| F-11 | Participant credits | Reopen Rules |

New incidents start at F-12 to preserve these references. Unverified seed rows are leads,
not claims of work attempted or time lost in this repository.

## S2 findings

- [F-12: Structured MCP results disappear before reaching the model](entries/F-12-strands-structured-content.md): reproduced on Strands TS 1.21.0; public adapter preserves the ID chain.
- F-10 provider seed resolved by [S2-0](../ko/results/S2_SPIKE.md): native OpenAI and Anthropic providers exist; no provider blocker.

## S3 findings

- F-12 remains reproducible in the pinned SDK; the public adapter stays in place.
  Voice mode now consumes validated `say` through the public `AfterToolsEvent.endTurn`
  hook and keeps compact host state, so it avoids repeating the full structured
  plan through additional model/timer round trips. See
  [S3 measurements](../ko/results/RESULT_S3.md) and [A/B evidence](../results/s3/LATENCY_AB.json).
- No new F number in S3: no newly verified documentation mismatch or external
  blocker lasting 15 minutes. Local synthetic speech experiments are preserved
  as measured limitations, not attributed to an unsupported product defect:
  [en-us recognition failures](../results/s3/ROUNDTRIP_EN_US_FAILURE.json),
  [tiny.en experiment](../results/s3/ROUNDTRIP_TINY_EXPERIMENT.json).
  A common vocabulary hint list and en-gb system voice passed the 12-clip base.en
  check. The initial scripted completion mismatch is an internal harness issue,
  retained in the S3 result, not an external-product friction entry.
- Polly/Transcribe are mock-validated only; this stage supplies no evidence of
  real AWS speech integration, latency, account onboarding, or service errors.

## S4 findings

- [F-09: No documented contract for handing an add-on's timers to Alexa's built-in timers](entries/F-09-alexa-timer-handoff-contract.md):
  the seed is now backed by a quotation from the conversation-surface guide. The scenarios keep the
  host-side timer emulation and the video labels it as simulated.
- The same guide says Alexa phrases replies from returned data ("You influence Alexa’s response through
  the data you return, not by scripting it directly"). This is a constraint, not a defect: the generated
  video script states that its Alexa lines are emulator output and may be worded differently on a device.
- No new F number for local speech recognition: espeak voices through Whisper base.en dropped "has one"
  after the wake word and misheard "turkey step" and "gravy". These are local synthetic-voice limits,
  handled by choosing natural phrasings that pass ("I'm done with the {subject}") and by adding catalog
  dish names to the one shared hint list. The S3 12-clip round trip still passes 12/12.
- The scenario runner exposed an internal product gap, not an external one: two steps due in the same
  minute started one at a time, and the second "What's next?" was absorbed by the 20-second retry
  guard. Fixed in the server (commit 761de2b) and covered by `packages/server/test/speech.test.ts`.

## Simulator stage findings (2026-10-18 to 2026-10-20)

- [F-05: No participant access to the official Alexa+ simulator or MCP Toolkit](entries/F-05-no-participant-simulator-access.md):
  the seed is now backed by the docs home and the FAQ. `packages/simulator` is the workaround, and every
  frame carries the "Simulated Alexa+ experience" label.
- F-12 is still worked around in the simulator, which opens the same Strands session as the gateway.
- No new F number for the whisper.cpp macOS build that could not be moved after it was built (absolute
  `LC_RPATH`, stale `CMakeCache.txt`). The binaries were fixed with `install_name_tool` and re-signed, but the
  time spent was not recorded. It is described in [FEEDBACK.md](../FEEDBACK.md).
- Seed rows F-01 to F-04, F-06 to F-08 and F-11 were not investigated in this repository and remain leads only.
