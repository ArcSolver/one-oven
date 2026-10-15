import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { TraceRecord, TraceSink } from '@one-oven/agent/trace';
import { VoiceLoop } from '../../../voice/src/loop.js';
import { FilePlayer } from '../../../voice/src/audio/play.js';
import { SystemTts } from '../../../voice/src/tts/system.js';
import type { SttEngine } from '../../../voice/src/stt/index.js';
import type { TtsEngine } from '../../../voice/src/tts/index.js';
import type { Harness } from '../harness.js';
import type { Scenario } from '../schema.js';
import type { TimerFire, TurnInput, TurnOutput } from '../types.js';
import { AgentDriver, type AgentOptions } from './agent.js';

export type VoiceOptions = AgentOptions & { stt: SttEngine; tts: TtsEngine; sttName: string; ttsName: string;
  /** Simulated-to-real ratio for idle cooking time; Infinity skips waiting. */ speed: number };
/**
 * User lines are synthesized to WAV with the local system voice, recognized by the configured STT,
 * then handled by the same agent session; replies and timer announcements are synthesized to files.
 */
export class VoiceDriver extends AgentDriver {
  override readonly mode = 'voice' as const;
  private loop!: VoiceLoop;
  private input!: string;
  private fires: TimerFire[] = [];
  private readonly userVoice = new SystemTts();
  constructor(readonly voice: VoiceOptions) { super({ ...voice, voiceMode: true }); }
  override get description(): string { return `${super.description}; STT ${this.voice.sttName}, TTS ${this.voice.ttsName}`; }
  override async open(harness: Harness, scenario: Scenario, trace: TraceSink, directory: string): Promise<void> {
    const tap: TraceSink = { write: (record: TraceRecord) => {
      if (record.type === 'timer_fire') this.fires.push({ label: String(record.label), text: String(record.text),
        endsAt: String(record.endsAt), latenessMs: Number(record.latenessMs) });
      trace.write(record);
    } };
    await super.open(harness, scenario, tap);
    await this.session.prepare();
    this.input = join(directory, 'input');
    await mkdir(this.input, { recursive: true });
    this.loop = new VoiceLoop({ session: this.session, stt: this.voice.stt, tts: this.voice.tts, trace: tap,
      player: new FilePlayer(join(directory, 'output')) });
  }
  override async turn(input: TurnInput): Promise<TurnOutput> {
    this.prime(input);
    const clip = await this.userVoice.synthesize(input.utterance);
    const path = join(this.input, `${input.beatId}-${input.iteration ?? 0}-${createHash('sha256').update(input.utterance).digest('hex').slice(0, 8)}.wav`);
    await writeFile(path, clip.wav);
    await writeFile(path.replace(/\.wav$/, '.txt'), input.utterance + '\n');
    const result = await this.loop.accept({ ...clip, sourcePath: path });
    const turn = result.turn;
    return { reply: turn.reply, rawReply: turn.rawReply, toolCalls: turn.toolCalls, lint: turn.lint.violations,
      rawLint: turn.rawLint.violations, replySource: turn.replySource, fallback: turn.fallback, transcript: result.transcript,
      modelRequests: turn.modelRequests.length, timings: { totalMs: result.timings.totalMs, toolMs: result.timings.toolMs,
        modelMs: result.timings.modelMs, sttMs: result.timings.sttMs, ttsMs: result.timings.ttsMs, outputStartMs: result.timings.outputStartMs } };
  }
  override async advance(target: number): Promise<TimerFire[]> {
    const clock = this.harness.clock;
    // Simulated time pauses during recognition, the agent and speech output; only idle time accelerates.
    while (clock.now() < target) {
      const delta = Math.min(target - clock.now(), 60000);
      if (Number.isFinite(this.voice.speed)) await sleep(delta / this.voice.speed);
      clock.set(clock.now() + delta);
      await this.loop.flush();
    }
    await this.loop.flush();
    return this.fires.splice(0);
  }
  override async close(): Promise<void> { await this.loop?.close(); await super.close(); }
}
