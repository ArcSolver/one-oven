import { readFileSync, readdirSync } from 'node:fs';
import { DishSchema, defaultOven, type Dish } from '@one-oven/contracts';

// Per-dish timing-fixture bounds, not food safety or doneness estimates.
export const durationLimits: Record<string, number> = {
  salmon: 60, rice: 60, 'green-beans': 45, potatoes: 75,
  turkey: 300, stuffing: 75, carrots: 60, gravy: 45,
};
const verb = /^(Season|Roast|Rest|Rinse|Bring|Cook|Trim|Heat|Drain|Cut|Prepare|Carve|Mix|Bake|Slice|Simmer|Glaze|Measure|Whisk)\b/;
const brands = /\b(Amazon|Alexa|McDonald'?s|Coca[- ]Cola|Kraft|Nestle|Nestlé|Heinz|Butterball)\b/i;
const english = /^[\x20-\x7e°F]+$/;
export function validateDish(input: unknown): Dish {
  const d = DishSchema.parse(input);
  if (d.steps.reduce((sum, s) => sum + s.minutes, 0) > (durationLimits[d.dish_id] ?? 300)) throw new Error('Recipe exceeds timing bound.');
  for (const s of d.steps) {
    if (!verb.test(s.text)) throw new Error('Instruction must begin with an imperative verb.');
    if (s.kind === 'oven' && (!s.temperature_f || !s.oven_units)) throw new Error('Oven steps require temperature and capacity.');
    if (s.kind !== 'oven' && (s.temperature_f !== undefined || s.oven_units !== undefined)) throw new Error('Only oven steps reserve an oven.');
    if ((s.oven_units ?? 0) > defaultOven().capacity_units) throw new Error('Recipe exceeds default oven capacity.');
  }
  const texts = [d.name, d.safety_note, d.provenance.calibrated?.note, ...d.steps.flatMap(s => [s.text, s.doneness_check])].filter((s): s is string => s !== undefined);
  if (texts.some(t => !english.test(t) || brands.test(t))) throw new Error('Use English text without brands.');
  if (/salmon|turkey|chicken|fish|poultry/i.test(`${d.dish_id} ${d.name} ${d.tags.join(' ')}`) &&
      (!d.safety_note || !d.steps.some(s => s.kind === 'oven' && s.doneness_check))) throw new Error('Fish and poultry require safety and doneness information.');
  if (d.provenance.calibrated && d.provenance.calibrated.measured_minutes.length !== d.steps.length) throw new Error('Calibration must cover every step.');
  return d;
}
export function loadDishes(directory = new URL('./dishes/', import.meta.url)): Dish[] {
  const list = readdirSync(directory).filter(name => name.endsWith('.json')).sort()
    .map(name => validateDish(JSON.parse(readFileSync(new URL(name, directory), 'utf8'))));
  if (new Set(list.map(d => d.dish_id)).size !== list.length) throw new Error('Duplicate dish IDs.');
  return list;
}
