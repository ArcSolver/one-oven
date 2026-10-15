import type { Plan } from '@one-oven/contracts';
import { changes } from '../engine/changes.js';
export type PlanEvent = { plan_id: string; version: number; tool: string; request_key: string | null;
  changes: { changed_steps: ReturnType<typeof changes>; plan: Plan }; at: number };
export function eventBody(before: Plan | undefined, after: Plan): PlanEvent['changes'] {
  return { changed_steps: changes(before?.steps ?? [], after.steps), plan: after };
}
