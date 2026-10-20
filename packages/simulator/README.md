# @one-oven/simulator

A browser simulation of an Alexa+ screen device and a voice-only speaker, driven by the real
One Oven stack. It is a development and filming tool, not an Alexa product; the frame shows
“Simulated Alexa+ experience · our web simulator” unless a film take hides it with `footer=0`
(the video that uses such a take must carry the notice itself).

```sh
npm ci && npm run build     # once
npm run sim                 # MCP server + Strands host + UI → http://127.0.0.1:5180/
```

## What runs

`npm run sim` starts one Node host (`src/host/main.ts`). For each take it spawns the unchanged
MCP server (`packages/server/src/main.ts`, Streamable HTTP, `ENABLE_DEV_CLOCK=1`, fresh SQLite under
`runs/sim-*/`) and opens the same Strands session as the gateway (`openSession`, `OneOvenMcpClient`).
The browser never calls MCP; it talks to the host on the same loopback origin. Everything on screen
comes from `structuredContent` of real tool results: plan steps, version, serving time and the tool
call strip. No schedule is computed in the browser.

- **Input**: text box, or push-to-talk (button, or hold Space in film mode). The browser records
  16 kHz mono PCM16 WAV and the host sends it through the voice package's `WhisperStt` with the
  shared cooking hints, then strips the wake word — the same path as `npm run voice`.
- **Output**: the session's validated speech is synthesized by the voice package's TTS
  (`VOICE_TTS`, default system) and played in the browser through one queue with the timer chime.
- **Voice mode** (`AGENT_VOICE_MODE`, default `1` here) speaks the tool `say` and installs host timers,
  as in the S3 voice host. Timers fire on the simulated clock and are announced in the browser.
- **Clock**: the opt-in simulation clock, as in `npm run chat`'s `:advance`. Start time defaults to
  `SIM_CLOCK_START=2026-10-15T17:05:00-05:00`. The dock offers +1/+5/+10 minutes, *Next event*
  (earliest running end or pending start, like the scenario runner) and *Go to HH:MM*.
  The clock never moves backwards; use *New take* for a fresh server, database and clock.
- **Model**: `AGENT_MODEL` from `.env` (default `scripted:weekday-3`, which only understands the
  weekday phrases in the root README). Set a local or cloud model for free conversation.

## Screen

- **Now** card: running steps (earliest first) with end time and minutes left; **Next**: earliest
  pending step. **You / One Oven**: last utterance (marked when heard by Whisper) and reply.
- **Run of Show**: one lane per dish and per oven. The axis is fixed per plan; when the version
  changes only bars whose minutes changed animate (600 ms), all others keep their exact pixels.
- Serving time, plan version badge, simulated clock, and the last tool calls with arguments.
- **Speaker** mode (`dot`): the screen content disappears and only the light ring shows activity
  (listening, thinking, speaking). The session's device context switches to `dot` as well.
- **Film** mode (`/?film=1`): the page is exactly the 1600×704 frame at the top-left, cursor hidden,
  controls hidden. Keys: <kbd>`</kbd> controls, hold <kbd>Space</kbd> to talk, <kbd>M</kbd> sync marker.
  Use a 1600×704 viewport (or crop) at DPR 1 or 2. `/?film=1&footer=0` also hides the bottom row
  (simulation notice and tool-call strip); nothing else moves, and `ui_hello`/`bars` log `footer: false`.

## Sync log

`runs/sim-*/sync.jsonl` records monotonic per-turn timestamps, tool returns, speech playback,
animation start/end and the drawn rectangle of every bar per plan version. See [SYNC_LOG.md](SYNC_LOG.md).

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `SIM_PORT` | 5180 | UI and host API (loopback only) |
| `SIM_MCP_PORT` | 3010 | Port of the spawned MCP server |
| `SIM_CLOCK_START` | `2026-10-15T17:05:00-05:00` | Simulated start for each take |
| `AGENT_DEVICE` | `show` | Starting device (`show`/`dot`) |
| `WHISPER_SERVER_URL` | `http://127.0.0.1:18080` | Reused if running; otherwise started from `VOICE_TOOLS_DIR` (default `.local/voice`) when `npm run voice:setup` installed it. `WHISPER_MODEL` overrides the model path |
| `SIM_UI` | — | `dist` serves the built UI instead of Vite middleware |

Without Whisper, text input still works and the status line says so.

## Tests

```sh
npm test --workspace @one-oven/simulator   # geometry, WAV format, sync log, host API over real MCP (part of npm test)
npm run sim:e2e                            # Playwright: salmon delay via text input in film mode
```

`e2e/voice.spec.ts` feeds a committed fixture WAV to Chromium's fake microphone and checks that the
browser recording reaches Whisper and the agent; it is skipped when no local Whisper server can be
reused or started. Voice turns keep the uploaded audio as `runs/sim-*/user-N.wav`.

The Playwright salmon run starts its own stack (ports 5190/3020, scripted model, system TTS), cooks until
6:20 PM with the salmon roasting, reports the delay, and checks from the sync log that only the
salmon bars moved by five minutes of pixels while every rice and green-bean bar kept its rectangle
and decoded pixels; the repeated request must be deduplicated and cooking continues until every step is
done with dinner still at 6:35 PM. `SIM_E2E_OUT` chooses where screenshots and the copied log go (default
`runs/sim-e2e/`).

`e2e/film-take.spec.ts` records one film take and is skipped unless `SIM_FILM_OUT` is set:

```sh
SIM_FILM_OUT=$PWD/runs/film-take npm run sim:e2e -- film-take
```

It captures the 1600×704 frame with Playwright's video recorder (WebM, 25 fps), presses **M** after
recording starts and again at the end, and types the salmon-delay beats through `__sim.say`, the same
path as the dock's text box, so the dock never covers the frame. Each turn carries its scenario beat
(`beat`, `iteration` in `turn_start`/`turn_end`), and the device switches to the speaker from beat
`finish`, like `--device show,finish=dot` in the scenario runner. `take.json` in the output directory
names the take's `runs/sim-*/` directory, the page URL, and the video file. `SIM_FILM_FOOTER=0` records
the take at `/?film=1&footer=0`.

Fonts: Manrope and JetBrains Mono variable fonts under `public/fonts/` (SIL OFL 1.1, licence files
alongside).
