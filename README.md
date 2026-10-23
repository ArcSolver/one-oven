# One Oven

**When cooking runs late, One Oven fixes only what changed.**

Demo video: https://youtu.be/BwIou4GRX8A

One Oven is an MCP server for the Alexa+ track of the Build, Ship, Shape: Amazon Developer Hackathon.
It plans a home cook's meal backward from dinner time, accounts for oven heating and pan capacity, and
repairs the schedule when one dish runs late. The demo runs in our own web simulator of an Alexa+ screen
device and a voice-only speaker, driven by a Strands Agents host.

## See the delay repair without a browser

Node.js 22.13 or newer. No account, API key or cloud service is needed.

```sh
npm ci
npm run build
npm run e2e:scenarios -- --scenario salmon-delay
```

This cooks salmon, rice and green beans for 6:30 PM and reports the salmon late at 6:20 PM. The same
dinner runs three ways: through the engine, through a plain MCP client over HTTP, and through the
Strands agent with the scripted model. Each prints `PASS`. The agent run writes
`runs/scenarios/salmon-delay/<time>-agent/transcript.md`; these are its two delay turns:

| Clock | Cook | One Oven |
| --- | --- | --- |
| 6:20 PM | Alexa, the salmon needs five more minutes. | Dinner moves to 6:35 PM. The lemon salmon gets 5 more minutes; the other dishes keep their times. |
| 6:20 PM | The salmon needs five more minutes. | I already added 5 minutes to the salmon. Say 'add 5 more' if you need more time. |

The runner judges each turn by the stored plan: only `salmon:1` and `salmon:2` change, dinner moves
to 6:35 PM, the rice and green beans keep their times, and the repeated sentence changes nothing.
`npm run check` runs all four scenarios this way, plus the full test suite.

## Click through it in the simulator

```sh
npm run sim        # then open http://127.0.0.1:5180/ in a window at least 1600 px wide
```

The default model, `scripted:weekday-3`, answers only these sentences.
Type them into the dock:

1. “My kitchen has one oven, four burners, and one cook.”
2. “I want salmon, rice and green beans on the table at 6:30 PM.” The plan starts at 5:55 PM.
3. Press *Next event*. If a step on the Now card has ended, say “I'm done with the rice. What's next?”
   with that step's dish (rice, salmon, green beans or oven); otherwise say “What's next?”. Repeat until
   One Oven says to roast the salmon, about six turns.
4. “The salmon needs five more minutes.” Dinner moves to 6:35 PM and on the Run of Show only the salmon
   bars move. Say it again and nothing changes.

Hold to talk works once local Whisper is installed (`npm run voice:setup`, see
[packages/voice](packages/voice/README.md)). Spoken replies use the system TTS (macOS `say` or
espeak-ng) and ffmpeg, listed in the same README.

## What works

- **MCP server**: six tools over Streamable HTTP, protocol version 2025-11-25 negotiated in the smoke
  test and the scenario runner. Plans are computed only on the server, checked by an independent
  verifier, and stored in SQLite with version history and retry keys.
- **`npm run check`**: build, recipe validation, 79 unit and integration tests,
  HTTP smoke, scripted text E2E, and 4 YAML scenarios × engine, MCP and agent modes (12/12).
  The tests include 1,000 seeded random kitchen, delay and swap cases checked by the verifier.
- **Strands host**: a Strands `Agent` and `McpClient` drive the server over HTTP, in text, local
  voice and the web simulator.
- **Live local model**: with a local OpenAI-compatible model selected through `AGENT_MODEL`, 19/20
  scenario trials pass (4 scenarios × 5), and so do 4/4 runs of the voice pipeline through local Whisper
  ([S4 report, Korean](docs/ko/results/RESULT_S4.md)). Voice-mode latency is in the
  [S3 report, Korean](docs/ko/results/RESULT_S3.md).
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
the plan, timeline and tool calls on screen come from `structuredContent` of the tool results.

