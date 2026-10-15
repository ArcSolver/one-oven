import { defaultOven, KitchenSchema, PlanSchema, type Kitchen, type Plan, type ScheduledStep } from '@one-oven/contracts';
import { materializeOvenSteps } from '../engine/oven.js';
import { holdWarnings } from '../engine/changes.js';
import { repair } from '../engine/repair.js';
import { loadDishes } from '../data/load.js';

export function upgradeKitchen(input: unknown): Kitchen {
  const k = input as Kitchen & { ovens: number | Kitchen['ovens'] };
  return KitchenSchema.parse({ ...k, ovens: typeof k.ovens === 'number' ? Array.from({ length: k.ovens }, defaultOven) : k.ovens,
    timezone: k.timezone ?? 'America/Chicago' });
}
export function upgradePlan(input: unknown): Plan {
  const old = input as Plan;
  if (old.schema === 2) return PlanSchema.parse(old);
  const kitchen = upgradeKitchen(old.kitchen);
  const recipes = loadDishes();
  const steps: ScheduledStep[] = old.steps.map(raw => {
    const legacy = raw as typeof raw & { temperature?: number };
    const { temperature, ...s } = legacy;
    const recipe = recipes.find(d => d.dish_id === s.dish_id)?.steps[s.index];
    return { ...s, source: 'recipe', kind: temperature !== undefined ? 'oven' : recipe?.kind ?? (s.burners ? 'stove' : s.hands ? 'prep' : 'rest'),
      ...(temperature === undefined ? {} : { temperature_f: temperature, oven_units: recipe?.oven_units ?? 1 }) };
  });
  // Keep feasible legacy times. Older pending plans may need new thermal gaps;
  // repair those forward, retaining any frozen recipe work. Inferred heating is
  // never represented as a measured action.
  let thermal: ReturnType<typeof materializeOvenSteps>;
  try {
    thermal = materializeOvenSteps(steps, kitchen);
  } catch {
    const repaired = repair(steps, kitchen, Math.min(...steps.map(s => s.start)) - 10080);
    thermal = materializeOvenSteps(repaired, kitchen);
  }
  for (const s of thermal.steps.filter(s => s.source !== 'recipe')) {
    const following = steps.filter(r => r.oven === s.oven && r.start >= s.end).sort((a,b) => a.start-b.start)[0];
    if (following && following.status !== 'pending') s.status = 'done';
  }
  const serve = Math.max(old.serve, ...thermal.steps.map(s => s.end));
  return PlanSchema.parse({ ...old, household_id: 'local', kitchen, serve_requested: old.serve, serve,
    steps: thermal.steps, oven_segments: thermal.oven_segments, warnings: holdWarnings(thermal.steps, serve, recipes),
    created_at: old.created_at ?? 0, updated_at: old.updated_at ?? 0, schema: 2 });
}
