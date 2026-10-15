import { readFile } from 'node:fs/promises';
import { assertSpeech, type Clock } from '@one-oven/contracts';
import type { ConversationSession, TurnResult } from '@one-oven/agent';
import type { HostTimers, TimerView } from '@one-oven/agent/host-tools';
import type { TraceSink } from '@one-oven/agent/trace';
import type { AudioClip } from './audio/clip.js';
import type { AudioPlayer, PlaybackReceipt } from './audio/play.js';
import { COOKING_HINTS, stripWakeWord, type SttEngine } from './stt/index.js';
import type { TtsEngine } from './tts/index.js';
export type VoiceResult = { transcript: string; turn: TurnResult; timings: { sttMs: number; agentMs: number;
  modelMs: number; toolMs: number; ttsMs: number; outputStartMs: number; totalMs: number; playbackKind: PlaybackReceipt['kind'] } };
export type VoiceSession = { turn: ConversationSession['turn']; timers: Pick<HostTimers, 'onFire' | 'start' | 'stop'>; opts: { clock: Clock } };
export class VoiceLoop {
  private queue: Promise<void> = Promise.resolve();
  private unsubscribe: () => void;
  private busy = false;
  private closed = false;
  private outputErrors: unknown[] = [];
  constructor(readonly opts: { session: VoiceSession; stt: SttEngine; tts: TtsEngine; player: AudioPlayer; trace: TraceSink }) {
    this.unsubscribe = opts.session.timers.onFire(timer => {
      const firedAt = opts.session.opts.clock.now();
      void this.enqueue(() => this.announce(timer, firedAt)).catch(error => {
        this.outputErrors.push(error); opts.trace.write({ type: 'timer_audio_error', error: 'audio_output_failed' });
      });
    });
    opts.session.timers.start();
  }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task);
    this.queue = next.then(() => {}, () => {});
    return next;
  }
  private async announce(timer: TimerView, firedAt: number): Promise<void> {
    const candidate = `Your ${timer.label.toLowerCase()} timer is done.`;
    let text = candidate;
    try { assertSpeech(text); } catch { text = 'Your cooking timer is done.'; }
    const chime: AudioClip = { wav: await readFile(new URL('./audio/chime.wav', import.meta.url)), sampleRate: 16000 };
    await this.opts.player.play(chime);
    const audio = await this.opts.tts.synthesize(text);
    await this.opts.player.play(audio, receipt => this.opts.trace.write({ type: 'timer_fire', label: timer.label, text,
      endsAt: timer.endsAt, firedAt: new Date(firedAt).toISOString(), spokenAt: new Date(this.opts.session.opts.clock.now()).toISOString(),
      playbackKind: receipt.kind, latenessMs: this.opts.session.opts.clock.now() - Date.parse(timer.endsAt) }));
  }
  async accept(audio: AudioClip): Promise<VoiceResult> {
    if (this.closed || this.busy) throw new Error('Voice loop is closed or a turn is running');
    this.busy = true;
    const at = performance.now();
    try {
      const transcript = await this.opts.stt.transcribe(audio, COOKING_HINTS);
      const utterance = stripWakeWord(transcript.text);
      if (!utterance) throw new Error('No speech recognized; please record again');
      const sttMs = performance.now() - at, agentAt = performance.now();
      let speech: Promise<{ ttsMs: number; receipt: PlaybackReceipt }> | undefined;
      const turn = await this.opts.session.turn(utterance, text => {
        assertSpeech(text);
        // Synthesis begins on validated final speech while Strands finishes the turn.
        const ttsAt = performance.now();
        const synthesis = this.opts.tts.synthesize(text).then(clip => ({ clip, ttsMs: performance.now() - ttsAt }));
        void synthesis.catch(() => {});
        speech = this.enqueue(async () => {
          const { clip, ttsMs } = await synthesis;
          let receipt: PlaybackReceipt | undefined;
          await this.opts.player.play(clip, value => { receipt = value; });
          if (!receipt) throw new Error('Player did not report audio start');
          return { ttsMs, receipt };
        });
        void speech.catch(() => {});
      });
      const agentMs = performance.now() - agentAt;
      if (!speech) throw new Error('No validated speech from session');
      const { ttsMs, receipt } = await speech;
      const result: VoiceResult = { transcript: utterance, turn, timings: { sttMs, agentMs, modelMs: turn.timings.modelMs,
        toolMs: turn.timings.toolMs, ttsMs, outputStartMs: receipt.startMs - at, totalMs: performance.now() - at, playbackKind: receipt.kind } };
      this.opts.trace.write({ type: 'voice_turn', ...result });
      return result;
    } catch (error) {
      this.opts.trace.write({ type: 'voice_error', error: error instanceof Error ? error.name : 'Error', totalMs: performance.now() - at });
      throw error;
    } finally { this.busy = false; }
  }
  async flush(): Promise<void> { await this.queue; if (this.outputErrors.length) throw new Error('Timer audio failed', { cause: this.outputErrors.shift() }); }
  async close(): Promise<void> { this.closed = true; this.unsubscribe(); this.opts.session.timers.stop(); await this.flush(); }
}
