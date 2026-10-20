# One Oven

**When cooking runs late, One Oven fixes only what changed.**
At 6:20 PM the salmon needs five more minutes: the salmon steps move, dinner moves from 6:30 to
6:35 PM, and the rice and green beans keep their times.

One Oven plans a home meal backward from dinner time, accounts for oven heating and pan capacity,
and repairs the schedule when one dish runs late. It is an MCP server built for the Alexa+ track of
the Amazon Developer Hackathon, shown through our own web simulator. It is not an official Alexa product.
Spoken output is English; the intended audience is adult home cooks.

## Try it

Node.js 22.13 or newer. No account, API key or cloud service is needed.

```sh
npm ci
npm run build
npm run sim        # then open http://127.0.0.1:5180/
```

Type into the dock, or hold to talk once local Whisper is installed (`npm run voice:setup`, see
[packages/voice](packages/voice/README.md)). Text input works without Whisper. The default model is the
scripted fixture `scripted:weekday-3`, so start with the weekday phrases: “My kitchen has one oven,
four burners, and one cook”, then “I want salmon, rice and green beans on the table at 6:30 PM.”
`npm run check` runs the full deterministic verification.

## What actually works

Each item below was run in this repository; the linked reports hold the numbers and conditions.

- **MCP server**: six tools over Streamable HTTP, protocol version 2025-11-25 negotiated in the smoke
  test and the scenario runner. Plans are computed only on the server and stored in SQLite with a
  version history, retry keys and an independent plan verifier.
- **Delay repair**: in the salmon-delay scenario only `salmon:1` and `salmon:2` change, dinner moves to
  6:35 PM, and repeating the same sentence is deduplicated instead of adding five more minutes.
- **`npm run check`** (last run 2026-10-20): build, recipe validation, 79 unit and integration tests,
  HTTP smoke, scripted text E2E, and 4 YAML scenarios × engine, MCP and agent modes (12/12).
  The tests include 1,000 seeded random kitchen, delay and swap cases checked by the verifier.
- **Strands host**: a real Strands `Agent` and `McpClient` drive the server over HTTP, in text, local
  voice and the web simulator.
- **Live local model**: 19/20 scenario trials (4 scenarios × 5) and 4/4 voice runs with local Whisper
  and synthetic espeak speech ([S4 report, Korean](docs/ko/results/RESULT_S4.md)). Voice-mode latency is
  measured in the [S3 report, Korean](docs/ko/results/RESULT_S3.md).
- **Web simulator**: a screen device (Now card, Run of Show) and a voice-only speaker mode. On a delay
  only the changed bars animate; a Playwright test checks from the sync log that every other bar kept its
  rectangle ([simulator README](packages/simulator/README.md)).

## Architecture

```text
browser UI ──loopback──> simulator host ──> Strands Agent (packages/agent)
  text / mic WAV          Whisper STT          │  OneOvenMcpClient
  speech playback  <───── system TTS           ▼  Streamable HTTP, MCP 2025-11-25
                                          MCP server (packages/server)
                                          deterministic engine + SQLite
```

`packages/contracts` holds the shared Zod schemas and speech lint, `packages/voice` the local speech
pipeline and host timers, and `packages/scenarios` the four YAML scenarios that serve as both the
regression suite and the demo script. The browser never calls MCP and never computes a schedule;
everything on screen comes from `structuredContent` of real tool results.

## What is simulated and what is not done

- **Simulated Alexa+ experience.** The simulator frame says “Simulated Alexa+ experience · our web
  simulator”. No Alexa+ device, account, add-on registration or OAuth was used. Alexa's built-in timers are
  emulated by the host because we found no documented handoff ([F-09](docs/friction/entries/F-09-alexa-timer-handoff-contract.md)).
- **Models.** Without a `.env`, `AGENT_MODEL` defaults to `scripted:weekday-3`, a deterministic test fixture and
  not a language model. The live trials above used a local OpenAI-compatible endpoint with the model
  `local-openai-compatible`, selected through `AGENT_MODEL`. Anthropic and Bedrock are selectable Strands providers
  but were never called; see [AWS_BUILDER.md](docs/AWS_BUILDER.md).
