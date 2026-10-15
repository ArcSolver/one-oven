import { localTime } from './engine/time.js';
import { speechLint } from '@one-oven/contracts';
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
/** Adds the second step that starts at the same minute, when it still fits two short sentences. */
export function withAlso(first: string, also: ScheduledStep[]): string {
  if (!also.length) return first;
  const text = also[0].text.replace(/ now\.$/, '.');
  const combined = `${first} Also, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  return speechLint(combined).ok ? combined : first;
}
export const dinner = (serve: number, kitchen: Kitchen) => `Dinner is planned for ${localTime(serve, kitchen.timezone)}.`;
export function swapped(replacement: string, removed: string, serve: number, previousServe: number, kitchen: Kitchen): string {
  const time = localTime(serve, kitchen.timezone);
  const verb = /s$/i.test(replacement) ? 'replace' : 'replaces';
  return `${replacement} ${verb} ${removed.toLowerCase()}. Dinner is ${serve === previousServe ? 'still' : 'now'} at ${time}.`;
}
/** Up to two spoken shifts for dishes other than the one the user just delayed. */
export function changesSummary(changed: ReturnType<typeof changes>, delayedDish?: string): string[] {
  const seen = new Set<string>();
  return changed.flatMap(change => {
    if (!change.dish_id || change.dish_id === delayedDish || !change.before || !change.after || seen.has(change.dish_id)) return [];
    const shift = change.after.start - change.before.start;
    if (shift <= 0) return [];
    seen.add(change.dish_id);
    return [`${dish(change.dish_id).name} starts ${shift} minutes later.`];
  }).slice(0, 2);
}
export function delayed(serve: number, previousServe: number, kitchen: Kitchen, summary: string[], dishId: string, minutes: number): string {
  const time = localTime(serve, kitchen.timezone);
  const first = serve === previousServe ? `Dinner stays at ${time}.` : `Dinner moves to ${time}.`;
  const second = summary[0] ?? `The ${dish(dishId).name.toLowerCase()} gets ${minutes} more minutes; the other dishes keep their times.`;
  return `${first} ${second}`;
}
export function repeatedDelay(id: string, minutes: number): string {
  const name = id === 'salmon' ? 'salmon' : dish(id).name.toLowerCase();
  return `I already added ${minutes} minutes to the ${name}. Say 'add ${minutes} more' if you need more time.`;
}
