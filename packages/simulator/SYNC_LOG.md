# Simulator sync log (`sync.jsonl`)

Every take (each simulator start and each **New take**) writes
`runs/sim-<timestamp>/sync.jsonl` next to the agent `trace.jsonl` and the take's SQLite file.
The log exists so recordings of the 1600×704 film frame can be aligned with what the system did
and with where each Run of Show bar was drawn. `runs/` is ignored by Git; utterances are personal
data, so review a log before sharing it.

## Common fields

| Field | Meaning |
| --- | --- |
| `seq` | 1, 2, 3… in write order |
| `t_ms` | Host monotonic milliseconds since the take opened (`performance.now`). Never decreases within a file |
| `wall` | Host wall clock (ISO). Informational only; it can jump |
| `type` | Record type, below |
| `src` | `"ui"` for records sent by the browser; absent for host records |
| `ui_ms` | UI records only: the browser's `performance.now()` when the event happened (page-load origin) |
| `ui_t_ms` | UI records only: `ui_ms` mapped onto the `t_ms` timeline using the best `clock_sync` pair. **Use this, not `t_ms`, for UI event times**; `t_ms` of a UI record is when the batch reached the host (≈120 ms later) |

`ui_t_ms` appears once the page has paired clocks (immediately after load and after each new take).
Within one page load `ui_ms` is monotonic. Host and UI records interleave by `t_ms`, not by `ui_t_ms`.

## Record types

| Type | Source | Fields |
| --- | --- | --- |
| `take_start` | host | `take`, `t0_mono_ms` (host `performance.now()` at `t_ms` 0; the agent runs in the same process, so a trace `mono_ms` equals `t_ms + t0_mono_ms`), `trace` (agent trace path), `mcp_url`, `protocol` (negotiated MCP version), `model`, `device`, `sim_now` (ISO), `timezone`, `stt`, `tts` |
| `clock_sync` | host | `ui_send_ms`, `ui_receive_ms`, `host_t_ms`, `rtt_ms`, `offset_ms` (best so far; `ui_t_ms = ui_ms + offset_ms`) |
| `ui_hello` | ui | `film`, `viewport`, `dpr`, `stage` {x, y, width, height} in viewport CSS px, `user_agent` |
| `ui_submit` | ui | `input` (`text`/`voice`), `utterance` or `audio_bytes`. The moment the user pressed Enter or stopped talking |
| `mic_start` / `mic_end` | ui | `sample_rate` / `audio_ms` |
| `turn_start` | host | `turn` (1, 2… per take), `input`, `utterance` or `audio_bytes` |
| `stt_end` | host | `turn`, `heard` (raw Whisper text), `utterance` (wake word removed), `stt_ms` |
| `tool_return` | host | `turn`, `name`, `args`, `ok`, `ms`, `version`, `deduplicated`, `error_code`, `plan_id`. Written when the MCP result arrives, before the reply is spoken |
| `plan` | host | `turn`, `plan_id`, `version`, `serve_at_local`, `changed_step_ids` (from the tool's `changed_steps`) |
| `reply_ready` | host | `turn`, `text`: validated speech handed to TTS |
| `turn_end` | host | `turn`, `utterance`, `reply`, `reply_source` (`tool-say`/`model`), `total_ms`, `model_ms`, `tool_ms`, `tools` |
| `turn_error` | host | `turn`, `error` |
| `tts_ready` | host | `id`, `turn`, `kind` (`reply`/`timer`), `text`, `voice`, `synth_ms`, `audio_ms` |
| `tts_play_start` / `tts_play_end` | ui | `id`, `turn`, `kind` (`reply`/`timer`/`chime`), `audio_ms`, `ctx_state`. Web Audio `start()` and `ended` |
| `timer_fire` | host | `label`, `ends_at`, `text`, `sim_now` |
| `clock` | host | `reason` (`advance`, `next_event`, `at HH:MM`), `minutes`, `sim_now`, `sim_local` |
| `device` | host | `device` (`show` = screen, `dot` = voice-only speaker) |
| `ui_anim_start` / `ui_anim_end` | ui | `plan_id`, `version`, `from_version`, `changes` {bar key → `moved`/`added`/`removed`/`status`}. Only when bars move; 600 ms |
| `bars` | ui | Snapshot after drawing a version (after `ui_anim_end` when animated), below |
| `sync_marker` | ui | `phase` `on`/`off`; `ui_ms` is the animation frame in which the 16×16 marker at the frame's bottom-right corner turned ink (`#202137`) or back |

## `bars`

```json
{"seq":128,"t_ms":10756.455,"wall":"2026-10-20T13:17:12.431Z","type":"bars","src":"ui","ui_ms":11052.6,
 "ui_t_ms":10651.226,"plan_id":"…","version":11,"reason":"version","serve_at_local":"6:35 PM",
 "changes":{"dish:salmon/salmon:1":"moved","dish:salmon/salmon:2":"moved","oven:0/salmon:1":"moved"},
 "axis":{"start":29868400,"end":29868465,"start_local":"5:40 PM","end_local":"6:45 PM",
         "track_x0":678,"track_width":862,"px_per_min":13.261538461538462},
 "stage":{"width":1600,"height":704,"film":true},
 "bars":[{"key":"dish:salmon/salmon:1","lane":"dish:salmon","step_id":"salmon:1","dish_id":"salmon",
          "status":"running","x":1063,"y":183,"width":301,"height":56,"layout_x":1063,"layout_width":301,
          "start":29868429,"end":29868452,"start_local":"6:09 PM","end_local":"6:32 PM"}]}
```

- Coordinates are CSS px in the **stage frame**: origin at the top-left of the 1600×704 frame.
  `x/y/width/height` are measured DOM rectangles; `layout_x/layout_width` are the computed integer
  layout and must be equal (the Playwright test asserts this). Film capture is 1:1, so a pixel in a
  recording made at DPR 1 equals these numbers; at DPR 2 multiply by 2. In the video composition the
  frame sits at x 160, y 148 of 1920×1080, so add those offsets.
- `key` is `<lane>/<step_id>`; lanes are `dish:<dish_id>` and `oven:<index>`. A step that occupies an
  oven appears twice (its dish lane and its oven lane).
- `start`/`end` are the server's minute epochs (minutes since 1970-01-01 UTC); `*_local` use the
  kitchen time zone.
- `reason` is `first_draw` (new plan or relayout), `version`, or `axis_extended`.
- The axis is fixed per plan ID: first step to serving time, rounded to 5 minutes, with 15 minutes
  of padding (salmon-delay: 5:40–6:45 PM). It only grows if a later version leaves it, and reports
  `axis_extended`. The Now line moves with the clock; it is not a bar and is not logged here.
- A bar absent from `changes` was not touched in the DOM: its rectangle and pixels are identical to
  the previous snapshot. Each bar is its own compositor layer so neighbouring animations do not
  re-rasterize it.

## Aligning a recording

1. Start the screen recording, then press **M** (or *Sync marker* in the dock). Find the first frame
   in which the bottom-right 16×16 square is ink; that frame is `sync_marker phase:on` at `ui_t_ms`.
2. Recording time of any UI event = marker frame time + (`ui_t_ms` − marker `ui_t_ms`). Host events
   use `t_ms` on the same timeline.
3. The final frame of a delay animation is `ui_anim_end.ui_t_ms`; the matching `bars` record gives the
   bar rectangles for callouts and for pixel-still checks.
