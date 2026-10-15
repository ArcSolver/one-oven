import type { Dish, Kitchen, Plan, Step } from './types.js';

// Independent sweep: deliberately does not call fits(), ovenFeasible(), or materializeOvenSteps().
export function verify(steps: Step[], kitchen: Kitchen, serve = Infinity): void {
  const require = (condition: boolean, message: string) => { if (!condition) throw new Error(`Schedule violation: ${message}`); };
  require(new Set(steps.map(s => s.step_id)).size === steps.length, 'unique IDs');
  const boundaries = [...new Set(steps.flatMap(s => [s.start, s.end]))].sort((a, b) => a - b);
  for (const s of steps) {
    require(Number.isInteger(s.start) && Number.isInteger(s.end) && s.end - s.start === s.minutes && s.minutes >= 0, 'duration');
    require(s.end <= serve, 'serving deadline');
    if (s.kind === 'oven') require(s.oven !== undefined && Number.isInteger(s.oven) && s.oven >= 0 && s.oven < kitchen.ovens.length, 'oven assignment');
    if (s.source === 'recipe') {
      const previous = steps.find(o => o.dish_id === s.dish_id && o.index === s.index - 1);
      require(!previous || previous.end <= s.start, 'precedence');
    } else require(s.dish_id === null && s.hands === 0 && s.burners === 0, 'system resources');
  }
  for (let i = 0; i + 1 < boundaries.length; i++) {
    const t = (boundaries[i] + boundaries[i + 1]) / 2;
    const active = steps.filter(s => s.start <= t && t < s.end);
    require(active.reduce((sum, s) => sum + s.hands, 0) <= kitchen.helpers, 'hands');
    require(active.reduce((sum, s) => sum + s.burners, 0) <= kitchen.burners, 'burners');
    kitchen.ovens.forEach((profile, oven) => {
      const occupants = active.filter(s => s.oven === oven);
      const recipes = occupants.filter(s => s.source === 'recipe');
      const systems = occupants.filter(s => s.source !== 'recipe');
      require(systems.length <= 1 && (!systems.length || !recipes.length), 'system overlap');
      require(recipes.reduce((sum, s) => sum + (s.oven_units ?? Infinity), 0) <= profile.capacity_units, 'oven capacity');
      if (recipes.length) {
        const temperatures = recipes.map(s => s.temperature_f!);
        require(Math.max(...temperatures) - Math.min(...temperatures) <= 25, 'temperature range');
        const last = steps.filter(s => s.source !== 'recipe' && s.oven === oven && s.end <= t).sort((a, b) => b.end - a.end)[0];
        require(Boolean(last), 'preheat before use');
        if (last) require(temperatures.every(temp => Math.abs(temp - last.setpoint_f!) <= 15), 'heated setpoint');
      }
    });
  }
  kitchen.ovens.forEach((profile, oven) => {
    let temperature = profile.ambient_f;
    const systems = steps.filter(s => s.source !== 'recipe' && s.oven === oven).sort((a, b) => a.start - b.start);
    for (const [index, s] of systems.entries()) {
      require(s.source === (index === 0 ? 'preheat' : 'transition'), 'thermal step kind');
      const target = s.setpoint_f!;
      const required = Math.ceil(Math.abs(target - temperature) / (target > temperature ? profile.preheat_f_per_min : profile.cool_f_per_min));
      require(s.minutes >= required, 'thermal duration');
      temperature = target;
    }
    // Independently reconstruct occupancy batches and check their precise midpoint setpoints.
    const recipes = steps.filter(s => s.source === 'recipe' && s.oven === oven && s.minutes > 0).sort((a, b) => a.start - b.start);
    let batch: Step[] = [];
    const checkBatch = () => {
      if (!batch.length) return;
      const temps = batch.map(s => s.temperature_f!);
      const target = Math.round((Math.min(...temps) + Math.max(...temps)) / 10) * 5;
      const start = Math.min(...batch.map(s => s.start));
      const system = systems.filter(s => s.end <= start).at(-1);
      require(system?.setpoint_f === target, 'batch midpoint setpoint');
    };
    for (const s of recipes) {
      const temps = [...batch.map(b => b.temperature_f!), s.temperature_f!];
      const end = Math.max(...batch.map(b => b.end));
      if (batch.length && (s.start > end || (s.start === end && Math.max(...temps) - Math.min(...temps) > 25))) { checkBatch(); batch = []; }
      batch.push(s);
    }
    checkBatch();
  });
}
export function verifyPlan(plan: Plan, dishes: Dish[]): void {
  verify(plan.steps, plan.kitchen, plan.serve);
  const expected = dishes.flatMap(d => {
    const own = plan.steps.filter(s => s.dish_id === d.dish_id);
    if (!own.length) return [];
    const hold = plan.serve - Math.max(...own.map(s => s.end));
    return hold > d.hold_max_minutes ? [{ code: 'hold_exceeded', dish_id: d.dish_id, hold_minutes: hold, hold_max_minutes: d.hold_max_minutes }] : [];
  }).sort((a, b) => a.dish_id.localeCompare(b.dish_id));
  if (JSON.stringify(expected) !== JSON.stringify(plan.warnings)) throw new Error('Schedule violation: hold warnings');
  const expectedSegments: Plan['oven_segments'] = [];
  plan.kitchen.ovens.forEach((_, oven) => {
    const recipes = plan.steps.filter(s => s.source === 'recipe' && s.oven === oven && s.minutes > 0).sort((a, b) => a.start - b.start);
    let batch: Step[] = [];
    const finish = () => {
      if (!batch.length) return;
      const temps = batch.map(s => s.temperature_f!);
      expectedSegments.push({ oven, start: Math.min(...batch.map(s => s.start)), end: Math.max(...batch.map(s => s.end)),
        setpoint_f: Math.round((Math.min(...temps) + Math.max(...temps)) / 10) * 5,
        units_peak: Math.max(...batch.map(s => batch.filter(o => o.start <= s.start && s.start < o.end).reduce((sum, o) => sum + o.oven_units!, 0))) });
    };
    for (const s of recipes) {
      const end = Math.max(...batch.map(b => b.end));
      const temps = [...batch.map(b => b.temperature_f!), s.temperature_f!];
      if (batch.length && (s.start > end || (s.start === end && Math.max(...temps) - Math.min(...temps) > 25))) { finish(); batch = []; }
      batch.push(s);
    }
    finish();
  });
  const tuples = (segments: Plan['oven_segments']) => segments.map(s => [s.oven, s.setpoint_f, s.start, s.end, s.units_peak]);
  if (JSON.stringify(tuples(expectedSegments)) !== JSON.stringify(tuples(plan.oven_segments))) throw new Error('Schedule violation: oven segments');
}
export const validate = verify;
