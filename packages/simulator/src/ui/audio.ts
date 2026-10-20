import type { Speech } from '../shared/api.js';
import { downsample, encodeWav } from '../shared/wav.js';
import { uilog } from './log.js';

/** One output queue for replies, chimes and timer speech, like the voice host's single audio queue. */
export class Speaker {
  private ctx?: AudioContext;
  private chain: Promise<void> = Promise.resolve();
  private playing = 0;
  constructor(readonly onActivity: (speaking: boolean) => void) {}
  context(): AudioContext { return this.ctx ??= new AudioContext(); }
  async unlock(): Promise<void> { if (this.context().state === 'suspended') await this.context().resume(); }
  enqueue(speech: Speech): Promise<void> {
    const task = this.chain.then(() => this.play(speech)).catch(() => uilog('tts_play_error', { id: speech.id }));
    this.chain = task;
    return task;
  }
  idle(): Promise<void> { return this.chain; }
  private async play(speech: Speech): Promise<void> {
    const ctx = this.context();
    const bytes = Uint8Array.from(atob(speech.wav), c => c.charCodeAt(0));
    const buffer = await ctx.decodeAudioData(bytes.buffer);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const ended = new Promise<void>(resolve => { source.onended = () => resolve(); });
    this.onActivity(++this.playing > 0);
    source.start();
    uilog('tts_play_start', { id: speech.id, turn: speech.turn, kind: speech.kind, audio_ms: Math.round(buffer.duration * 1000), ctx_state: ctx.state });
    await ended;
    uilog('tts_play_end', { id: speech.id, turn: speech.turn, kind: speech.kind });
    this.onActivity(--this.playing > 0);
  }
}
/** Push-to-talk capture to 16 kHz mono PCM16 WAV for the local Whisper adapter. */
export class Microphone {
  private stream?: MediaStream;
  private ctx?: AudioContext;
  private node?: ScriptProcessorNode;
  private chunks: Float32Array[] = [];
  get active(): boolean { return !!this.stream; }
  async start(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.node.onaudioprocess = event => { this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0))); };
    source.connect(this.node);
    this.node.connect(this.ctx.destination);
    uilog('mic_start', { sample_rate: this.ctx.sampleRate });
  }
  async stop(): Promise<Uint8Array> {
    const rate = this.ctx?.sampleRate ?? 48000;
    this.node?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop());
    await this.ctx?.close();
    this.stream = undefined; this.ctx = undefined; this.node = undefined;
    const samples = new Float32Array(this.chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const chunk of this.chunks) { samples.set(chunk, at); at += chunk.length; }
    this.chunks = [];
    uilog('mic_end', { audio_ms: Math.round(samples.length / rate * 1000) });
    return encodeWav(downsample(samples, rate));
  }
}
