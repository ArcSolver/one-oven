import { randomUUID } from 'node:crypto';
import { assertSpeech, DomainError, KitchenSchema, MutationOptionsSchema, OvenProfileSchema, PlanSchema,
  type Kitchen, type MutationOptions, type Plan, type ScheduledStep as Step, type ToolEnvelope } from '@one-oven/contracts';
import { dish, dishes } from './dishes.js';
import { changes, delay, holdWarnings, materializeOvenSteps, order, refreshPlan, repair, schedule, verifyPlan } from './engine.js';
import { iso, localTime, servingTime } from './engine/time.js';
import { Store } from './store.js';
import { argsHash, explicitKey, type SavedResponse } from './store/idempotency.js';
import * as say from './say.js';
export { iso } from './engine/time.js';
type KitchenInput = { ovens: number; burners: number; helpers: number; timezone: string;
  oven_profiles?: Partial<Kitchen['ovens'][number]>[] };
type Outcome<T> = { data: T; plan?: Plan };

export class Service {
  readonly now: () => number;
  readonly requestNow: () => number;
  constructor(readonly store: Store, now?: () => number, requestNow?: () => number) {
    this.now = now ?? (() => Math.ceil(Date.now() / 60000));
    this.requestNow = requestNow ?? (now ? () => now() * 60000 : Date.now);
  }
  private mutate<T extends SavedResponse>(tool: string, args: Record<string, unknown>, options: MutationOptions,
    planId: string | undefined, operation: (plan?: Plan) => Outcome<T>): T & { deduplicated?: boolean; request_id?: string } {
    MutationOptionsSchema.parse(options);
    const hash = argsHash({ ...args, based_on_version: options.based_on_version, allow_repeat: options.allow_repeat ?? false });
    const at = this.requestNow();
    const key = options.request_id ? explicitKey(this.store.householdId, options.request_id) : `implicit:${randomUUID()}`;
    return this.store.transaction(() => {
      if (options.request_id) {
        const saved = this.store.explicit(key);
        if (saved) {
          if (saved.tool !== tool || saved.args_hash !== hash) throw new DomainError('request_id_reused', 'That request was already used for a different action. Try a new request.');
          return { ...JSON.parse(saved.response), deduplicated: true };
        }
      }
      const before = planId ? this.store.plan(planId) : undefined;
      if (!options.request_id && !options.allow_repeat) {
        const saved = this.store.recent(tool, hash, at).find(record => {
          if (record.plan_id) {
            try { return this.store.plan(record.plan_id).version === record.result_version; } catch { return false; }
          }
          return true;
        });
        if (saved) {
          const data = JSON.parse(saved.response);
          const replay = { ...data, deduplicated: true,
            ...(tool === 'report_delay' ? { say: say.repeatedDelay(String(args.dish_id), Number(args.minutes)) } : {}) };
          assertSpeech(replay.say);
          return replay;
        }
      }
      if (options.based_on_version !== undefined && options.based_on_version !== before?.version) {
        throw new DomainError('version_conflict', 'This meal has changed. Ask for the next step and try again.', before?.version);
      }
      const outcome = operation(before);
      const data = { ...outcome.data, ...(options.request_id ? { request_id: options.request_id } : {}), deduplicated: false };
      assertSpeech(data.say);
      const timers = (data as ToolEnvelope).timer_suggestions ?? [];
      timers.forEach(timer => assertSpeech(timer.say));
      if (outcome.plan && outcome.plan.version !== before?.version) {
        PlanSchema.parse(outcome.plan);
        verifyPlan(outcome.plan, dishes);
        this.store.savePlan(outcome.plan);
        this.store.appendEvent(before, outcome.plan, tool, key, at);
      }
      this.store.remember({ request_key: key, household_id: this.store.householdId, tool, args_hash: hash,
        plan_id: data.plan_id ?? null, result_version: data.version ?? null, response: JSON.stringify(data), created_at: at });
      return data;
    });
  }
  setKitchen(input: KitchenInput, options: MutationOptions = {}) {
    if (!Number.isInteger(input.ovens) || input.ovens < 0 || input.ovens > 4 || (input.oven_profiles?.length ?? 0) > input.ovens) throw new DomainError('infeasible_kitchen', 'Match each oven profile to an available oven.');
    const kitchen = KitchenSchema.parse({ ovens: Array.from({ length: input.ovens }, (_, i) => OvenProfileSchema.parse(input.oven_profiles?.[i] ?? {})),
      burners: input.burners, helpers: input.helpers, timezone: input.timezone });
    return this.mutate('set_kitchen', { kitchen }, options, undefined, () => {
      const kitchen_id = randomUUID();
      this.store.saveKitchen(kitchen_id, kitchen, this.requestNow());
      const capacity = kitchen.ovens.map(o => o.capacity_units).join(', ');
      return { data: { kitchen_id, kitchen, say: kitchen.ovens.length
        ? `Your kitchen has ${kitchen.ovens.length} ${kitchen.ovens.length === 1 ? 'oven' : 'ovens'}, with capacity ${capacity} pans respectively.`
        : 'Your kitchen is ready for stovetop meals.', display: kitchen } };
    });
  }
  listDishes(course?: string, max?: number) {
    const list = dishes.filter(d => (!course || d.course === course) && (!max || d.steps.reduce((sum, s) => sum + s.minutes, 0) <= max))
      .map(d => ({ dish_id: d.dish_id, name: d.name, active_min: d.steps.reduce((sum, s) => sum + (s.hands ? s.minutes : 0), 0),
        total_min: d.steps.reduce((sum, s) => sum + s.minutes, 0), oven_temp_f: d.steps.find(s => s.kind === 'oven')?.temperature_f ?? null,
        oven_units_max: Math.max(0, ...d.steps.map(s => s.oven_units ?? 0)), hold_max_minutes: d.hold_max_minutes, tags: d.tags }));
    return { dishes: list, say: `I found ${list.length} dishes for your kitchen.`, display: { dishes: list } };
  }
  planMeal(ids: string[], serveAt: string, kitchenId: string, options: MutationOptions = {}) {
    const normalizedTime = /^\d{4}-/.test(serveAt) && Number.isFinite(Date.parse(serveAt)) ? new Date(serveAt).toISOString() : serveAt;
    return this.mutate('plan_meal', { dish_ids: ids, serve_at: normalizedTime, kitchen_id: kitchenId }, options, undefined, () => {
      const kitchen = this.store.kitchen(kitchenId);
      const now = this.now();
      const serve = servingTime(serveAt, kitchen.timezone, now);
      const steps = schedule(ids.map(dish), kitchen, serve);
      if (steps[0].start < now) throw new DomainError('not_enough_time', `There is not enough time. This meal needs to start at ${localTime(steps[0].start, kitchen.timezone)}.`);
      const plan: Plan = { plan_id: randomUUID(), household_id: this.store.householdId, kitchen_id: kitchenId, kitchen,
        version: 1, serve_requested: serve, serve, steps, oven_segments: materializeOvenSteps(steps, kitchen).oven_segments,
        warnings: holdWarnings(steps, serve, dishes), created_at: now, updated_at: now, schema: 2 };
      return { plan, data: { ...this.present(plan), first_step: this.step(steps[0]), start_at: iso(steps[0].start), say: say.instruction(steps[0], now, kitchen.timezone) } };
    });
  }
  private eligible(step: Step, plan: Plan): boolean {
    if (step.source === 'recipe' && plan.steps.some(s => s.dish_id === step.dish_id && s.index < step.index && s.status !== 'done')) return false;
    if (step.kind === 'oven') {
      return !plan.steps.some(s => s.step_id !== step.step_id && s.oven === step.oven && s.end <= step.start && s.status !== 'done');
    }
    return true;
  }
  nextStep(id: string, done?: string, options: MutationOptions = {}, startStepId?: string) {
    return this.mutate('next_step', { plan_id: id, done_step_id: done, start_step_id: startStepId }, options, id, original => {
      const plan = structuredClone(original!);
      const before = structuredClone(plan.steps);
      const now = this.now();
      if (done) {
        const step = plan.steps.find(s => s.step_id === done);
        if (!step || step.status === 'pending') throw new DomainError('step_not_running', 'Only a step already in progress can be completed.');
        if (step.status === 'done') return { data: { ...this.present(plan), step: null, upcoming: [], changed_steps: [], say: 'That step is already complete.' } };
        if (now < step.start) throw new DomainError('conflict_frozen', 'The clock is earlier than this step. Check the kitchen time.');
        step.status = 'done';
        step.end = now;
        step.minutes = now - step.start;
        step.actual_end = now;
      }
      if (startStepId) {
        if (done) throw new DomainError('step_not_running', 'Complete the current step before starting another early.');
        if (plan.steps.some(s => s.status === 'running' && s.end <= now)) throw new DomainError('overdue_step', 'A step is overdue. Complete it or add more time first.');
        const step = plan.steps.find(s => s.step_id === startStepId);
        if (!step || step.status !== 'pending' || !this.eligible(step, plan)) throw new DomainError('step_not_running', 'Finish the earlier steps before starting this one.');
        step.start = now;
        step.end = now + step.minutes;
        step.status = 'running';
        step.actual_start = now;
      }
      plan.steps = repair(plan.steps, plan.kitchen, now);
      const overdue = plan.steps.some(s => s.status === 'running' && s.end <= now);
      if (overdue && !done) throw new DomainError('overdue_step', 'A step is overdue. Complete it or add more time first.');
      let next = startStepId ? plan.steps.find(s => s.step_id === startStepId) : undefined;
      if (!overdue && !next) {
        next = plan.steps.filter(s => s.status === 'pending' && this.eligible(s, plan)).sort(order)[0];
        if (next && next.start <= now) { next.status = 'running'; next.actual_start = now; }
      }
      const changed = changes(before, plan.steps);
      const updated = changed.length ? refreshPlan(plan, plan.steps, now, dishes) : plan;
      const upcoming = updated.steps.filter(s => s.status === 'pending' && s.step_id !== next?.step_id).sort(order).slice(0, 2).map(s => this.step(s));
      const speech = overdue ? 'Step complete. Confirm the other finished steps or add more time.'
        : next ? say.instruction(next, now, plan.kitchen.timezone)
        : plan.steps.some(s => s.status !== 'done') ? 'Finish the steps already in progress, then tell me when they are done.'
        : 'All steps are complete. Your meal is ready.';
      return { plan: updated, data: { ...this.present(updated), step: next ? this.step(next) : null, upcoming, changed_steps: changed, say: speech } };
    });
  }
  reportDelay(id: string, dishId: string, minutes: number, options: MutationOptions = {}) {
    return this.mutate('report_delay', { plan_id: id, dish_id: dishId, minutes }, options, id, old => {
      const plan = delay(old!, dishId, minutes, this.now(), dishes);
      const changed = changes(old!.steps, plan.steps);
      const summary = say.changesSummary(changed);
      return { plan, data: { ...this.present(plan), new_serve_at: iso(plan.serve), changed_steps: changed,
        changes_summary: summary, say: say.delayed(plan.serve, plan.kitchen, summary) } };
    });
  }
  swapDish(id: string, oldId: string, replacement: string, options: MutationOptions = {}) {
    return this.mutate('swap_dish', { plan_id: id, dish_id: oldId, replacement_id: replacement }, options, id, old => {
      dish(replacement);
      const removed = old!.steps.filter(s => s.dish_id === oldId);
      if (!removed.length) throw new DomainError('unknown_dish', 'That dish is not in this meal. Choose a dish from your plan.');
      if (removed.some(s => s.status !== 'pending')) throw new DomainError('conflict_frozen', 'Only a dish that has not started can be replaced.');
      if (old!.steps.some(s => s.dish_id === replacement)) throw new DomainError('unknown_dish', 'That replacement is already in this meal. Choose a different dish.');
      const added = schedule([dish(replacement)], old!.kitchen, old!.serve).filter(s => s.source === 'recipe');
      const steps = repair([...old!.steps.filter(s => s.dish_id !== oldId), ...added], old!.kitchen, this.now());
      const plan = refreshPlan(old!, steps, this.now(), dishes);
      return { plan, data: { ...this.present(plan), changed_steps: changes(old!.steps, steps), removed_step_ids: removed.map(s => s.step_id),
        say: `The replacement is planned. ${say.dinner(plan.serve, plan.kitchen)}` } };
    });
  }
  step(step: Step) {
    return { ...step, start_at: iso(step.start), end_at: iso(step.end), resource: { hands: step.hands,
      burners: step.burners, oven: step.oven ?? null, temperature_f: step.temperature_f ?? step.setpoint_f ?? null } };
  }
  present(plan: Plan) {
    const holds = [...new Set(plan.steps.flatMap(s => s.dish_id ? [s.dish_id] : []))].map(id => {
      const ready = Math.max(...plan.steps.filter(s => s.dish_id === id).map(s => s.end));
      return { dish_id: id, ready_at: iso(ready), hold_minutes: plan.serve - ready, hold_max_minutes: dish(id).hold_max_minutes };
    });
    return { plan_id: plan.plan_id, kitchen_id: plan.kitchen_id, version: plan.version, serve_at: iso(plan.serve),
      serve_at_local: localTime(plan.serve, plan.kitchen.timezone), say: say.dinner(plan.serve, plan.kitchen),
      oven_segments: plan.oven_segments, warnings: plan.warnings,
      display: { steps: plan.steps.map(s => this.step(s)), dishes: holds, oven_segments: plan.oven_segments, warnings: plan.warnings },
      timer_suggestions: plan.steps.filter(s => s.status === 'running').map(s => ({ step_id: s.step_id,
        label: s.dish_id ? dish(s.dish_id).name : s.source === 'preheat' ? 'Oven preheat' : 'Oven temperature change',
        minutes: Math.max(0, s.end - this.now()), ends_at: iso(s.end), say: `Set a timer for ${Math.max(0, s.end - this.now())} minutes.` })) };
  }
}
