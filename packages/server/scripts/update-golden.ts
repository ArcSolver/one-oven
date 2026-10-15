import { mkdirSync, writeFileSync } from 'node:fs';
import { setup, thanksgivingIds, walk } from '../test/helpers.js';
for (const scenario of ['weekday-3', 'salmon-delay', 'swap', 'thanksgiving-8']) {
  const ctx = setup(scenario === 'thanksgiving-8' ? '2026-10-15T10:00:00-05:00' : undefined);
  try {
    const k = ctx.kitchen(scenario === 'thanksgiving-8' ? 2 : 1);
    const result = ctx.service.planMeal(scenario === 'thanksgiving-8' ? thanksgivingIds : ['salmon', 'rice', 'green-beans'], scenario === 'thanksgiving-8' ? '16:00' : '18:30', k);
    if (scenario === 'salmon-delay') {
      walk(ctx, result.plan_id, p => p.steps.some(s => s.step_id === 'salmon:1' && s.status === 'running'));
      ctx.service.reportDelay(result.plan_id, 'salmon', 5);
    }
    if (scenario === 'swap') ctx.service.swapDish(result.plan_id, 'green-beans', 'carrots');
    const plan = { ...ctx.store.plan(result.plan_id), plan_id: 'fixture-plan', kitchen_id: 'fixture-kitchen' };
    mkdirSync(new URL('../test/golden/', import.meta.url), { recursive: true });
    writeFileSync(new URL(`../test/golden/${scenario}.json`, import.meta.url), JSON.stringify(plan, null, 2) + '\n');
  } finally { ctx.store.close(); }
}
