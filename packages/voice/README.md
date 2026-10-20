# Local voice host (S3)

Terminal push-to-talk → local Whisper → Strands → HTTP MCP → system TTS.
No UI, wake-word service, paid speech API or AWS credentials are required.

## Install free local tools

`npm ci && npm run build` installs/builds the TypeScript workspaces. For actual
speech, install **ffmpeg, SoX, espeak-ng, CMake and a C++ compiler** with your OS
package manager. macOS uses the built-in `say` instead of espeak-ng.

```sh
# Debian/Ubuntu example, run yourself if these tools are missing:
sudo apt-get install espeak-ng sox ffmpeg cmake build-essential
npm run voice:setup
```

The setup script downloads pinned **whisper.cpp v1.8.2** and `base.en` under
`.local/voice/` (ignored by Git). Public downloads require no account. It does
not install system packages. `VOICE_TOOLS_DIR` changes that directory.

Start a warm, loopback-only Whisper server in another terminal:

```sh
.local/voice/whisper.cpp/build/bin/whisper-server \
  -m .local/voice/models/ggml-base.en.bin --host 127.0.0.1 --port 18080 \
  -t 4 -bs 1 -bo 1 -nc
```

Configure the ignored root `.env` (or export these variables):

```dotenv
VOICE_STT=whisper
VOICE_TTS=system
WHISPER_SERVER_URL=http://127.0.0.1:18080
SYSTEM_TTS_VOICE=en-gb
AGENT_MODEL=openai:<model-id-from-local-v1-models>
OPENAI_BASE_URL=http://127.0.0.1:10100/v1
```

On macOS set `SYSTEM_TTS_VOICE=Samantha` or omit it. On Linux `en-gb` was more
accurate than `en-us` for the synthetic regression clips; this is not a human
speech/accent benchmark. To use a process per utterance instead of a warm
server, omit `WHISPER_SERVER_URL` and set `WHISPER_BIN` and `WHISPER_MODEL` to
absolute paths. `WHISPER_THREADS` defaults to 4. No recognition failure falls
back to fixture text.

## Talk and record

```sh
npm run dev       # terminal 1; local MCP server
npm run voice     # terminal 2; Enter starts recording, Enter ends it, :quit exits
```

`npm run voice` automatically enables the optimized agent voice mode. It allows
scripted models or the development endpoint `http://127.0.0.1:10100/v1` only.
Use the live model for free-form interaction. `scripted:weekday-3` is a test
double with a narrow vocabulary, not a general voice assistant.

Start with kitchen setup, then “I want salmon, rice and green beans on the table
at six thirty PM.” Ask “What is next?” and explicitly confirm the named dish or
oven step when finished. “Alexa,” is an optional text prefix, not a wake word.
Microphone WAVs and traces stay under ignored `runs/voice-*/`. Recordings are
limited to 60 seconds per utterance. SoX needs an actual input/output device;
the container's headless tests do not verify microphone or speaker hardware.

For the required human recording, complete one weekday meal with a microphone,
keep the WAVs and trace, and record noise/device details in
`docs/ko/calibration/VOICE_MANUAL_S3.md`. This remains a user-operated check.

## Automated acceptance and measurements

```sh
npm run check                         # deterministic unit/integration checks; no speech tools needed
npm run voice:roundtrip               # real Whisper on 12 committed system-TTS WAVs
npm run voice:demo -- --scenario weekday-3 --speed 60
npm run voice:check                   # both real speech acceptance checks above
npm run voice:latency                 # local real-model baseline + optimized 20-turn flow
# LATENCY_RUNS=1..5 controls repetitions; --voice-only omits baseline
```

`voice:demo` starts its own SQLite/MCP server and uses the scripted model unless
`AGENT_MODEL` is explicitly configured. It processes stored kitchen/meal/next/
delay WAVs and generates natural completion WAVs for steps from the real plan.
Every input passes through the selected STT engine. The harness only reads
state to judge results and move time; mutations still go through Strands/MCP.
Both delay and duplicate delay are checked. Additional fixture clips cover swap
and explicit timer commands in STT acceptance; full swap voice scenarios are S4.

`--speed 60` advances idle cooking time at 60 simulated seconds per wall second.
Time pauses during input generation, recognition, model work and output. It is
an accelerated deterministic replay, not an uninterrupted clock while a
several-second sentence plays in less than one simulated minute. Every timer
must speak within ±1 simulated minute. An internal instant mode is reserved for
regression tests, and reports disclose its use.

The demo synthesizes real output WAVs to `runs/s3-voice-*/output/` without needing
a sound device. `playbackKind=file-ready` measures the first available audio,
**not physical speaker onset**. Interactive mode reports `device-launch`; actual
speaker onset requires an audio loopback recording. `outputStartMs` excludes the
user's recording duration and starts when the completed input clip is supplied.
`totalMs` includes playback completion when a real player is used. Model/tool,
STT, synthesis and output timing are distinct trace fields.

`VOICE_STT=fixture` reads `.txt` sidecars and `VOICE_TTS=silent` is a test double.
These are explicit opt-ins and never count as Whisper/TTS acceptance. Real
roundtrip grading rejects fixture STT. `npm run voice:fixtures` regenerates the
12 WAVs with the current system voice; generated output may differ across OSes.
Original text and chime waveform are project-authored, without cloned voices or
music. The chime source is `scripts/chime.ts`; all generated project assets use
the repository MIT license. Whisper and espeak-ng have their own licenses and
are installed separately, not vendored in this repository.

## Interfaces and latency choices

- `SttEngine.transcribe(AudioClip, hints)` and `TtsEngine.synthesize(text)` exchange
  mono 16 kHz PCM16 WAV clips. The adapters validate audio format.
- `AlexaTimerEmulator` extends the session's `HostTimers`. Replacement/cancel,
  deduplication, simulated clock callbacks and a real-time polling loop share
  one store. On expiry it plays the original chime and speaks a linted sentence.
  It never calls a server tool or marks cooking done.
- `VoiceLoop` consumes `ConversationSession` directly, an option allowed in A-3.
  It starts TTS on a validated completed tool response through a speech callback.
  A single audio queue serializes replies and alerts and reports output errors.
- Voice mode uses Strands' public `AfterToolsEvent.endTurn` to speak the server's
  exact `say`, automatically applies timer suggestions, caches the dish catalog
  once and retains four recent plain-text messages with compact trusted state.
  Provider streaming is retained; `firstDeltaMs` records the first content delta.
  Unvalidated model deltas are not sent to speakers. `replySource=tool-say` makes
  the deterministic handoff explicit; it is not a fabricated model reply.
- Normal text sessions retain S2 behavior. `AGENT_VOICE_MODE=1` also opts chat or
  gateway sessions into the same optimization. `AGENT_MODEL` chooses the fast
  model route without a hardcoded model ID. Per-turn state remains authoritative
  on the MCP server, including errors and duplicate delays.
- Polly and Transcribe use real AWS SDK command types but only injected mock
  clients are exercised in S3. Constructors do not resolve credentials or send
  requests; CLI configuration cannot enable real AWS calls. S6 may explicitly
  construct adapters with `allowAws: true` after its separate authorization.
  Transcribe accepts a provisioned vocabulary name, not arbitrary inline hints.

Sources: [whisper.cpp server](https://github.com/ggml-org/whisper.cpp/blob/v1.8.2/examples/server/README.md),
[Polly command](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/polly/command/SynthesizeSpeechCommand/),
[Transcribe command](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/transcribe-streaming/command/StartStreamTranscriptionCommand/).
