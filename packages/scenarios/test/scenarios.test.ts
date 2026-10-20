import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { MemoryTrace } from '@one-oven/agent/trace';
import { loadAll, loadScenario, parseScenario } from '../src/load.js';
import { argsMatch, matchCalls } from '../src/match.js';
import { deriveIntents, runScenario } from '../src/runner.js';
import { EngineDriver } from '../src/modes/engine.js';
import { AgentDriver } from '../src/modes/agent.js';
import { missingIntentWords, NOT_UNDERSTOOD } from '../src/scripted.js';
import { buildScript, MAX_SECONDS } from '../src/video-script.js';
import type { Scenario } from '../src/schema.js';

const minimal = (beats: unknown[]) => JSON.stringify({ id: 'swap', title: 't', device: 'show', timezone: 'America/Chicago', clock_start: '17:05',
  kitchen: { ovens: 1, burners: 4, helpers: 1 }, video: { order: 1, scene: 's' }, beats });

test('four scenarios load in video order with the beats DESIGN.md 6 requires', () => {
  const all = loadAll();
  assert.deepEqual(all.map(s => s.id), ['weekday-3', 'salmon-delay', 'swap', 'thanksgiving-8']);
  for (const scenario of all) assert.ok(scenario.beats.some(b => b.video), `${scenario.id} has video beats`);
  const delay = loadScenario('salmon-delay');
  assert.equal(delay.device, 'dot');
  assert.equal(delay.beats.find(b => b.id === 'delay-again')?.expect.state?.deduplicated, true);
  const thanksgiving = loadScenario('thanksgiving-8');
  assert.equal(thanksgiving.kitchen.helpers, 2);
  assert.equal((thanksgiving.beats[1].expect.tools?.[0].args?.dish_ids as string[]).length, 8);
});

test('schema rejects ambiguous or malformed beats', () => {
  assert.throws(() => parseScenario(minimal([{ id: 'a', user: 'x', at: '17:10', advance_to: 'next_event' }])), /either at or advance_to/);
  assert.throws(() => parseScenario(minimal([{ id: 'a', user: 'next', repeat: { until: 'all_done' } }])), /\{subject\}/);
  assert.throws(() => parseScenario(minimal([{ id: 'a', user: 'x', expect: { tool: [] } }])), /Unrecognized key/);
  assert.throws(() => parseScenario(minimal([{ id: 'a', user: 'x', at: '25:00' }])), /HH:MM/);
});

test('argument matching accepts reordered lists and equivalent times, and rejects wrong values', () => {
  const tz = 'America/Chicago';
  assert.ok(argsMatch({ dish_ids: ['salmon', 'rice'], serve_at: '18:30' }, { dish_ids: ['rice', 'salmon'], serve_at: '2026-10-15T18:30:00-05:00', extra: 1 }, tz));
  assert.ok(!argsMatch({ serve_at: '18:30' }, { serve_at: '18:35' }, tz));
  assert.ok(!argsMatch({ minutes: 5 }, { minutes: 10 }, tz));
  const result = matchCalls([{ name: 'plan_meal', args: {} }, { name: 'next_step', args: {} }],
    [{ name: 'next_step', args: {}, ms: 1 }, { name: 'plan_meal', args: {}, ms: 1 }], tz);
  assert.equal(result.ok, false, 'order matters');
});

test('intent words survive plural and number differences, not missing words', () => {
  assert.deepEqual(missingIntentWords('The potato is done, what is next', ['potatoes', 'next']), []);
  assert.deepEqual(missingIntentWords('I have one oven, for burners', ['1 oven', '4 burners']), ['4 burners']);
  assert.deepEqual(deriveIntents("I'm done with the green beans. What's next?"), ['green beans', 'next', 'done']);
});

test('the runner fails on wrong state and on utterances that lose their intent words', async () => {
  const wrong = structuredClone(loadScenario('swap')) as Scenario;
  wrong.beats[2].expect.state!.serve_local = '6:45 PM';
  const state = await runScenario(wrong, new EngineDriver(), new MemoryTrace(), tmpdir());
  assert.equal(state.passed, false);
  assert.equal(state.failures[0].category, 'state');
  assert.match(state.failures[0].message, /6:30 PM ≠ 6:45 PM/);

  const garbled = structuredClone(loadScenario('weekday-3')) as Scenario;
  garbled.beats[0].user = 'Alexa, I have an oven and some burners.';
  const heard = await runScenario(garbled, new AgentDriver(), new MemoryTrace(), tmpdir());
  assert.equal(heard.passed, false);
  assert.equal(heard.failures[0].category, 'tool_selection');
  assert.equal(heard.turns[0].reply, NOT_UNDERSTOOD);
});

test('video script from passing scripted runs uses recorded replies and fits the length cap', async () => {
  const sources = [];
  for (const scenario of loadAll()) {
    const result = await runScenario(scenario, new AgentDriver(), new MemoryTrace(), tmpdir());
    assert.equal(result.passed, true, JSON.stringify(result.failures));
    sources.push({ scenario, result });
  }
  const rows = buildScript(sources, 'Closing line.');
  const total = rows.reduce((n, r) => n + r.seconds, 0);
  assert.ok(total <= MAX_SECONDS, `total ${total}s`);
  const lines = rows.map(r => r.line);
  assert.ok(lines.includes('Dinner moves to 6:35 PM. The lemon salmon gets 5 more minutes; the other dishes keep their times.'));
  assert.ok(lines.includes('Glazed carrots replace green beans. Dinner is still at 6:30 PM.'));
  assert.deepEqual(rows.map(r => r.start), rows.map((_, i) => rows.slice(0, i).reduce((n, r) => n + r.seconds, 0)));
});

test('a video take can run on the screen device, switch to voice-only before a beat, and records server request time', async () => {
  const scenario = { ...loadScenario('salmon-delay'), device: 'show' as const };
  const trace = new MemoryTrace();
  const result = await runScenario(scenario, new AgentDriver(), trace, tmpdir(), { deviceSwitches: { finish: 'dot' } });
  assert.equal(result.passed, true, JSON.stringify(result.failures));
  const turns = trace.records.filter(r => r.type === 'turn');
  const beats = trace.records.filter(r => r.type === 'scenario_turn');
  assert.equal(turns.length, beats.length);
  beats.forEach((b, i) => {
    assert.equal(turns[i].device, b.beat === 'finish' ? 'dot' : 'show', `${b.beat} device`);
    assert.equal(b.request_now, turns[i].at, 'request time is the server clock of that turn');
  });
  assert.ok(trace.records.some(r => r.type === 'device_switch' && r.beat === 'finish' && r.device === 'dot'));
  const delay = beats.find(b => b.beat === 'delay')!, again = beats.find(b => b.beat === 'delay-again')!;
  assert.ok(Date.parse(String(again.request_now)) - Date.parse(String(delay.request_now)) <= 20000);
  await assert.rejects(async () => {
    const engine = await runScenario(scenario, new EngineDriver(), new MemoryTrace(), tmpdir(), { deviceSwitches: { finish: 'dot' } });
    if (!engine.passed) throw new Error(engine.failures[0].message);
  }, /no device to switch/);
});