- **Not done yet**: a take with a human voice (all recorded speech so far is synthetic), the
  [human-voice check](docs/ko/calibration/VOICE_MANUAL_S3.md), a real kitchen calibration (recipes are timing
  fixtures, not kitchen-tested), Bedrock validation, OAuth and a public deployment.

Product feedback per tool is in [docs/FEEDBACK.md](docs/FEEDBACK.md), external friction in the
[friction log](docs/friction/FRICTION_LOG.md), and requests in [docs/FEATURE_REQUESTS.md](docs/FEATURE_REQUESTS.md).
Earlier Korean stage reports are under [docs/ko](docs/ko/README.md).

## Reference

The sections below document each part in detail.

## Run the MCP server and checks

Node.js **22.13+** with `node:sqlite` and npm; S1–S3 verified with Node **24.21.0**.
No account, API key, paid service or cloud deployment is needed.

```sh
npm ci
npm run check             # build, recipes, tests, HTTP smoke, scripted text E2E, 4 scenarios x 3 modes
npm run dev               # http://127.0.0.1:3000/mcp
# Or: npm run build && npm start
```

`PORT` defaults to 3000. `DB_PATH` defaults to `data/one-oven.sqlite` under the
original command directory, including when npm changes to the server workspace.
Set environment variables in the shell or the ignored root `.env`. Root `dev`,
`start`, `chat`, `gateway` and `e2e:live` commands load `.env` when present. The server binds to loopback,
checks Host and Origin, and currently uses the fixed household `local`.

The workspaces are `packages/contracts` (Zod schemas, types, speech lint) and
`packages/server` (engine, recipes, SQLite, service, MCP, tests), and
`packages/agent` (Strands models, MCP client, sessions, timers, text gateway). JSON recipes and
SQL migrations are copied into the production build.

## Text host (S2)

```sh
npm run e2e:text                 # always scripted; starts its own local HTTP MCP server
npm run dev                     # terminal 1: MCP server
npm run chat                    # terminal 2: Strands REPL, defaults to scripted:weekday-3
npm run gateway                 # optional: http://127.0.0.1:3001
```

The scripted model is a narrow CI fixture. Start with “My kitchen has one oven,
four burners, and one cook”, then “I want salmon, rice and green beans on the
table at 6:30 PM.” Use “What's next?” and confirm the named step when done.
For natural conversation select the local development model in `.env`:

```dotenv
AGENT_MODEL=openai:<model-id-returned-by-v1-models>
OPENAI_BASE_URL=http://127.0.0.1:10100/v1
```

Inspect `http://127.0.0.1:10100/v1/models` for an available ID and replace the
placeholder. A loopback endpoint without authentication uses a dummy key; real
credentials belong only in `.env`. `npm run e2e:text:live` explicitly runs **five**
complete weekday trials against that local endpoint, including a five-minute
salmon delay and a repeated request. It writes `runs/s2-*/report.json` and per-trial
`trace.jsonl`. All recipe and oven actions must finish, dinner must remain at
6:35 PM, other dishes must stay unchanged during the delay, and raw/final speech
must both pass lint. A failed trial is retained; at least four of five must pass.
The S2 live runner rejects Bedrock and nonlocal URLs.

Once credentials and settings are prepared, change **only `AGENT_MODEL`** to
`anthropic:<model-id>` or `bedrock:<model-or-inference-profile-id>` to select the
native Strands provider. `AWS_REGION` selects the Bedrock region. S2 tests only
construct the Bedrock object; **actual Bedrock validation belongs to S6**.
No default cloud model ID is embedded in application code.

For simulated time set `ENABLE_DEV_CLOCK=1` and an offset timestamp such as
`SIM_CLOCK_START=2026-10-15T17:05:00-05:00` in both server and host environments.
The normal server has no `/dev/clock` route. The opted-in route checks loopback
and Origin and allows only nonnegative advances. REPL commands are `:dot`,
`:show`, `:advance 10`, and `:quit`. No clock control is added to the six MCP tools.

