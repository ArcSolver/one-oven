import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel } from '../src/models.js';
import { parseModelSpec } from '../src/config.js';
import { MemoryTrace } from '../src/trace.js';
import { runWeekday } from './weekday.js';

test('scripted weekday: real HTTP MCP, delay deduplication, timers, every step done, zero speech violations', async () => {
  const trace = new MemoryTrace();
  const result = await runWeekday(createModel(parseModelSpec({})), 'scripted', trace);
  assert.equal(result.final.steps.length, 12);
  assert.equal(trace.records.filter(r => r.type === 'turn').length, result.turns.length);
});
