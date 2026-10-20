import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BedrockModel } from '@strands-agents/sdk';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import { AnthropicModel } from '@strands-agents/sdk/models/anthropic';
import { SimClock } from '@one-oven/contracts';
import { parseModelSpec } from '../src/config.js';
import { createModel } from '../src/models.js';
import { ScriptedModel } from '../src/models/scripted.js';
import { HostTimers } from '../src/host-tools.js';
import { JsonlTrace } from '../src/trace.js';
import { nullableOptionals, omitOptionalNulls } from '../src/mcp.js';
import { lintReply } from '../src/speech-lint.js';

test('AGENT_MODEL alone selects native providers, preserving colon-containing Bedrock ARNs; no requests', () => {
  const env = { OPENAI_API_KEY: 'test-only', ANTHROPIC_API_KEY: 'test-only', AWS_REGION: 'us-east-1' };
  for (const [selector, Type] of [ ['scripted:weekday-3', ScriptedModel], ['openai:placeholder', OpenAIModel],
    ['anthropic:placeholder', AnthropicModel], ['bedrock:arn:aws:bedrock:us-east-1:000000000000:inference-profile/test', BedrockModel] ] as const) {
    const spec = parseModelSpec({ ...env, AGENT_MODEL: selector });
    // Only constructors are exercised. No invoke/stream/countTokens on Bedrock.
    const model = createModel(spec, env);
    assert.ok(model instanceof Type);
    assert.equal(model.modelId, selector.slice(selector.indexOf(':') + 1));
  }
  assert.throws(() => parseModelSpec({ AGENT_MODEL: 'unknown:x' }));
  assert.throws(() => parseModelSpec({ AGENT_MODEL: 'openai:' }));
  assert.throws(() => parseModelSpec({ AGENT_MODEL: 'openai:<model-id>' }));
  assert.throws(() => parseModelSpec({ AGENT_MAX_TOKENS: 'NaN' }));
  assert.throws(() => parseModelSpec({ AGENT_TEMPERATURE: '2' }));
  assert.throws(() => parseModelSpec({ AGENT_MODEL: 'openai:x', OPENAI_BASE_URL: 'http://user:secret@localhost' }));
});
test('host timers use injected time, replace/cancel, expire, and deduplicate automatic suggestions', () => {
  const clock = new SimClock(0);
  const timers = new HostTimers(clock);
  timers.set('Rice', 20);
  clock.advance(5);
  assert.equal(timers.list()[0].minutes, 15);
  timers.set('rice', 2);
  assert.equal(timers.list().length, 1);
  clock.advance(2);
  assert.equal(timers.list()[0].status, 'elapsed');
  assert.equal(timers.cancel('RICE'), true);
  assert.equal(timers.list().length, 0);
  const suggestion = { step_id: 'salmon:1', label: 'Salmon', minutes: 5, ends_at: new Date(clock.now() + 300000).toISOString(), say: 'Set a timer for 5 minutes.' };
  timers.auto([suggestion]); clock.advance(1); timers.auto([suggestion]);
  assert.equal(timers.actions.length, 1);
  assert.equal(timers.list()[0].minutes, 4);
  timers.auto([{ ...suggestion, ends_at: new Date(clock.now() + 600000).toISOString() }]);
  assert.equal(timers.list()[0].minutes, 10);
  assert.throws(() => timers.set('bad', 0));
});
test('nullable optional adapter preserves required null errors and false/zero values', () => {
  const schema = { type: 'object', properties: { plan_id: { type: 'string' }, done_step_id: { type: 'string' },
    allow_repeat: { type: 'boolean' }, profiles: { type: 'array', items: { type: 'object', properties: { capacity: { type: 'number' } } } } }, required: ['plan_id'] } satisfies Parameters<typeof nullableOptionals>[0];
  assert.deepEqual(omitOptionalNulls({ plan_id: null, done_step_id: null, allow_repeat: false, profiles: [{ capacity: null }] }, schema),
    { plan_id: null, allow_repeat: false, profiles: [{}] });
  assert.equal((nullableOptionals(schema).properties?.plan_id as { type: string }).type, 'string');
  assert.ok((nullableOptionals(schema).properties?.done_step_id as { anyOf: unknown }).anyOf);
  assert.equal(schema.properties.done_step_id.type, 'string');
});
test('speech rejects machine/visual leakage and trace redacts secrets but retains token metrics', () => {
  for (const text of ['Call set_timer now.', 'Look at the display.', 'Use plan_meal.', 'Plan 16fb234c-764b-42d2-b428-abcdefffffff.', '{"ok":true}', 'At 2026-10-15T18:30:00Z.']) assert.equal(lintReply(text).ok, false, text);
  assert.equal(lintReply('Dinner moves to 6:35 PM. The salmon needs five more minutes.').ok, true);
  const dir = mkdtempSync(join(tmpdir(), 'one-oven-trace-'));
  try {
    const path = join(dir, 'trace.jsonl');
    const trace = new JsonlTrace(path);
    trace.write({ type: 'test', authorization: 'sensitive', nested: { apiKey: 'sensitive', access_token: 'sensitive' }, inputTokens: 42 });
    const text = readFileSync(path, 'utf8');
    assert.ok(!text.includes('sensitive'));
    assert.equal(JSON.parse(text).inputTokens, 42);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('JSONL trace stamps every record on one monotonic clock and marks recording sync points', () => {
  const dir = mkdtempSync(join(tmpdir(), 'one-oven-trace-'));
  try {
    const path = join(dir, 'trace.jsonl');
    const trace = new JsonlTrace(path);
    trace.write({ type: 'turn', at: '2026-10-15T23:20:00.000Z' });
    trace.mark('recording_t0');
    trace.write({ type: 'turn', at: '2026-10-15T23:20:00.000Z' });
    const records = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(records.map(r => r.type), ['turn', 'sync_marker', 'turn']);
    assert.equal(records[1].name, 'recording_t0');
    for (const r of records) { assert.equal(typeof r.mono_ms, 'number'); assert.ok(Number.isFinite(Date.parse(r.wall_iso))); }
    assert.ok(records[0].mono_ms <= records[1].mono_ms && records[1].mono_ms <= records[2].mono_ms);
    assert.equal(records[0].at, '2026-10-15T23:20:00.000Z', 'simulated time is kept apart from the recording clock');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