The session uses real Strands `Agent` and `McpClient` calls. The S2-0 decision was
**A**, using native TypeScript providers. A public client adapter preserves
`structuredContent` for the model ([F-12](docs/friction/entries/F-12-strands-structured-content.md)).
The model-facing schemas omit host-managed retry/version fields and permit null
for unused optional values; the client removes only optional nulls before MCP
validation. Server schemas and the six-tool contract stay intact. Last plan ID,
current state, device and clock are injected as host context on every model call.

`set_timer`, `cancel_timer`, and `list_timers` are host tools. They are not MCP
server tools. Live agents choose timers from suggestions; `HOST_AUTO_TIMERS=1`
lets deterministic hosts install/update suggestions once per step/end time.
S3 adds timer expiry callbacks, an original chime and local speech output.

The loopback gateway accepts `POST /session/:id/turn` with JSON
`{"utterance":"What's next?"}`. `Accept: application/json` returns a `TurnResult`;
`Accept: text/event-stream` sends `start`, heartbeat comments, and a `turn` event
(or an `error` event). Speech is released only after lint, not as unchecked token
deltas. Delete `/session/:id` to close a session. Concurrent turns on one session
return 409; at most 32 sessions are retained. Conversation/timer state is per
session, while the S2 MCP server still uses the shared `local` household.
OAuth and household selection remain S5 work.

Traces include negotiated MCP version, tool discovery, utterances, raw model
speech, lint/fallback flags, normalized tool arguments, raw MCP results, model
usage and latency, and request IDs when the transport supplies them. Bedrock
request IDs are captured from response headers by its configured HTTP handler;
none were obtained in S2 because no AWS request was made. Trace files contain
local conversation data, are ignored by Git, and must be reviewed before sharing.
The output guard falls back to a valid tool `say`; live grading still fails a raw
lint violation rather than hiding it. Automatic mutation retries are disabled.

See [S2 spike](docs/ko/results/S2_SPIKE.md) and [S2 results](docs/ko/results/RESULT_S2.md)
for the exact versions, trials, traces and known limits.

## Voice host (S3)

`packages/voice` provides local whisper.cpp STT, system TTS, terminal push-to-talk,
and host timer sounds with simulated time. No UI or paid speech service is needed.
See [voice setup and acceptance commands](packages/voice/README.md). `npm run check`
includes the voice adapter/queue/timer tests without downloading speech models.
After local speech setup, run `npm run voice:check` for real WAV recognition and
the unattended 60× cooking replay. `npm run voice` uses the microphone.

The optimized path keeps Strands/MCP and speaks validated server `say` directly,
removing the extra model reply and timer-tool round trips. Local real-model A/B
measurement reduced 20-turn p50 from 6.52s to 2.45s and p95 from 8.88s to 3.10s;
see [S3 results](docs/ko/results/RESULT_S3.md) for sample sizes, full voice timing,
failed experiments and hardware measurement limits. No AWS request was made.

## Scenarios and demo script (S4)

`packages/scenarios` holds four YAML scenarios (weekday dinner, mid-roast salmon delay,
side-dish swap, eight-dish Thanksgiving) that are both the regression suite and the demo
video script. One runner executes them through the service, a plain MCP client, the Strands
agent, or the local voice pipeline, and judges each turn by stored plan state.

```sh
npm run e2e:scenarios     # engine + MCP + scripted agent; part of check
npm run e2e:live          # live local model, 4 scenarios x 5 trials, 4/5 required each
npm run e2e:voice         # espeak -> Whisper -> agent -> TTS files; needs WHISPER_SERVER_URL
npm run video:script      # docs/submission/VIDEO_SCRIPT.md and .srt from the best passing runs
```

See the [scenarios README](packages/scenarios/README.md) and [S4 results](docs/ko/results/RESULT_S4.md).

