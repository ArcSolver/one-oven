# One Oven

“Salmon, rice and green beans on the table at 6:30.”

One Oven plans a meal backward from dinner time, accounts for oven heating and
pan capacity, and repairs the schedule when cooking runs late. Stage 1 provides
a deterministic engine and a local MCP server for the Alexa+ hackathon track.
It is not an official Alexa product. All spoken output is English; the intended
audience is adult home cooks.

## Run locally

Node.js **22.13+** with `node:sqlite` and npm; S1 verified with Node **24.21.0**.
No account, API key, paid service or cloud deployment is needed.

```sh
npm ci
npm run check             # build -> validate:recipes -> test -> real HTTP smoke
npm run dev               # http://127.0.0.1:3000/mcp
# Or: npm run build && npm start
```

`PORT` defaults to 3000. `DB_PATH` defaults to `data/one-oven.sqlite` under the
original command directory, including when npm changes to the server workspace.
Set environment variables in the shell; `.env.example` lists the options. `.env`
is ignored and is not automatically loaded. The server binds to loopback,
checks Host and Origin, and currently uses the fixed household `local`.

The workspaces are `packages/contracts` (Zod schemas, types, speech lint) and
`packages/server` (engine, recipes, SQLite, service, MCP, tests). JSON recipes and
SQL migrations are copied into the production build.

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
confirmation. Timer suggestions are a handoff for a later host, not running timers.

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

See [S1 results](docs/results/RESULT_S1.md) for measurements, snapshot summaries,
completion criteria and deviations. [Friction log](docs/friction/FRICTION_LOG.md)
reserves the design's F-01–F-11 leads without presenting them as verified incidents.

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

S2–S8 remain: Strands host, voice and timers, scenario runners, OAuth, AWS
integration, MCP App UI and submission artifacts. No push, deployment, signup,
payment or submission was performed in S1.

[MIT](LICENSE).
