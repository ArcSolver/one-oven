import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Plan } from '@one-oven/contracts';
import { setup, thanksgivingIds, walk } from './helpers.js';

export function normalized(plan: Plan): Plan {
  return { ...plan, plan_id: 'fixture-plan', kitchen_id: 'fixture-kitchen' };
}
for (const scenario of ['weekday-3', 'salmon-delay', 'swap', 'thanksgiving-8']) {
  test(`golden ${scenario}: deterministic plan and complete execution`, () => {
    const ctx = setup(scenario === 'thanksgiving-8' ? '2026-10-15T10:00:00-05:00' : undefined);
    try {
      const k = ctx.kitchen(scenario === 'thanksgiving-8' ? 2 : 1);
      const initial = ctx.service.planMeal(scenario === 'thanksgiving-8' ? thanksgivingIds : ['salmon', 'rice', 'green-beans'], scenario === 'thanksgiving-8' ? '16:00' : '18:30', k);
      if (scenario === 'salmon-delay') {
        const before = walk(ctx, initial.plan_id, p => p.steps.some(s => s.step_id === 'salmon:1' && s.status === 'running'));
        const result = ctx.service.reportDelay(initial.plan_id, 'salmon', 5);
        assert.equal(result.serve_at_local, '6:35 PM');
        assert.deepEqual(result.changed_steps.map(s => s.step_id).sort(), ['salmon:1', 'salmon:2']);
        assert.deepEqual(ctx.store.plan(initial.plan_id).steps.filter(s => s.dish_id !== 'salmon'), before.steps.filter(s => s.dish_id !== 'salmon'));
        assert.equal(ctx.service.reportDelay(initial.plan_id, 'salmon', 5).deduplicated, true);
      }
      if (scenario === 'swap') {
        const result = ctx.service.swapDish(initial.plan_id, 'green-beans', 'carrots');
        assert.equal(result.version, initial.version + 1);
        assert.equal(result.plan_id, initial.plan_id);
      }
      const plan = ctx.store.plan(initial.plan_id);
      assert.deepEqual(plan.warnings, []);
      const expected = JSON.parse(readFileSync(new URL(`./golden/${scenario}.json`, import.meta.url), 'utf8'));
      assert.deepEqual(normalized(plan), expected);
      const complete = walk(ctx, plan.plan_id);
      assert.ok(complete.steps.every(s => s.status === 'done'));
      assert.deepEqual(complete.warnings, []);
    } finally { ctx.store.close(); }
  });
}
