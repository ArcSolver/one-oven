import type { AudioClip } from '../audio/clip.js';
export type Transcript = { text: string; ms: number; confidence?: number };
export interface SttEngine { transcribe(audio: AudioClip, hints?: string[]): Promise<Transcript> }
export const COOKING_HINTS = ['salmon', 'rice', 'green beans', 'glazed carrots', 'preheat', 'swap', 'five', 'six thirty', 'Alexa', 'kitchen', 'oven', 'burners', 'preheating', 'preparing', 'resting', 'timer'];
export function stripWakeWord(text: string): string { return text.trim().replace(/^alexa[\s,.:!]+/i, '').trim(); }
