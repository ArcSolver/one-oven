import type { StepView } from './timeline.js';
/** JSON exchanged between the simulator host and the browser UI. */
export type Device = 'show' | 'dot';
export type ClockView = { now: number; local: string; sim: boolean };
export type ToolCallView = { name: string; args: unknown; ok: boolean; ms: number; deduplicated?: boolean;
  version?: number; error_code?: string };
export type PlanState = { plan_id: string; version: number; serve: number; serve_at_local: string;
  steps: StepView[]; dish_ids: string[]; changed_step_ids: string[] };
export type Speech = { id: string; text: string; wav: string; kind: 'reply' | 'timer' | 'chime'; turn?: number };
export type TurnView = { turn: number; input: 'text' | 'voice'; utterance: string; heard?: string; reply?: string;
  replySource?: string; tools: ToolCallView[]; error?: string };
export type HostState = { session: string; device: Device; timezone: string; clock: ClockView; model: string;
  voice: { stt: string; tts: string; ready: boolean }; plan?: PlanState; last?: TurnView; busy: boolean; log: string };
export type HostEvent =
  | { type: 'state'; state: HostState }
  | { type: 'speech'; speech: Speech }
  | { type: 'turn_start'; turn: number; input: 'text' | 'voice'; utterance?: string }
  | { type: 'tool'; turn: number; call: ToolCallView; plan?: PlanState };