Without a `.env`, `AGENT_MODEL` is the scripted model `scripted:weekday-3`, so the demo and `npm run check`
need no key; set it to a model for free conversation ([Text host](#text-host)). Cooking timers run in the
host ([F-09](docs/friction/entries/F-09-alexa-timer-handoff-contract.md)), and the Strands integration is
described in [AWS_BUILDER.md](docs/AWS_BUILDER.md).

## Feedback for the Alexa+ and AWS teams

Product feedback per tool is in [docs/FEEDBACK.md](docs/FEEDBACK.md), external friction in the
[friction log](docs/friction/FRICTION_LOG.md), and requests in [docs/FEATURE_REQUESTS.md](docs/FEATURE_REQUESTS.md).
Earlier Korean stage reports are under [docs/ko](docs/ko/README.md).

## Run the MCP server and checks

Node.js **22.13+** with `node:sqlite` and npm.

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

## Text host

```sh
npm run e2e:text                 # always scripted; starts its own local HTTP MCP server
npm run dev                     # terminal 1: MCP server
npm run chat                    # terminal 2: Strands REPL, defaults to scripted:weekday-3
npm run gateway                 # optional: http://127.0.0.1:3001
```

With the scripted model, start with “My kitchen has one oven,
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
The live runner rejects Bedrock and nonlocal URLs.

To use a dev clock, set `ENABLE_DEV_CLOCK=1` and an offset timestamp such as
`SIM_CLOCK_START=2026-10-15T17:05:00-05:00` in both server and host environments.
The normal server has no `/dev/clock` route. The opted-in route checks loopback
and Origin and allows only nonnegative advances. REPL commands are `:dot`,
`:show`, `:advance 10`, and `:quit`.

The session uses Strands `Agent` and `McpClient` calls with the native
TypeScript providers. A public client adapter preserves
`structuredContent` for the model ([F-12](docs/friction/entries/F-12-strands-structured-content.md)).
The model-facing schemas omit host-managed retry/version fields and permit null
for unused optional values; the client removes only optional nulls before MCP
validation. Last plan ID,
current state, device and clock are injected as host context on every model call.

`set_timer`, `cancel_timer`, and `list_timers` are host tools.
Live agents choose timers from suggestions; `HOST_AUTO_TIMERS=1`
lets deterministic hosts install/update suggestions once per step/end time.
The voice host adds timer expiry callbacks, an original chime and local speech output.

The loopback gateway accepts `POST /session/:id/turn` with JSON
`{"utterance":"What's next?"}`. `Accept: application/json` returns a `TurnResult`;
`Accept: text/event-stream` sends `start`, heartbeat comments, and a `turn` event
(or an `error` event). Speech is released only after lint, not as unchecked token
deltas. Delete `/session/:id` to close a session. Concurrent turns on one session
return 409; at most 32 sessions are retained. Conversation and timer state is per
session; the MCP server uses the shared `local` household.

Traces include negotiated MCP version, tool discovery, utterances, raw model
speech, lint/fallback flags, normalized tool arguments, raw MCP results, model
usage and latency, and request IDs when the transport supplies them. Trace files contain
local conversation data, are ignored by Git, and must be reviewed before sharing.
The output guard falls back to a valid tool `say`; live grading still counts a raw
lint violation as a failure. Automatic mutation retries are disabled.

See [S2 spike](docs/ko/results/S2_SPIKE.md) and [S2 results](docs/ko/results/RESULT_S2.md)
(Korean) for the exact versions, trials and traces.

## Voice host

`packages/voice` provides local whisper.cpp STT, system TTS, terminal push-to-talk,
and host timer sounds on the dev clock. No UI or paid speech service is needed.
See [voice setup and acceptance commands](packages/voice/README.md). `npm run check`
includes the voice adapter/queue/timer tests without downloading speech models.
After local speech setup, run `npm run voice:check` for real WAV recognition and
the unattended 60× cooking replay. `npm run voice` uses the microphone.

The optimized path keeps Strands/MCP and speaks validated server `say` directly,
removing the extra model reply and timer-tool round trips. With a local model this
cut the 20-turn p50 from 6.52 s to 2.45 s and p95 from 8.88 s to 3.10 s
([S3 results](docs/ko/results/RESULT_S3.md), Korean).

## Scenarios and shot list

`packages/scenarios` holds four YAML scenarios (weekday dinner, mid-roast salmon delay,
side-dish swap, eight-dish Thanksgiving) that are both the regression suite and the source
of the demo shot list. One runner executes them through the service, a plain MCP client, the Strands
agent, or the local voice pipeline, and judges each turn by stored plan state.

```sh
npm run e2e:scenarios     # engine + MCP + scripted agent; part of check
npm run e2e:live          # live local model, 4 scenarios x 5 trials, 4/5 required each
npm run e2e:voice         # espeak -> Whisper -> agent -> TTS files; needs WHISPER_SERVER_URL
npm run video:script      # shot list docs/submission/VIDEO_SCRIPT.md and .srt from passing runs
```

See the [scenarios README](packages/scenarios/README.md) and [S4 results](docs/ko/results/RESULT_S4.md).

## Web simulator

`npm run sim` starts the MCP server, the Strands host and the browser UI together at http://127.0.0.1:5180/ (`/?film=1` is the 1600×704 recording frame).
Type or hold to talk: speech goes through local Whisper, replies play through the same TTS, and the Run of Show and tool calls come only from MCP results.
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
GET/DELETE `/mcp` return 405; the server has no event stream.

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
repairs pending work. Preheats and transitions are system actions and also need
confirmation. Hosts consume timer suggestions; the voice host and the simulator announce expiry.

## Scheduling and storage

Reverse serial scheduling preserves dish input priority. Candidate starts use
resource boundaries and thermal gaps. Half-open
intervals allow an exact-boundary handoff. Overlapping recipes on one oven must
fit its capacity and a 25°F range. An uninterrupted occupancy batch keeps the
range midpoint rounded to 5°F. Temperature changes require an empty oven;
preheat and transition duration use the appropriate heating/cooling rate.

Pending system actions are rebuilt on repair; started or completed ones stay
fixed. Already feasible batches retain their shared setpoint. Completed steps
stay unchanged and running starts remain fixed. Recipe-only change summaries
avoid speaking system-action churn. Infeasible or frozen conflicts fail
atomically.

A dish's finish-to-serve time appears in `display.dishes`. Exceeding its quality
hold limit generates `hold_exceeded`. The four demo scenarios have no warnings.

Every mutation runs inside one SQLite `BEGIN IMMEDIATE`: read, engine, write,
version event and idempotency record. Migrations `001` and `002` create households,
kitchens, plans, plan events and idempotency. Events contain exact before/after
step changes and a full version snapshot (`Store.events` / `Store.planVersion`).
Queries are household scoped.

Existing v1 databases migrate transactionally. Numeric oven counts become default
profiles; missing time zones become `America/Chicago`. Pending legacy schedules
receive heating/transition gaps where needed, potentially moving dinner later.
Existing plan IDs and versions are retained with a migration baseline event. A physically
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

See [S1 results](docs/ko/results/RESULT_S1.md) (Korean) for measurements and snapshot summaries.
The [friction log](docs/friction/FRICTION_LOG.md) lists external incidents.

Our own recipes are JSON files in `packages/server/src/data/dishes`.
Zod and semantic validation enforce resource fields, timing bounds, English
imperatives, brand exclusions, provenance, and fish/poultry safety information.
The Thanksgiving turkey rest is 50 minutes so salmon, potatoes and stuffing fit during rest/carving; potatoes
and stuffing share capacity 4 at the 390°F batch midpoint.

**Check doneness with a food thermometer.** The catalogue's
poultry/fish temperature notes reference the
[USDA minimum internal temperature chart](https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/safe-temperature-chart).

[MIT](LICENSE).