## Web simulator

`npm run sim` starts the MCP server, the Strands host and the browser UI together at http://127.0.0.1:5180/ (`/?film=1` is the 1600×704 recording frame).
Type or hold to talk: speech goes through local Whisper, replies play through the same TTS, and the Run of Show and tool calls come only from real MCP results.
Each take writes `runs/sim-*/sync.jsonl` with monotonic turn timestamps and drawn bar coordinates; see the [simulator README](packages/simulator/README.md).

## MCP interface

The official TypeScript SDK serves Streamable HTTP with JSON responses at
`/mcp`. Smoke checks initialization and headers for **2025-11-25**. There are
exactly six tools, each with a description of at most two sentences.

| Tool | Inputs | Output |
| --- | --- | --- |
| `set_kitchen` | `ovens`, `burners`, `helpers`, required IANA `timezone`, optional `oven_profiles` | Kitchen ID and filled profiles |
| `list_dishes` | Optional `course`, `max_minutes` | Eight dish IDs, durations, temperature, units, hold limit, tags |
| `plan_meal` | `dish_ids`, `serve_at`, `kitchen_id` | Plan ID, version, first action, oven segments, warnings |
| `next_step` | `plan_id`, optional `done_step_id` or `start_step_id` | Next action, upcoming actions, changes, timers |
| `report_delay` | `plan_id`, `dish_id`, `minutes` (1–180) | New serving time, exact changes, up to two recipe change summaries |
| `swap_dish` | `plan_id`, `dish_id`, `replacement_id` | Same plan ID, incremented version, changed/removed steps |

`helpers` counts all cooks, including you. Each partial oven profile defaults to
`capacity_units: 4`, `preheat_f_per_min: 25`, `cool_f_per_min: 10`, `ambient_f: 70`.
Profiles match oven indices; omitted entries receive defaults. Zero ovens is
valid for stovetop meals. A recipe cannot split one pan reservation across ovens.

`serve_at` accepts ISO 8601 with an explicit offset (whole-minute precision), or
`HH:MM` for the next occurrence in the kitchen time zone. The next occurrence
handles DST folds and gaps, and must be within seven days. Machine timestamps
are ISO; `serve_at_local` and speech use kitchen-local times such as `6:35 PM`.
Actions within 30 minutes prefer relative speech. Speech is at most two sentences
and 30 words, with no IDs, tools, JSON, URLs, or screen/tap/card references.

All successful results have `say` and `display`; plan results include version,
warnings and timer suggestions with `step_id`, `label`, `minutes`, `ends_at`, and
`say`. `content[0].text` contains speech and `structuredContent` contains the
complete result. Tool input/domain failures return `isError: true` and a
structured `{error_code, say, retryable, current_version?}` object. SDK framing
and resource errors remain MCP protocol errors. No error commits partial state.

Resources: `dish://<dish_id>` and `plan://<plan_id>`, with listing and templates.
GET/DELETE `/mcp` return 405; there is no server event stream in S1.

## Retries and execution

All five changing tools accept an optional **8–64 character `request_id`**,
either in arguments or `_meta["io.oneoven/request_id"]`. If both are present,
they must agree. Keys are scoped to the household and shared across tools.
Reusing a key with the same tool and normalized arguments returns the stored
response plus `deduplicated: true`, even after newer versions or a restart.
Different arguments or a different tool return `request_id_reused`.

Without a key, the same normalized call within **20 seconds** is replayed only
if its resulting plan version is still current. A repeated delay explicitly
says it was already applied. `allow_repeat: true` bypasses this implicit guard;
it never bypasses an explicit key. `based_on_version` on plan mutations rejects
stale updates with `version_conflict` and the current version. Deduplication
precedes the version check, so retries of a successful request remain valid.
Independent polling/starting of simultaneous actions can use `allow_repeat`.

