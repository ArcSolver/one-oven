import { localTime } from './engine/time.js';
import type { Kitchen, ScheduledStep } from '@one-oven/contracts';
import type { changes } from './engine/changes.js';
import { dish } from './dishes.js';

export function when(minute: number, now: number, timezone: string): string {
  const gap = minute - now;
  return gap > 0 && gap <= 30 ? `in ${gap} ${gap === 1 ? 'minute' : 'minutes'}` : `at ${localTime(minute, timezone)}`;
}
export function instruction(step: ScheduledStep, now: number, timezone: string): string {
  if (step.start <= now) return step.text;
  const action = step.text.replace(/ now\.$/, '.');
  return `Start ${when(step.start, now, timezone)}. ${action}`;
}
export const dinner = (serve: number, kitchen: Kitchen) => `Dinner is planned for ${localTime(serve, kitchen.timezone)}.`;
export function changesSummary(changed: ReturnType<typeof changes>): string[] {
  const seen = new Set<string>();
  return changed.flatMap(change => {
    if (!change.dish_id || !change.before || !change.after || seen.has(change.dish_id)) return [];
    const shift = change.after.start - change.before.start;
    if (shift <= 0) return [];
    seen.add(change.dish_id);
    return [`${dish(change.dish_id).name} starts ${shift} minutes later.`];
  }).slice(0, 2);
}
export function delayed(serve: number, kitchen: Kitchen, summary: string[]): string {
  return [`Dinner moves to ${localTime(serve, kitchen.timezone)}.`, ...summary.slice(0, 1)].join(' ');
}
export function repeatedDelay(id: string, minutes: number): string {
  const name = id === 'salmon' ? 'salmon' : dish(id).name.toLowerCase();
  return `I already added ${minutes} minutes to the ${name}. Say 'add ${minutes} more' if you need more time.`;
}
