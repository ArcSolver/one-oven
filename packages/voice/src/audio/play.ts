import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { clipPcm, type AudioClip } from './clip.js';
import { run } from './process.js';
export type PlaybackReceipt = { startMs: number; kind: 'device-launch' | 'file-ready' | 'silent' };
export interface AudioPlayer { play(clip: AudioClip, onStart?: (receipt: PlaybackReceipt) => void): Promise<void> }
export class SoxPlayer implements AudioPlayer {
  async play(clip: AudioClip, onStart?: (receipt: PlaybackReceipt) => void): Promise<void> {
    clipPcm(clip);
    // Device launch is measurable here; actual speaker onset needs loopback recording.
    const task = run('play', ['-q', '-t', 'wav', '-'], clip.wav);
    onStart?.({ startMs: performance.now(), kind: 'device-launch' });
    await task;
  }
}
/** Headless output keeps real audio for inspection; it never claims audible playback. */
export class FilePlayer implements AudioPlayer {
  private count = 0;
  constructor(readonly directory: string) {}
  async play(clip: AudioClip, onStart?: (receipt: PlaybackReceipt) => void) {
    clipPcm(clip); await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, `${String(++this.count).padStart(3, '0')}.wav`), clip.wav);
    onStart?.({ startMs: performance.now(), kind: 'file-ready' });
  }
}
