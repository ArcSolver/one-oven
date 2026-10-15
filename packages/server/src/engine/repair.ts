import { DomainError, order, type Dish, type Kitchen, type Plan, type Step } from './types.js';
import { place } from './schedule.js';
import { materializeOvenSteps, ovenFeasible } from './oven.js';
import { holdWarnings } from './changes.js';
import { verify } from './verify.js';

export function repair(steps: Step[], kitchen: Kitchen, now: number): Step[] {
  // Keep a still-feasible whole batch intact. Rebuilding it one recipe at a time
  // would temporarily lose its shared setpoint (for example 375 + 400 => 390).
  try {
    const unchanged = materializeOvenSteps(steps, kitchen, now).steps;
    if (unchanged.every(s => s.status !== 'pending' || s.start >= now)) {
      verify(unchanged, kitchen);
      return unchanged;
    }
  } catch {
    // Resource/dependency pressure requires the local repair below.
  }
  const fixed = steps.filter(s => s.status !== 'pending');
  // Check frozen resource use before allowing pending work to move.
  for (const t of fixed.flatMap(s => [s.start, s.end])) {
    const active = fixed.filter(s => s.start <= t && t < s.end);
    if (active.reduce((sum, s) => sum + s.hands, 0) > kitchen.helpers || active.reduce((sum, s) => sum + s.burners, 0) > kitchen.burners) throw new DomainError('conflict_frozen', 'Steps already started need the same cooking space. Finish one before changing this plan.');
  }
  for (let oven = 0; oven < kitchen.ovens.length; oven++) {
    if (!ovenFeasible(fixed, oven, kitchen.ovens[oven])) throw new DomainError('conflict_frozen', 'The oven is busy with steps already started. Finish one before changing this plan.');
  }
  const placed = [...fixed];
  for (const s of steps.filter(s => s.source === 'recipe' && s.status === 'pending').sort(order)) {
    const previous = placed.find(o => o.dish_id === s.dish_id && o.index === s.index - 1);
    placed.push(place(s, placed, kitchen, Math.max(s.start, now, previous?.end ?? -Infinity), 1, now));
  }
  const result = materializeOvenSteps(placed, kitchen, now).steps;
  verify(result, kitchen);
  return result;
}
export function refreshPlan(plan: Plan, steps: Step[], now: number, dishes: Dish[]): Plan {
  const serve = Math.max(plan.serve, ...steps.map(s => s.end));
  return { ...plan, steps, serve, version: plan.version + 1, updated_at: now,
    oven_segments: materializeOvenSteps(steps, plan.kitchen).oven_segments,
    warnings: holdWarnings(steps, serve, dishes) };
}
export function delay(plan: Plan, dishId: string, minutes: number, now: number, dishes: Dish[] = []): Plan {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 180) throw new DomainError('invalid_delay', 'Add between one and 180 whole minutes.');
  const steps = structuredClone(plan.steps);
  const target = steps.filter(s => s.dish_id === dishId && s.status !== 'done').sort(order)[0];
  if (!target) throw new DomainError('unknown_dish', 'That dish has no unfinished steps in this meal.');
  target.minutes += minutes;
  target.end += minutes;
  if (target.status === 'running' && target.end <= now) throw new DomainError('overdue_step', 'That step still ends in the past. Add more time or confirm it is done.');
  const revised = repair(steps, plan.kitchen, now);
  return refreshPlan(plan, revised, now, dishes);
}