Steps are explicitly pending, running or done. Elapsed time does not complete
action steps automatically. Confirm completion with `done_step_id`; overdue
running steps block new starts until confirmed or extended. `start_step_id`
starts eligible future work now, checks dependencies and frozen resources, and
repairs pending work. Preheats and transitions are real system actions requiring
confirmation. The S2 host consumes timer suggestions; audible expiry is S3 work.

## Scheduling and storage

Reverse serial scheduling preserves dish input priority. Candidate starts use
resource boundaries and thermal gaps, not minute-by-minute searching. Half-open
intervals allow an exact-boundary handoff. Overlapping recipes on one oven must
fit its capacity and a 25°F range. An uninterrupted occupancy batch keeps the
range midpoint rounded to 5°F. Temperature changes require an empty oven;
preheat and transition duration use the appropriate heating/cooling rate.

Pending system actions are rebuilt on repair; started or completed ones stay
fixed. Already feasible batches retain their shared setpoint. Completed steps
stay unchanged and running starts remain fixed. Recipe-only change summaries
avoid speaking system-action churn. This is a deterministic scheduling heuristic,
not global optimization; infeasible or frozen conflicts fail atomically.

A dish's finish-to-serve time appears in `display.dishes`. Exceeding its quality
hold limit generates `hold_exceeded`. The four demo scenarios have no warnings.
These quality limits do not certify food safety; durations remain uncalibrated.

Every mutation runs inside one SQLite `BEGIN IMMEDIATE`: read, engine, write,
version event and idempotency record. Migrations `001` and `002` create households,
kitchens, plans, plan events and idempotency. Events contain exact before/after
step changes and a full version snapshot (`Store.events` / `Store.planVersion`).
Queries are household scoped, but OAuth and HTTP household selection are S5 work.

Existing v1 databases migrate transactionally. Numeric oven counts become default
profiles; missing time zones become `America/Chicago`. Pending legacy schedules
receive heating/transition gaps where needed, potentially moving dinner later.
Existing plan IDs and versions are retained with a migration baseline event.
Inferred historical heating is not measured cooking evidence. A physically
inconsistent frozen legacy plan cannot be made valid automatically; migration
fails without altering the old database. Back up old cooking records first.

## Verification and fixtures

```sh
npm run validate:recipes
npm test
npm run smoke
npm run friction:new -- "External product issue title"
# Deliberately regenerate snapshots only after reviewing changed behavior:
node --import tsx packages/server/scripts/update-golden.ts
```

The suite retains the original 11 regression cases, adds independent thermal and
capacity verification, runs 1,000 seeded random kitchen/subset/delay/swap cases,
and executes four golden scenarios to completion. It covers retry time windows,
metadata keys, stale versions, rollback injection, migration/reopen, speech,
DST and malformed recipe data. A 200-sample benchmark includes file-backed SQLite
writes and asserts plan p95 ≤50ms and delay p95 ≤20ms.

See [S1 results](docs/ko/results/RESULT_S1.md) for measurements, snapshot summaries,
completion criteria and deviations. The [friction log](docs/friction/FRICTION_LOG.md)
lists verified external incidents and keeps the design's other F-01–F-11 leads as unverified seeds.

Recipes are original timing fixtures in `packages/server/src/data/dishes`.
Zod and semantic validation enforce resource fields, timing bounds, English
imperatives, brand exclusions, provenance, and fish/poultry safety information.
Thanksgiving is **timing fixture, not kitchen-tested**. Its turkey rest fixture
is 50 minutes so salmon, potatoes and stuffing fit during rest/carving; potatoes
and stuffing share capacity 4 at the 390°F batch midpoint. Copy the
[calibration template](docs/calibration/TEMPLATE-weekday.md) for a real weekday cook
before populating `provenance.calibrated`.

**Timing guidance only. Check doneness with a food thermometer.** General
information, not professional advice or a doneness assessment. The catalogue's
poultry/fish temperature notes reference the
[USDA minimum internal temperature chart](https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/safe-temperature-chart).

Still open: OAuth and household selection, AWS validation, and an MCP App UI. No stage has made an
AWS request, deployment, signup or payment.

[MIT](LICENSE).
