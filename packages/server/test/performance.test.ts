import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benchmark } from '../scripts/benchmark.js';
test('8-dish service including SQLite writes meets plan p95 <=50ms and delay p95 <=20ms', () => {
  const result = benchmark();
  console.log(JSON.stringify({ performance: result, storage: 'temporary file, SQLite WAL', warmup: 20 }));
  assert.ok(result.plan_meal.p95_ms <= 50, JSON.stringify(result));
  assert.ok(result.report_delay.p95_ms <= 20, JSON.stringify(result));
});
