import type { AudioClip } from '../audio/clip.js';
export type Transcript = { text: string; ms: number; confidence?: number };
export interface SttEngine { transcribe(audio: AudioClip, hints?: string[]): Promise<Transcript> }
/** One shared vocabulary for every utterance: catalog dish names and kitchen words, never per-line answers. */
export const COOKING_HINTS = ['salmon', 'rice', 'green beans', 'glazed carrots', 'preheat', 'swap', 'five', 'six thirty', 'Alexa', 'kitchen', 'oven', 'burners', 'preheating', 'preparing', 'resting', 'timer',
  'turkey', 'gravy', 'stuffing', 'roasted potatoes', 'Thanksgiving', 'cooks'];
export function stripWakeWord(text: string): string { return text.trim().replace(/^alexa[\s,.:!]+/i, '').trim(); }
