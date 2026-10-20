# @one-oven/scenarios

Four YAML scenarios that are both the regression suite and the demo video script.
The same file runs in four modes; each turn is judged by server state, not wording.

| Scenario | Device | What it proves |
| --- | --- | --- |
| `weekday-3` | show | Backward plan to 6:30 PM with oven preheat, cooked to completion |
| `salmon-delay` | dot | Mid-roast delay moves only the salmon; a repeated request is deduplicated |
| `swap` | show | Side dish replaced before cooking; same plan ID, version +1, still 6:30 PM |
| `thanksgiving-8` | show | Eight dishes, one oven, two cooks; preheat, temperature change, sides share the oven while the turkey rests, no warnings |

## Modes

| Mode | Path under test | In `npm run check` |
| --- | --- | --- |
| engine | Service through the MCP tool dispatcher | yes |
| mcp | MCP SDK client → Streamable HTTP → server | yes |
| agent | Strands Agent → McpClient → HTTP server; scripted model by default | yes (scripted) |
| agent `--live` | Same, with the local OpenAI-compatible model | `npm run e2e:live` |
| voice | espeak user WAV → local Whisper → agent → system TTS files; host timers announce | `npm run e2e:voice` |

The server runs in-process on a simulated clock injected into the service. The HTTP app is the
production app; it has no clock route. Simulated time only moves between turns.

The scripted model is primed with each beat's expected tool calls. It still travels the full
Strands → MCP → HTTP path, and it refuses to act when the utterance (after speech recognition in
voice mode) lacks the beat's intent words. It proves plumbing and state, not language understanding;
live runs cover that.

## Beat fields

`at` (local HH:MM) or `advance_to` (`next_event`, `timer`, `{ minutes }`) moves the clock. `user` is the
spoken line. `expect.tools` is an ordered, partial match; `$kitchen` and `$plan` refer to IDs returned
earlier. `expect.state` checks the stored plan; `reply_includes` is strict except in live runs, where
wording differences are reported but do not fail. `repeat` keeps saying "I'm done with the {subject}"
(or `user_idle`) for the step that just ended until `all_done`, `{ running }` or `{ at }`. `video` marks the
beat for the script.

## Commands

```sh
npm run e2e:scenarios                      # engine, mcp, agent (scripted); part of check
AGENT_MODEL=openai:<id> OPENAI_BASE_URL=http://127.0.0.1:10100/v1 npm run e2e:live   # 4 x 5, needs 4/5
WHISPER_SERVER_URL=http://127.0.0.1:18080 npm run e2e:voice   # add --live to use the model above
npm run video:script                       # docs/submission/VIDEO_SCRIPT.md and .srt from passing runs
```

Options: `--scenario a,b`, `--mode engine,mcp,agent,voice`, `--runs N`, `--required N`, `--speed N` (voice idle time).
Video takes: `--device show,finish=dot` runs on another device class and switches before a beat (the scenario
file keeps its own device for regression runs); `--tag name` is appended to the run directory.
Each `scenario_turn` records `request_now` (the server clock used for the 20-second repeat window), and every JSONL
record carries `mono_ms` and `wall_iso` so a screen recording can be aligned with a `sync_marker` (`:mark` in the CLIs).
Artifacts: `runs/scenarios/<scenario>/<timestamp>-<mode>/{report.md, report.json, transcript.md, trace.jsonl, timings.csv}`.
Live runs accept only the local endpoint; voice runs refuse Polly and Transcribe in this stage.
