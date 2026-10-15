import { DomainError, order, overlap, type Kitchen, type OvenProfile, type OvenSegment, type Step } from './types.js';

export const transitionMinutes = (from: number, to: number, profile: OvenProfile) =>
  Math.ceil(Math.abs(to - from) / (to > from ? profile.preheat_f_per_min : profile.cool_f_per_min));
export const setpoint = (temperatures: number[]) => Math.round((Math.min(...temperatures) + Math.max(...temperatures)) / 10) * 5;

// An uninterrupted occupancy batch keeps one setpoint until the oven is empty.
export function ovenSegments(steps: Step[], oven: number, profile: OvenProfile): OvenSegment[] {
  const recipes = steps.filter(s => s.source === 'recipe' && s.kind === 'oven' && s.oven === oven && s.end > s.start).sort(order);
  const groups: Step[][] = [];
  for (const s of recipes) {
    const previous = groups.at(-1);
    const temperatures = [...(previous ?? []).map(p => p.temperature_f!), s.temperature_f!];
    const end = previous ? Math.max(...previous.map(p => p.end)) : -Infinity;
    if (previous && (s.start < end || (s.start === end && Math.max(...temperatures) - Math.min(...temperatures) <= 25))) previous.push(s);
    else groups.push([s]);
  }
  return groups.map(group => {
    const temperatures = group.map(s => s.temperature_f!);
    if (Math.max(...temperatures) - Math.min(...temperatures) > 25) throw new DomainError('infeasible_kitchen', 'The oven needs separate cooking times for these temperatures.');
    let peak = 0;
    for (const t of new Set(group.flatMap(s => [s.start, s.end]))) {
      peak = Math.max(peak, group.filter(s => s.start <= t && t < s.end).reduce((sum, s) => sum + s.oven_units!, 0));
    }
    if (peak > profile.capacity_units) throw new DomainError('infeasible_kitchen', 'The oven is full during this cooking time.');
    return { oven, start: Math.min(...group.map(s => s.start)), end: Math.max(...group.map(s => s.end)), setpoint_f: setpoint(temperatures), units_peak: peak };
  });
}

function timeline(steps: Step[], oven: number, profile: OvenProfile, floor: number): { segments: OvenSegment[]; systems: Step[] } {
  const segments = ovenSegments(steps, oven, profile);
  const fixed = steps.filter(s => s.source !== 'recipe' && s.status !== 'pending' && s.oven === oven).sort(order);
  const systems: Step[] = [...fixed];
  const events = [
    ...segments.map(segment => ({ start: segment.start, end: segment.end, target: segment.setpoint_f, segment })),
    ...fixed.map(step => ({ start: step.start, end: step.end, target: step.setpoint_f!, step })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  let temperature = profile.ambient_f;
  let available = -Infinity;
  let heated = false;
  const used = new Set(fixed.map(s => s.step_id));
  for (const event of events) {
    if (event.start < available) throw new DomainError('conflict_frozen', 'The oven is still busy with a step already started.');
    const minutes = transitionMinutes(temperature, event.target, profile);
    if ('step' in event) {
      if (event.end - event.start < minutes) throw new DomainError('conflict_frozen', 'The oven needs more time to reach its temperature.');
    } else if (minutes > 0 || !heated) {
      const start = event.start - minutes;
      if (start < available || start < floor) throw new DomainError('infeasible_kitchen', 'The oven needs more time to change temperature.');
      const source = heated ? 'transition' : 'preheat';
      let index = 1;
      while (used.has(`oven${oven}:${source}:${index}`)) index++;
      const step_id = `oven${oven}:${source}:${index}`;
      used.add(step_id);
      systems.push({ step_id, source, dish_id: null, index, text: `Set the oven to ${event.target}°F now.`,
        kind: 'oven', hands: 0, burners: 0, minutes, start, end: event.start, oven,
        setpoint_f: event.target, status: 'pending' });
    }
    temperature = event.target;
    available = event.end;
    heated = true;
  }
  // A frozen system interval may also collide with zero-length recipe groups.
  for (const system of fixed) {
    if (steps.some(s => s.source === 'recipe' && s.oven === oven && overlap(s, system))) throw new DomainError('conflict_frozen', 'The oven is still changing temperature.');
  }
  return { segments, systems };
}
export function ovenFeasible(steps: Step[], oven: number, profile: OvenProfile, floor = -Infinity): boolean {
  try { timeline(steps, oven, profile, floor); return true; }
  catch (error) { if (error instanceof DomainError) return false; throw error; }
}
export function materializeOvenSteps(steps: Step[], kitchen: Kitchen, floor = -Infinity): { steps: Step[]; oven_segments: OvenSegment[] } {
  const recipes = steps.filter(s => s.source === 'recipe');
  const systems: Step[] = [];
  const oven_segments: OvenSegment[] = [];
  kitchen.ovens.forEach((profile, oven) => {
    const result = timeline(steps, oven, profile, floor);
    systems.push(...result.systems);
    oven_segments.push(...result.segments);
  });
  return { steps: [...recipes, ...systems].sort(order), oven_segments };
}
