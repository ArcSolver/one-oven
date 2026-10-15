import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Service } from '../src/service.js';

export function benchmark(samples = 200, warmup = 20) {
  const dir = mkdtempSync(join(tmpdir(), 'one-oven-perf-'));
  const store = new Store(join(dir, 'state.sqlite'));
  const now = Date.parse('2026-10-15T10:00:00-05:00') / 60000;
  const service = new Service(store, () => now);
  const kitchen = service.setKitchen({ ovens: 1, burners: 4, helpers: 2, timezone: 'America/Chicago' });
  const ids = ['turkey', 'salmon', 'potatoes', 'stuffing', 'rice', 'green-beans', 'carrots', 'gravy'];
  const measurements: Record<string, number[]> = { plan_meal: [], report_delay: [] };
  try {
    for (let i = 0; i < samples + warmup; i++) {
      let start = performance.now();
      const result = service.planMeal(ids, '16:00', kitchen.kitchen_id, { allow_repeat: true, request_id: `perf-plan-${i}` });
      const planning = performance.now() - start;
      start = performance.now();
      service.reportDelay(result.plan_id, 'salmon', 5, { request_id: `perf-delay-${i}` });
      const delaying = performance.now() - start;
      if (i >= warmup) { measurements.plan_meal.push(planning); measurements.report_delay.push(delaying); }
    }
    return Object.fromEntries(Object.entries(measurements).map(([name, values]) => {
      values.sort((a, b) => a - b);
      const percentile = (q: number) => +values[Math.ceil(values.length * q) - 1].toFixed(3);
      return [name, { samples, p50_ms: percentile(0.5), p95_ms: percentile(0.95), p99_ms: percentile(0.99), max_ms: +values.at(-1)!.toFixed(3) }];
    }));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
}
