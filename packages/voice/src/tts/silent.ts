import { pcmToClip } from '../audio/clip.js';
import type { TtsEngine } from './index.js';
export class SilentTts implements TtsEngine {
  readonly voiceId = 'silent:test-only';
  async synthesize(_text: string) { return pcmToClip(new Uint8Array(320)); }
}
