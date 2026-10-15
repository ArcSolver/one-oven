import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { DomainError, PlanSchema } from '@one-oven/contracts';
import { dishes } from '../src/dishes.js';
import { verifyPlan } from '../src/engine/verify.js';
import { setup } from './helpers.js';

test('1,000 random kitchens, dish subsets, delays and swaps satisfy independent invariants', () => {
  let planned = 0, delayed = 0, swapped = 0, rejected = 0;
  const acceptable = (error: unknown) => {
    assert.ok(error instanceof DomainError, String(error));
    assert.ok(['infeasible_kitchen', 'conflict_frozen'].includes(error.error_code), error.error_code);
    rejected++;
  };
  fc.assert(fc.property(
    fc.array(fc.integer({ min: 2, max: 6 }), { minLength: 1, maxLength: 2 }),
    fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 2 }),
    fc.shuffledSubarray(dishes.map(d => d.dish_id), { minLength: 1 }),
    fc.integer({ min: 1, max: 30 }), fc.nat(100), fc.nat(100),
    (capacities, burners, helpers, ids, minutes, progress, choice) => {
      const ctx = setup();
      const { service, store } = ctx;
      try {
        const k = service.setKitchen({ ovens: capacities.length, oven_profiles: capacities.map(capacity_units => ({ capacity_units })), burners, helpers, timezone: 'America/Chicago' });
        let result;
        try { result = service.planMeal(ids, new Date((ctx.now() + 1440) * 60000).toISOString(), k.kitchen_id); }
        catch (error) { acceptable(error); return; }
        planned++;
        let plan = store.plan(result.plan_id);
        verifyPlan(plan, dishes);
        PlanSchema.parse(plan);
        const first = plan.steps[0].start;
        ctx.setNow(first + Math.floor((plan.serve - first - 1) * progress / 100));
        for (const step of plan.steps) {
          if (step.start <= ctx.now()) {
            step.status = step.end <= ctx.now() ? 'done' : 'running';
            step.actual_start = step.start;
            if (step.status === 'done') step.actual_end = step.end;
          }
        }
        store.savePlan(plan);
        const unfinished = [...new Set(plan.steps.flatMap(s => s.dish_id && s.status !== 'done' ? [s.dish_id] : []))];
        const target = unfinished[choice % unfinished.length];
        if (target) {
          const before = structuredClone(plan);
          try {
            service.reportDelay(plan.plan_id, target, minutes, { allow_repeat: true });
            plan = store.plan(plan.plan_id);
            delayed++;
            verifyPlan(plan, dishes);
            for (const done of before.steps.filter(s => s.status === 'done')) assert.deepEqual(plan.steps.find(s => s.step_id === done.step_id), done);
            for (const running of before.steps.filter(s => s.status === 'running')) assert.equal(plan.steps.find(s => s.step_id === running.step_id)!.start, running.start);
          } catch (error) { acceptable(error); assert.deepEqual(store.plan(plan.plan_id), before); }
        }
        const replacement = dishes.find(d => !ids.includes(d.dish_id));
        if (replacement) {
          const before = store.plan(plan.plan_id);
          try {
            service.swapDish(plan.plan_id, ids[choice % ids.length], replacement.dish_id, { allow_repeat: true });
            swapped++;
            verifyPlan(store.plan(plan.plan_id), dishes);
          } catch (error) { acceptable(error); assert.deepEqual(store.plan(plan.plan_id), before); }
        }
      } finally { store.close(); }
    }), { numRuns: 1000, seed: 20261015, endOnFailure: true });
  console.log(JSON.stringify({ property_runs: 1000, seed: 20261015, planned, delayed, swapped, accepted_rejections: rejected, violations: 0 }));
});
