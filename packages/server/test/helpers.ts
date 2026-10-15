import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Service } from '../src/service.js';
import { verifyPlan } from '../src/engine/verify.js';
import { dishes } from '../src/dishes.js';
import type { Plan } from '@one-oven/contracts';

export function setup(start = '2026-10-15T17:05:00-05:00') {
  let now = Date.parse(start) / 60000;
  let at = now * 60000;
  const store = new Store(':memory:');
  const service = new Service(store, () => now, () => at);
  return { store, service, now: () => now, at: () => at,
    setNow: (value: number) => { now = value; at = value * 60000; },
    advanceMs: (value: number) => { at += value; },
    kitchen: (helpers = 1) => service.setKitchen({ ovens: 1, burners: 4, helpers, timezone: 'America/Chicago' }).kitchen_id };
}
export function walk(context: ReturnType<typeof setup>, planId: string, until: (p: Plan) => boolean = p => p.steps.every(s => s.status === 'done')): Plan {
  const { service, store } = context;
  for (let guard = 0; guard < 250; guard++) {
    let plan = store.plan(planId);
    verifyPlan(plan, dishes);
    if (until(plan)) return plan;
    const times = plan.steps.filter(s => s.status !== 'done').map(s => s.status === 'running' ? s.end : s.start).filter(t => t >= context.now());
    context.setNow(Math.min(...times));
    assert.ok(Number.isFinite(context.now()), 'finite next event');
    for (const step of plan.steps.filter(s => s.status === 'running' && s.end <= context.now())) {
      service.nextStep(planId, step.step_id, { allow_repeat: true });
      plan = store.plan(planId);
      if (until(plan)) return plan;
    }
    plan = store.plan(planId);
    if (!plan.steps.some(s => s.status === 'running' && s.end <= context.now())) service.nextStep(planId, undefined, { allow_repeat: true });
  }
  throw new Error('Scenario failed to finish within 250 events.');
}
export const thanksgivingIds = ['turkey', 'salmon', 'potatoes', 'stuffing', 'rice', 'green-beans', 'carrots', 'gravy'];
