export type Kitchen = { ovens: number; burners: number; helpers: number };
export type RecipeStep = { text: string; minutes: number; hands: number; burners: number; temperature?: number };
export type Dish = { dish_id: string; name: string; course: string; steps: RecipeStep[] };
export type Step = RecipeStep & { step_id: string; dish_id: string; index: number; start: number; end: number; oven?: number; status: 'pending' | 'running' | 'done' };
export type Plan = { plan_id: string; kitchen_id: string; kitchen: Kitchen; version: number; serve: number; steps: Step[] };
const overlap = (a: Step, b: Step) => a.start < b.end && b.start < a.end;
export function fits(s: Step, others: Step[], k: Kitchen): boolean {
  if (s.hands > k.helpers || s.burners > k.burners || (s.temperature !== undefined && (s.oven === undefined || s.oven >= k.ovens))) return false;
  const overlapping = others.filter(o => overlap(s, o));
  const points = [s.start, ...overlapping.flatMap(o => [o.start, o.end]).filter(t => t > s.start && t < s.end)];
  return points.every(t => {
    const active = overlapping.filter(o => o.start <= t && t < o.end);
    if (s.hands + active.reduce((n,o) => n + o.hands,0) > k.helpers || s.burners + active.reduce((n,o) => n + o.burners,0) > k.burners) return false;
    if (s.temperature === undefined) return true;
    const temps = [s.temperature, ...active.filter(o => o.oven === s.oven && o.temperature !== undefined).map(o => o.temperature!)];
    return Math.max(...temps) - Math.min(...temps) <= 25;
  });
}
function place(s: Step, others: Step[], k: Kitchen, anchor: number, direction: 1 | -1): Step {
  for (let offset = 0; offset <= 10080; offset++) {
    const start = direction === 1 ? anchor + offset : anchor - s.minutes - offset;
    for (let oven = 0; oven < (s.temperature === undefined ? 1 : k.ovens); oven++) {
      const candidate = { ...s, start, end: start + s.minutes, oven: s.temperature === undefined ? undefined : oven };
      if (fits(candidate, others, k)) return candidate;
    }
  }
  throw new Error('No feasible schedule within seven days. Check kitchen capacity.');
}
export function schedule(dishes: Dish[], kitchen: Kitchen, serve: number): Step[] {
  if (!dishes.length || new Set(dishes.map(d => d.dish_id)).size !== dishes.length) throw new Error('Choose distinct dishes.');
  const placed: Step[] = [];
  // Reverse serial list scheduling; each recipe is a precedence chain.
  for (const dish of dishes) {
    let deadline = serve;
    for (let index = dish.steps.length - 1; index >= 0; index--) {
      const s = place({ ...dish.steps[index], step_id: `${dish.dish_id}:${index}`, dish_id: dish.dish_id, index, start: 0, end: 0, status: 'pending' }, placed, kitchen, deadline, -1);
      placed.push(s); deadline = s.start;
    }
  }
  return placed.sort(order);
}
export const order = (a: Step,b: Step) => a.start - b.start || a.step_id.localeCompare(b.step_id);
export function validate(steps: Step[], k: Kitchen): void {
  for (const s of steps) {
    if (s.end - s.start !== s.minutes || !fits(s, steps.filter(o => o !== s), k)) throw new Error(`Resource or duration violation: ${s.step_id}`);
    const previous = steps.find(o => o.dish_id === s.dish_id && o.index === s.index - 1);
    if (previous && previous.end > s.start) throw new Error(`Precedence violation: ${s.step_id}`);
  }
}
export function repair(steps: Step[], kitchen: Kitchen, now: number): Step[] {
  const fixed = steps.filter(s => s.status !== 'pending');
  validate(fixed, kitchen);
  const placed = [...fixed];
  // Keep original order and times unless dependency, clock or resource pressure requires a move.
  for (const s of steps.filter(s => s.status === 'pending').sort(order)) {
    const previous = placed.find(o => o.dish_id === s.dish_id && o.index === s.index - 1);
    placed.push(place(s, placed, kitchen, Math.max(s.start, now, previous?.end ?? -Infinity), 1));
  }
  validate(placed, kitchen);
  return placed.sort(order);
}
export function delay(plan: Plan, dishId: string, minutes: number, now: number): Plan {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 180) throw new Error('Delay must be 1–180 whole minutes.');
  const steps = structuredClone(plan.steps);
  const target = steps.filter(s => s.dish_id === dishId && s.status !== 'done').sort(order)[0];
  if (!target) throw new Error('This dish has no unfinished steps.');
  target.minutes += minutes; target.end += minutes;
  if (target.status === 'running' && target.end <= now) throw new Error('The added time still ends in the past. Report enough additional time or complete the step.');
  const repaired = repair(steps, plan.kitchen, now);
  return { ...plan, version: plan.version + 1, steps: repaired, serve: Math.max(plan.serve, ...repaired.map(s => s.end)) };
}
export function changes(before: Step[], after: Step[]) {
  return after.filter(s => { const old = before.find(o => o.step_id === s.step_id); return !old || old.start !== s.start || old.end !== s.end || old.status !== s.status || old.oven !== s.oven; }).map(s => ({ step_id: s.step_id, dish_id: s.dish_id, before: before.find(o => o.step_id === s.step_id) ?? null, after: s }));
}
