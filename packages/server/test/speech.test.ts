import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, walk } from './helpers.js';

test('steps due in the same minute start together and the second one is spoken', () => {
  const ctx = setup();
  try {
    const plan = ctx.service.planMeal(['salmon', 'rice', 'green-beans'], '18:30', ctx.kitchen());
    ctx.service.swapDish(plan.plan_id, 'green-beans', 'carrots');
    // Walk until the carrots and the rice simmer are both due at 6:10 PM.
    walk(ctx, plan.plan_id, p => p.steps.find(s => s.step_id === 'salmon:1')?.status === 'running');
    ctx.setNow(Date.parse('2026-10-15T18:10:00-05:00') / 60000);
    const result = ctx.service.nextStep(plan.plan_id);
    const running = ctx.store.plan(plan.plan_id).steps.filter(s => s.status === 'running').map(s => s.step_id).sort();
    assert.deepEqual(running, ['carrots:0', 'rice:2', 'salmon:1']);
    assert.equal(result.say, 'Slice the carrots. Also, cook the covered rice gently.');
    assert.deepEqual(result.also_started.map(s => s.step_id), ['rice:2']);
    assert.ok(result.timer_suggestions?.some(t => t.step_id === 'rice:2'));
  } finally { ctx.store.close(); }
});

test('delay and swap replies describe the dish that changed and the serving time', () => {
  const ctx = setup();
  try {
    const plan = ctx.service.planMeal(['salmon', 'rice', 'green-beans'], '18:30', ctx.kitchen());
    const swap = ctx.service.swapDish(plan.plan_id, 'green-beans', 'carrots');
    assert.equal(swap.say, 'Glazed carrots replace green beans. Dinner is still at 6:30 PM.');
    walk(ctx, plan.plan_id, p => p.steps.find(s => s.step_id === 'salmon:1')?.status === 'running');
    const delay = ctx.service.reportDelay(plan.plan_id, 'salmon', 5);
    assert.equal(delay.say, 'Dinner moves to 6:35 PM. The lemon salmon gets 5 more minutes; the other dishes keep their times.');
  } finally { ctx.store.close(); }
});
