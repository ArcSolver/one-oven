import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clipPcm, type AudioClip } from '../audio/clip.js';
import { run } from '../audio/process.js';
import type { SttEngine } from './index.js';
export class WhisperStt implements SttEngine {
  constructor(readonly config: { binary?: string; model?: string; serverUrl?: string; threads?: number } = {}) {
    if (config.serverUrl && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(config.serverUrl).hostname)) throw new Error('Whisper server must be local');
  }
  async transcribe(audio: AudioClip, hints: string[] = []) {
    clipPcm(audio);
    const at = performance.now();
    if (this.config.serverUrl) {
      const form = new FormData();
      form.append('file', new Blob([Uint8Array.from(audio.wav)], { type: 'audio/wav' }), 'speech.wav');
      form.append('response_format', 'json'); form.append('language', 'en');
      form.append('audio_ctx', '0');
      form.append('no_context', 'true');
      form.append('temperature', '0'); form.append('prompt', hints.join(', '));
      const response = await fetch(new URL('/inference', this.config.serverUrl), { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Local Whisper returned ${response.status}`);
      const data = await response.json() as { text?: string };
      if (typeof data.text !== 'string') throw new Error('Invalid Whisper response');
      return { text: data.text.trim(), ms: performance.now() - at };
    }
    if (!this.config.model) throw new Error('Set WHISPER_MODEL or WHISPER_SERVER_URL; see packages/voice/README.md');
    const directory = await mkdtemp(join(tmpdir(), 'one-oven-stt-'));
    try {
      const path = join(directory, 'speech.wav'), output = join(directory, 'transcript');
      await writeFile(path, audio.wav);
      await run(this.config.binary ?? 'whisper-cli', ['-m', this.config.model, '-f', path, '-l', 'en', '-t', String(this.config.threads ?? 4),
        '-nt', '-otxt', '-of', output, '--prompt', hints.join(', '), '-bs', '1', '-bo', '1'], undefined, 60000);
      return { text: (await readFile(`${output}.txt`, 'utf8')).trim(), ms: performance.now() - at };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
