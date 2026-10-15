import type { ExpectedToolCall } from './schema.js';
import type { ObservedCall, PlannedCall } from './types.js';
import { localHHMM } from './time.js';

export type Ids = { kitchen?: string; plan?: string };
export function resolveArgs(value: unknown, ids: Ids): unknown {
  if (value === '$kitchen') { if (!ids.kitchen) throw new Error('$kitchen used before set_kitchen'); return ids.kitchen; }
  if (value === '$plan') { if (!ids.plan) throw new Error('$plan used before plan_meal'); return ids.plan; }
  if (Array.isArray(value)) return value.map(v => resolveArgs(v, ids));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveArgs(v, ids)]));
  return value;
}
export function resolveCalls(tools: ExpectedToolCall[] | undefined, ids: Ids): PlannedCall[] {
  return (tools ?? []).map(t => ({ name: t.name, args: resolveArgs(t.args ?? {}, ids) as Record<string, unknown> }));
}
const primitive = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
/** Partial match: every expected key must match; extra actual keys are allowed. */
export function argsMatch(expected: unknown, actual: unknown, timezone: string, key = ''): boolean {
  if (key === 'serve_at' && typeof expected === 'string' && typeof actual === 'string') {
    return localHHMM(expected, timezone) === localHHMM(actual, timezone);
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    if (expected.every(primitive) && actual.every(primitive)) {
      const sort = (a: unknown[]) => a.map(v => JSON.stringify(v)).sort();
      return JSON.stringify(sort(expected)) === JSON.stringify(sort(actual));
    }
    return expected.every((v, i) => argsMatch(v, actual[i], timezone));
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([k, v]) => argsMatch(v, (actual as Record<string, unknown>)[k], timezone, k));
  }
  return expected === actual;
}
/** Ordered subsequence match. Returns the matched observed call per planned call, or the first missing index. */
export function matchCalls(planned: PlannedCall[], observed: ObservedCall[], timezone: string):
  { ok: true; matched: ObservedCall[] } | { ok: false; missing: PlannedCall; nameSeen: boolean } {
  const matched: ObservedCall[] = [];
  let cursor = 0;
  for (const call of planned) {
    const index = observed.findIndex((o, i) => i >= cursor && o.name === call.name && argsMatch(call.args, o.args, timezone));
    if (index < 0) return { ok: false, missing: call, nameSeen: observed.some(o => o.name === call.name) };
    matched.push(observed[index]);
    cursor = index + 1;
  }
  return { ok: true, matched };
}
