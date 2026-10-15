import { readFile } from 'node:fs/promises';
import type { SttEngine } from './index.js';
import { clipPcm, type AudioClip } from '../audio/clip.js';
/** Explicit test double; never selected as an automatic fallback for Whisper. */
export class FixtureStt implements SttEngine {
  async transcribe(audio: AudioClip) {
    clipPcm(audio);
    if (!audio.sourcePath?.endsWith('.wav')) throw new Error('Fixture STT requires a .wav source path');
    const at = performance.now();
    return { text: (await readFile(audio.sourcePath.replace(/\.wav$/, '.txt'), 'utf8')).trim(), ms: performance.now() - at };
  }
}
