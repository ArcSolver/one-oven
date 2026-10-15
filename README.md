# One Oven

“Salmon, rice and green beans on the table at 6:30.”

One Oven is a local MCP server that plans a meal backward from dinner time,
respects shared kitchen resources, and repairs the affected schedule when a
dish needs more time. This is the D1–D2 backend for the **Build, Ship, Shape:
Amazon Developer Hackathon**, Alexa+ track. It is not an official Alexa product.
All tool-facing text is English. Intended audience: adult home cooks.

## Run locally

Requires Node.js **22.13+** with `node:sqlite` (verified on Node 26.10.0) and npm.
Older supported Node versions may print an experimental SQLite warning.

```sh
npm ci
npm run check     # TypeScript build, scheduler tests, real HTTP MCP smoke
npm run dev       # http://127.0.0.1:3000/mcp
# Or: npm run build && npm start
```

`PORT` defaults to `3000`; `DB_PATH` defaults to `data/one-oven.sqlite`.
The server binds only to `127.0.0.1`, rejects foreign Origins and uses the SDK's
localhost Host validation. It is an unauthenticated, single-household local
prototype. Do not expose it publicly. No cloud account, credentials, paid API,
LLM, deployment or real Alexa device is needed.

## MCP interface

Official TypeScript SDK, Streamable HTTP with JSON responses at `/mcp`.
The smoke client asserts **2025-11-25** initialization and subsequent protocol
headers. HTTP sessions are stateless; business state is persisted in SQLite.
GET and DELETE return 405: this implementation does not offer a server event
stream or session deletion. Tool results contain `say`, `display`, and stable
IDs inside both text JSON and `structuredContent`. Domain failures use `isError`;
SDK schema errors are also checked in the smoke. Resource errors use MCP errors.

| Tool | Inputs | Result |
| --- | --- | --- |
| `set_kitchen` | `ovens`, `burners`, `helpers` | `kitchen_id` |
| `list_dishes` | optional `course`, `max_minutes` | dish IDs and active/total minutes |
| `plan_meal` | `dish_ids`, `serve_at`, `kitchen_id` | `plan_id`, first step, start time, version |
| `next_step` | `plan_id`, optional `done_step_id` | next action, up to two upcoming actions |
| `report_delay` | `plan_id`, `dish_id`, `minutes` | revised serve time, exact changed steps |
| `swap_dish` | `plan_id`, `dish_id`, `replacement_id` | same plan ID, new version, changed/removed steps |

`helpers` means **total cooks including yourself**; `1` is one pair of hands.
An oven count of zero is accepted for stovetop-only meals; oven recipes then
fail explicitly. Serving times must be ISO 8601 with `Z` or an explicit offset,
in the next seven days. Output timestamps use UTC. Duplicate dish IDs and
plans that would need to start in the past are rejected.

Resources support `resources/list`, `resources/templates/list`, and reads:

- `dish://salmon` (and each other dish ID): original steps and required resources.
- `plan://<plan_id>`: current version, kitchen snapshot and step states.

Eight original timing fixtures: salmon, rice, green beans, potatoes, turkey,
stuffing, carrots and gravy. They are demo schedules, not validated recipes.

## Scheduling and execution semantics

The deterministic scheduler places each recipe chain backward, as late as its
already placed resource reservations allow. It uses minute-sized search steps
and half-open intervals, so a resource can be handed off at an exact boundary.
Each interval reserves hands and burners, plus an assigned oven if needed.
Concurrent occupants of an oven must have a full temperature range of at most
25°F. Distinct ovens can run different temperatures. Search is bounded to seven
days; an impossible capacity returns an error rather than an invalid plan.

**Ready together means ready by a shared serving time.** With one cook, two
hands-on finishing actions cannot literally end simultaneously. Each dish has
an explicit `ready_at` and `hold_minutes` in `display.dishes`. Rest steps are
part of the recipe; any additional holding is reported separately. This
heuristic does not optimize holding time or prove a globally optimal schedule.

Steps have explicit `pending`, `running`, and `done` states. `next_step` starts
the earliest eligible action only when due; a future action is announced with
its start time. Call `next_step` with its `done_step_id` to confirm completion.
Elapsed time never silently marks work done. An overdue running action blocks
new starts until confirmed or extended. Timer suggestions are instructions for
a future host to delegate to Alexa's native timers, not timers created here.
Production uses the wall clock rounded up to the next minute; the smoke injects
a clock through the Service constructor without exposing a time-travel tool.

`report_delay` adds 1–180 minutes to the dish's first unfinished step. A running
step keeps its start and extends its end; completed steps are immutable. Pending
steps keep their old times unless the delay, a dependency, a resource collision,
or missed start time forces them later. The serving time never moves earlier.
`changed_steps` contains before/after records only for actual changes. This is
a deterministic local repair, not a global minimum-edit optimization. If an
extension would collide with another frozen step, it fails without writing.
An unstarted dish can be swapped while keeping the plan ID and incrementing its
version. Retrying a completed-step confirmation is a no-op; repeated delay
calls add more time, so clients must not blindly retry mutations.

## Validation and D2 decision

```sh
npm test          # 11 scheduler cases, including a 96-repair capacity sweep
npm run smoke     # self-hosted on an ephemeral loopback port; temporary SQLite
```

The independent test verifier sweeps resource occupancy at interval boundaries
and checks recipe precedence and serving deadlines. Cases cover weekday three
dishes, incompatible oven temperatures, Thanksgiving eight dishes, one burner,
multiple ovens/cooks, completed/running preservation, collision propagation,
invalid delays, impossible capacities and deterministic repeated scheduling.

The smoke uses the official SDK client over a real HTTP socket. It checks
initialize → tools/list → all six tools, resources, error rollback, Origin
rejection and SQLite close/reopen followed by an HTTP read. It walks the demo
through `next_step`, then reports **salmon +5 minutes**: dinner moves by exactly
five minutes, only `salmon:1` and `salmon:2` change, and rice, green beans and
completed steps stay unchanged. This satisfies the local D2 continuation gate;
actual Alexa+ / Inspector UI compatibility is not claimed.

Local measurement (2026-10-15, Node 26.10.0, macOS): 19 HTTP tool calls including
error cases, max **6.24 ms**, mean **1.60 ms** in the initial passing run. These
are single-run local round-trip measurements, not cloud latency guarantees;
`npm run smoke` prints fresh measurements. No LLM runs on a tool path.

## Remaining work and limits

- D3–D4: MCP App `ui://one-oven/run-of-show`, inline/fullscreen timeline and host
  bridge. `@modelcontextprotocol/ext-apps` is installed; no UI resource or UI
  metadata is advertised until the real app exists.
- Separate Alexa+ host emulator, STT/TTS, Echo Dot mode, Strands/Bedrock and
  native-timer emulation are outside this backend milestone.
- Recipes need real cooking validation, quantities, safe holding limits,
  preheating/temperature-transition buffers and oven tray/volume capacities.
  The current oven model assumes it is ready at the requested temperature and
  allows any number of compatible trays. Never use these fixtures to judge
  doneness or food safety. Timing is general information, not professional advice.
- No multi-user authentication, request-id deduplication, history UI or durable
  event stream yet. The synchronous SQLite service is intended for one local
  process. Plans and kitchens persist; the source recipe catalogue is static.
- No external deployment, signup, payment, push or hackathon submission has
  been performed. Official Alexa+ device behavior remains unverified.

## References and license

- [MCP 2025-11-25 transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Alexa+ MCP overview](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html)

[MIT](LICENSE).
