import { DomainError, order, overlap, type Dish, type Kitchen, type Step } from './types.js';
import { materializeOvenSteps, ovenFeasible, ovenSegments, setpoint, transitionMinutes } from './oven.js';

export function fits(s: Step, others: Step[], kitchen: Kitchen, floor = -Infinity): boolean {
  if (s.hands > kitchen.helpers || s.burners > kitchen.burners) return false;
  if (s.kind === 'oven' && (s.oven === undefined || !kitchen.ovens[s.oven] || (s.oven_units ?? 0) > kitchen.ovens[s.oven].capacity_units)) return false;
  const overlapping = others.filter(o => overlap(s, o));
  const points = [s.start, ...overlapping.flatMap(o => [o.start, o.end]).filter(t => t > s.start && t < s.end)];
  for (const t of points) {
    const active = overlapping.filter(o => o.start <= t && t < o.end);
    if (s.hands + active.reduce((sum, o) => sum + o.hands, 0) > kitchen.helpers) return false;
    if (s.burners + active.reduce((sum, o) => sum + o.burners, 0) > kitchen.burners) return false;
  }
  return s.kind !== 'oven' || ovenFeasible([...others, s], s.oven!, kitchen.ovens[s.oven!], floor);
}

export function place(s: Step, others: Step[], kitchen: Kitchen, anchor: number, direction: 1 | -1, floor = -Infinity): Step {
  const origin = direction === 1 ? anchor : anchor - s.minutes;
  const candidates = new Set<number>([origin]);
  for (const other of others) {
    candidates.add(other.start - s.minutes);
    candidates.add(other.end);
  }
  if (s.kind === 'oven') {
    kitchen.ovens.forEach((profile, oven) => {
      const segments = ovenSegments(others, oven, profile);
      const events = [...segments.map(seg => ({ ...seg, temperature: seg.setpoint_f })),
        ...others.filter(o => o.source !== 'recipe' && o.oven === oven).map(o => ({ ...o, temperature: o.setpoint_f! }))];
      const temperatures = [s.temperature_f!, ...others.filter(o => o.oven === oven && o.temperature_f !== undefined && Math.abs(o.temperature_f - s.temperature_f!) <= 25).map(o => setpoint([o.temperature_f!, s.temperature_f!]))];
      for (const target of temperatures) {
        if (Number.isFinite(floor)) candidates.add(floor + transitionMinutes(profile.ambient_f, target, profile));
        for (const event of events) {
          candidates.add(event.end + transitionMinutes(event.temperature, target, profile));
          candidates.add(event.start - transitionMinutes(target, event.temperature, profile) - s.minutes);
        }
      }
    });
  }
  const sorted = [...candidates].filter(t => Number.isFinite(t) && (direction === 1 ? t >= origin : t <= origin) && Math.abs(t - origin) <= 10080).sort((a, b) => direction * (a - b));
  for (const start of sorted) {
    for (let oven = 0; oven < (s.kind === 'oven' ? kitchen.ovens.length : 1); oven++) {
      const candidate = { ...s, start, end: start + s.minutes, ...(s.kind === 'oven' ? { oven } : {}) };
      if (fits(candidate, others, kitchen, floor)) return candidate;
    }
  }
  throw new DomainError('infeasible_kitchen', 'There is no room for this meal in your kitchen. Try fewer dishes or more cooking capacity.');
}
export function schedule(dishes: Dish[], kitchen: Kitchen, serve: number): Step[] {
  if (!dishes.length || new Set(dishes.map(d => d.dish_id)).size !== dishes.length) throw new DomainError('infeasible_kitchen', 'Choose different dishes for this meal.');
  const placed: Step[] = [];
  // Preserve caller dish priority and each recipe's precedence chain.
  for (const dish of dishes) {
    let deadline = serve;
    for (let index = dish.steps.length - 1; index >= 0; index--) {
      const step = place({ ...dish.steps[index], step_id: `${dish.dish_id}:${index}`, source: 'recipe',
        dish_id: dish.dish_id, index, start: 0, end: 0, status: 'pending' }, placed, kitchen, deadline, -1);
      placed.push(step);
      deadline = step.start;
    }
  }
  return materializeOvenSteps(placed, kitchen).steps.sort(order);
}
