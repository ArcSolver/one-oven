import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../audio/process.js';
import { pcmToClip, type AudioClip } from '../audio/clip.js';
import type { TtsEngine } from './index.js';
export class SystemTts implements TtsEngine {
  readonly voiceId: string;
  constructor(readonly voice = process.platform === 'darwin' ? 'Samantha' : 'en-gb', readonly rate = 155) {
    this.voiceId = `${process.platform === 'darwin' ? 'say' : 'espeak-ng'}:${voice}`;
  }
  async synthesize(text: string): Promise<AudioClip> {
    if (!text.trim() || text.length > 4000) throw new Error('Invalid speech text');
    const directory = await mkdtemp(join(tmpdir(), 'one-oven-tts-'));
    const path = join(directory, process.platform === 'darwin' ? 'speech.aiff' : 'speech.wav');
    try {
      if (process.platform === 'darwin') await run('say', ['-v', this.voice, '-r', String(this.rate), '-o', path, '--', text]);
      else await run('espeak-ng', ['-v', this.voice, '-s', String(this.rate), '-w', path, '--stdin'], Buffer.from(text));
      // Explicit raw output avoids ffmpeg's streaming WAV sentinel length fields.
      const pcm = await run('ffmpeg', ['-v', 'error', '-i', path, '-f', 's16le', '-ar', '16000', '-ac', '1', 'pipe:1']);
      return pcmToClip(pcm);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
