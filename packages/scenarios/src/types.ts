import type { Harness } from './harness.js';
import type { Scenario } from './schema.js';
import type { TraceSink } from '@one-oven/agent/trace';

export type Mode = 'engine' | 'mcp' | 'agent' | 'voice';
export type PlannedCall = { name: string; args: Record<string, unknown> };
export type ObservedCall = { name: string; args: unknown; ms: number; error?: string;
  result?: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: unknown } };
export type TurnInput = { beatId: string; iteration?: number; utterance: string; calls: PlannedCall[]; intents: string[] };
export type TurnOutput = {
  reply: string; rawReply: string; toolCalls: ObservedCall[]; lint: string[]; rawLint: string[];
  transcript?: string; replySource?: string; fallback?: boolean; modelRequests?: number;
  timings: { totalMs: number; toolMs: number; modelMs?: number; sttMs?: number; ttsMs?: number; outputStartMs?: number };
};
export type TimerFire = { label: string; text: string; endsAt: string; latenessMs: number };
export interface Driver {
  readonly mode: Mode;
  readonly live: boolean;
  readonly description: string;
  open(harness: Harness, scenario: Scenario, trace: TraceSink, directory: string): Promise<void>;
  turn(input: TurnInput): Promise<TurnOutput>;
  /** Move simulated time forward; returns host timer announcements that fired meanwhile. */
  advance(target: number): Promise<TimerFire[]>;
  protocolVersion(): string | undefined;
  close(): Promise<void>;
}
export const timerSpeech = (label: string) => `Your ${label.toLowerCase()} timer is done.`;
