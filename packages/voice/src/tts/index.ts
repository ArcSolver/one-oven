import type { AudioClip } from '../audio/clip.js';
export interface TtsEngine { synthesize(text: string): Promise<AudioClip>; readonly voiceId: string }
