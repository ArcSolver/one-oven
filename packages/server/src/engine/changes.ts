import type { Dish, Step, Warning } from './types.js';
export function changes(before: Step[], after: Step[]) {
  const old = new Map(before.map(s => [s.step_id, s]));
  const next = new Map(after.map(s => [s.step_id, s]));
  return [...new Set([...old.keys(), ...next.keys()])].filter(id => JSON.stringify(old.get(id)) !== JSON.stringify(next.get(id)))
    .map(step_id => ({ step_id, dish_id: (next.get(step_id) ?? old.get(step_id))!.dish_id,
      before: old.get(step_id) ?? null, after: next.get(step_id) ?? null }));
}
export function holdWarnings(steps: Step[], serve: number, dishes: Dish[]): Warning[] {
  return dishes.flatMap(d => {
    const own = steps.filter(s => s.dish_id === d.dish_id);
    if (!own.length) return [];
    const hold_minutes = serve - Math.max(...own.map(s => s.end));
    return hold_minutes > d.hold_max_minutes ? [{ code: 'hold_exceeded' as const, dish_id: d.dish_id,
      hold_minutes, hold_max_minutes: d.hold_max_minutes }] : [];
  }).sort((a, b) => a.dish_id.localeCompare(b.dish_id));
}
