import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import { ScenarioSchema, type Scenario } from './schema.js';

export const SCENARIO_DIR = new URL('../scenarios/', import.meta.url);
export const SCENARIO_IDS = ['weekday-3', 'salmon-delay', 'swap', 'thanksgiving-8'] as const;

export function parseScenario(source: string, name = 'scenario'): Scenario {
  const result = ScenarioSchema.safeParse(parse(source));
  if (!result.success) throw new Error(`${name}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return result.data;
}
export function loadScenario(id: string): Scenario {
  const scenario = parseScenario(readFileSync(new URL(`${id}.yaml`, SCENARIO_DIR), 'utf8'), `${id}.yaml`);
  if (scenario.id !== id) throw new Error(`${id}.yaml declares id ${scenario.id}`);
  return scenario;
}
export function loadAll(): Scenario[] {
  const files = readdirSync(SCENARIO_DIR).filter(f => f.endsWith('.yaml')).map(f => f.replace(/\.yaml$/, '')).sort();
  if (files.join() !== [...SCENARIO_IDS].sort().join()) throw new Error(`Expected exactly ${SCENARIO_IDS.join(', ')}`);
  return SCENARIO_IDS.map(loadScenario).sort((a, b) => a.video.order - b.video.order);
}
