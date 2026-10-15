import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultOven, type Kitchen, type Dish, type Plan } from '@one-oven/contracts';
import { schedule } from '../src/engine/schedule.js';
import { delay } from '../src/engine/repair.js';
import { materializeOvenSteps } from '../src/engine/oven.js';
import { verify, verifyPlan } from '../src/engine/verify.js';
import { holdWarnings } from '../src/engine/changes.js';
import { loadDishes } from '../src/data/load.js';
export const catalogue = loadDishes();
export const kitchen: Kitchen = { ovens: [defaultOven()], burners: 4, helpers: 1, timezone: 'America/Chicago' };
export const fixture = (id: string) => catalogue.find(d => d.dish_id === id)!;
export function makePlan(ids: string[], k = kitchen, serve = 1000): Plan {
  const steps = schedule(ids.map(fixture), k, serve);
  return { plan_id: 'p', household_id: 'local', kitchen_id: 'k', kitchen: k, version: 1,
    serve, serve_requested: serve, steps, oven_segments: materializeOvenSteps(steps, k).oven_segments,
    warnings: holdWarnings(steps, serve, catalogue), created_at: 0, updated_at: 0, schema: 2 };
}
test('preheat is the first salmon action and completes before roasting', () => {
  const p = makePlan(['salmon']);
  verifyPlan(p, catalogue);
  assert.equal(p.steps[0].source, 'preheat');
  assert.equal(p.steps[0].minutes, 14);
  assert.ok(p.steps[0].end <= p.steps.find(s => s.step_id === 'salmon:1')!.start);
});
test('temperature transitions include heating and cooling, excluding food', () => {
  for (const temperatures of [[325, 400], [425, 325]]) {
    const data: Dish[] = temperatures.map((temperature_f, i) => ({ ...fixture('potatoes'), dish_id: `d${i}`,
      steps: [{ text: 'Roast the food.', minutes: 10, hands: 0, burners: 0, kind: 'oven', temperature_f, oven_units: 4 }] }));
    const steps = schedule(data, kitchen, 1000);
    verify(steps, kitchen, 1000);
    const transition = steps.find(s => s.source === 'transition')!;
    const before = steps.filter(s => s.source === 'recipe').sort((a,b) => a.start-b.start);
    const difference = before[1].temperature_f! - before[0].temperature_f!;
    assert.equal(transition.minutes, Math.ceil(Math.abs(difference) / (difference > 0 ? 25 : 10)));
  }
});
test('capacity two serializes two pans; capacity four permits a shared midpoint', () => {
  const k = { ...kitchen, ovens: [{ ...defaultOven(), capacity_units: 2 }] };
  const p = makePlan(['potatoes', 'stuffing'], k);
  verifyPlan(p, catalogue);
  const oven = p.steps.filter(s => s.source === 'recipe' && s.kind === 'oven');
  assert.ok(oven[0].end <= oven[1].start || oven[1].end <= oven[0].start);
  const shared = makePlan(['potatoes', 'stuffing']);
  assert.equal(shared.oven_segments.length, 1);
  assert.equal(shared.oven_segments[0].setpoint_f, 390);
  assert.equal(shared.oven_segments[0].units_peak, 4);
  verifyPlan(shared, catalogue);
});
test('Thanksgiving oven handoff and all demo hold limits', () => {
  const ids = ['turkey', 'potatoes', 'stuffing', 'salmon', 'rice', 'green-beans', 'carrots', 'gravy'];
  const p = makePlan(ids, { ...kitchen, helpers: 2 });
  verifyPlan(p, catalogue);
  assert.deepEqual(p.warnings, []);
  const roast = p.steps.find(s => s.step_id === 'turkey:1')!;
  const carve = p.steps.find(s => s.step_id === 'turkey:3')!;
  for (const id of ['potatoes:1', 'stuffing:1']) {
    const step = p.steps.find(s => s.step_id === id)!;
    assert.ok(step.start >= roast.end && step.end <= carve.end);
  }
  const p1 = makePlan(['salmon', 'rice', 'green-beans']);
  const now = p1.steps.find(s => s.step_id === 'salmon:1')!.start;
  p1.steps.forEach(s => { if (s.start < now) s.status = s.end <= now ? 'done' : 'running'; });
  p1.steps.find(s => s.step_id === 'salmon:1')!.status = 'running';
  const after = delay(p1, 'salmon', 5, now, catalogue);
  verifyPlan(after, catalogue);
  assert.equal(after.serve, 1005);
  assert.deepEqual(after.warnings, []);
  assert.deepEqual(after.steps.filter(s => s.dish_id !== 'salmon'), p1.steps.filter(s => s.dish_id !== 'salmon'));
});
