import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DomainError, ToolErrorSchema, assertSpeech, speechLint } from '@one-oven/contracts';
import { callTool } from '../src/mcp/tools.js';
import { setup, walk } from './helpers.js';
import { servingTime, localTime } from '../src/engine/time.js';
import { validateDish } from '../src/data/load.js';
import { dish } from '../src/dishes.js';

const errorCode = (code: string) => (e: unknown) => e instanceof DomainError && e.error_code === code;
function meal(ctx: ReturnType<typeof setup>, ids = ['salmon', 'rice', 'green-beans']) {
  return ctx.service.planMeal(ids, '18:30', ctx.kitchen());
}
test('explicit keys replay every mutation, normalize defaults and survive subsequent versions', () => {
  const ctx = setup();
  try {
    const input = { ovens: 1, burners: 4, helpers: 1, timezone: 'America/Chicago' };
    const k = ctx.service.setKitchen(input, { request_id: 'kitchen-0001' });
    assert.deepEqual(ctx.service.setKitchen({ ...input, oven_profiles: [{}] }, { request_id: 'kitchen-0001' }), { ...k, deduplicated: true });
    const p = ctx.service.planMeal(['rice'], '18:30', k.kitchen_id, { request_id: 'meal-0001' });
    assert.deepEqual(ctx.service.planMeal(['rice'], '18:30', k.kitchen_id, { request_id: 'meal-0001' }), { ...p, deduplicated: true });
    const swap = ctx.service.swapDish(p.plan_id, 'rice', 'carrots', { request_id: 'swap-0001', based_on_version: 1 });
    assert.deepEqual(ctx.service.swapDish(p.plan_id, 'rice', 'carrots', { request_id: 'swap-0001', based_on_version: 1 }), { ...swap, deduplicated: true });
    ctx.setNow(ctx.store.plan(p.plan_id).steps[0].start);
    const next = ctx.service.nextStep(p.plan_id, undefined, { request_id: 'next-0001' });
    assert.deepEqual(ctx.service.nextStep(p.plan_id, undefined, { request_id: 'next-0001' }), { ...next, deduplicated: true });
    const delay = ctx.service.reportDelay(p.plan_id, 'carrots', 5, { request_id: 'delay-0001', based_on_version: next.version });
    assert.deepEqual(ctx.service.reportDelay(p.plan_id, 'carrots', 5, { request_id: 'delay-0001', based_on_version: next.version }), { ...delay, deduplicated: true });
    assert.equal(ctx.store.plan(p.plan_id).version, 4);
    assert.deepEqual(ctx.store.events(p.plan_id).map(e => e.version), [1, 2, 3, 4]);
    assert.deepEqual(ctx.store.planVersion(p.plan_id, 1)?.steps.map(s => s.dish_id), ['rice', 'rice', 'rice', 'rice']);
    assert.throws(() => ctx.service.reportDelay(p.plan_id, 'carrots', 6, { request_id: 'delay-0001' }), errorCode('request_id_reused'));
    assert.throws(() => ctx.service.nextStep(p.plan_id, undefined, { request_id: 'delay-0001' }), errorCode('request_id_reused'));
  } finally { ctx.store.close(); }
});
test('implicit retry is bounded by 20 seconds and current version; allow_repeat adds time', () => {
  const ctx = setup();
  try {
    const p = meal(ctx);
    const first = ctx.service.reportDelay(p.plan_id, 'salmon', 5);
    ctx.advanceMs(19999);
    const replay = ctx.service.reportDelay(p.plan_id, 'salmon', 5);
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.say, "I already added 5 minutes to the salmon. Say 'add 5 more' if you need more time.");
    assert.equal(ctx.service.reportDelay(p.plan_id, 'salmon', 5, { allow_repeat: true }).version, first.version + 1);
    assert.equal(ctx.service.reportDelay(p.plan_id, 'salmon', 5).version, first.version + 2);
    ctx.advanceMs(20001);
    assert.equal(ctx.service.reportDelay(p.plan_id, 'salmon', 5).version, first.version + 3);
  } finally { ctx.store.close(); }
});
test('version conflicts and injected event/idempotency failures roll back every table', () => {
  const ctx = setup();
  try {
    const p = meal(ctx);
    const snapshot = () => JSON.stringify(['kitchens', 'plans', 'plan_events', 'idempotency'].map(table => ctx.store.db.prepare(`SELECT * FROM ${table}`).all()));
    const before = snapshot();
    assert.throws(() => ctx.service.reportDelay(p.plan_id, 'salmon', 5, { based_on_version: 9 }), e => errorCode('version_conflict')(e) && (e as DomainError).current_version === 1);
    assert.equal(snapshot(), before);
    for (const table of ['plan_events', 'idempotency']) {
      ctx.store.db.exec(`CREATE TEMP TRIGGER fail_write BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected'); END`);
      assert.throws(() => ctx.service.reportDelay(p.plan_id, 'salmon', 5, { request_id: 'rollback-0001' }), /injected/);
      assert.equal(snapshot(), before);
      ctx.store.db.exec('DROP TRIGGER fail_write');
    }
    assert.equal(ctx.service.reportDelay(p.plan_id, 'salmon', 5, { request_id: 'rollback-0001' }).version, 2);
  } finally { ctx.store.close(); }
});
test('start now moves an eligible future step, preserves frozen work and rejects blocked oven starts', () => {
  const ctx = setup();
  try {
    const p = meal(ctx);
    const first = ctx.service.nextStep(p.plan_id, undefined, { allow_repeat: true }, 'green-beans:0');
    assert.equal(first.step!.status, 'running');
    assert.equal(first.step!.start, ctx.now());
    assert.throws(() => ctx.service.nextStep(p.plan_id, undefined, {}, 'salmon:1'), errorCode('step_not_running'));
    const system = ctx.store.plan(p.plan_id).steps.find(s => s.source === 'preheat')!;
    ctx.service.nextStep(p.plan_id, undefined, { allow_repeat: true }, system.step_id);
    const frozen = ctx.store.plan(p.plan_id).steps.find(s => s.step_id === system.step_id)!;
    ctx.service.reportDelay(p.plan_id, 'rice', 2);
    assert.deepEqual(ctx.store.plan(p.plan_id).steps.find(s => s.step_id === system.step_id), frozen);
  } finally { ctx.store.close(); }
});
test('voice envelopes cover all tools, schema errors, metadata and domain errors', () => {
  const ctx = setup();
  try {
    const output = (name: string, args: Record<string, unknown>, meta?: Record<string, unknown>) => {
      const result = callTool(ctx.service, name, args, meta);
      const data = result.structuredContent!;
      assertSpeech(String(data.say));
      assert.equal((result.content[0] as { text: string }).text, data.say);
      if (result.isError) ToolErrorSchema.parse(data);
      return { result, data };
    };
    const k = output('set_kitchen', { ovens: 1, burners: 4, helpers: 1, timezone: 'America/Chicago' }).data.kitchen_id;
    output('list_dishes', {});
    const p = output('plan_meal', { dish_ids: ['salmon'], serve_at: '18:30', kitchen_id: k }).data.plan_id;
    for (const [name, args] of [
      ['set_kitchen', { ovens: 1, burners: 4, helpers: 1, timezone: 'invalid' }],
      ['set_kitchen', { ovens: 0, burners: 4, helpers: 1, timezone: 'UTC', oven_profiles: [{}] }],
      ['plan_meal', { dish_ids: ['unknown'], serve_at: '18:30', kitchen_id: k }],
      ['plan_meal', { dish_ids: ['salmon'], serve_at: '17:06', kitchen_id: k }],
      ['plan_meal', { dish_ids: ['salmon'], serve_at: '2026-10-15T18:30:00', kitchen_id: k }],
      ['next_step', { plan_id: 'unknown' }], ['next_step', { plan_id: p, done_step_id: 'salmon:1' }],
      ['report_delay', { plan_id: p, dish_id: 'salmon', minutes: -1 }],
      ['report_delay', { plan_id: p, dish_id: 'salmon', minutes: 1, based_on_version: 99 }],
      ['swap_dish', { plan_id: p, dish_id: 'missing', replacement_id: 'rice' }],
    ] as [string, Record<string, unknown>][]) assert.equal(output(name, args).result.isError, true);
    const a = { plan_id: p, dish_id: 'salmon', minutes: 1 };
    const once = output('report_delay', a, { 'io.oneoven/request_id': 'metadata-0001' });
    assert.equal(output('report_delay', { ...a, request_id: 'metadata-0001' }).data.deduplicated, true);
    assert.equal(output('report_delay', { ...a, request_id: 'different-0001' }, { 'io.oneoven/request_id': 'metadata-0001' }).data.error_code, 'request_id_reused');
    assert.equal(output('report_delay', a, { 'io.oneoven/request_id': 4 }).result.isError, true);
    assert.equal(once.data.version, 2);
    output('next_step', { plan_id: p });
    output('swap_dish', { plan_id: p, dish_id: 'salmon', replacement_id: 'rice' });
  } finally { ctx.store.close(); }
});
test('overdue steps, repeated completion and frozen conflicts are atomic and speakable', () => {
  const ctx = setup();
  try {
    const p = meal(ctx, ['rice']);
    let plan = ctx.store.plan(p.plan_id);
    ctx.setNow(plan.steps[0].start);
    ctx.service.nextStep(p.plan_id);
    plan = ctx.store.plan(p.plan_id);
    ctx.setNow(plan.steps[0].end + 1);
    assert.throws(() => ctx.service.nextStep(p.plan_id), errorCode('overdue_step'));
    assert.deepEqual(ctx.store.plan(p.plan_id), plan);
    const result = ctx.service.nextStep(p.plan_id, plan.steps[0].step_id);
    assertSpeech(result.say);
    const repeated = ctx.service.nextStep(p.plan_id, plan.steps[0].step_id, { allow_repeat: true });
    assert.equal(repeated.say, 'That step is already complete.');
    assert.equal(repeated.version, result.version);
    assert.throws(() => ctx.service.swapDish(p.plan_id, 'rice', 'carrots'), errorCode('conflict_frozen'));
    walk(ctx, p.plan_id);
  } finally { ctx.store.close(); }
});
test('time-zone parsing handles rollover, DST skipped/repeated times and spoken local time', () => {
  const minute = (s: string) => Date.parse(s) / 60000;
  assert.equal(servingTime('18:30', 'America/Chicago', minute('2026-10-15T23:40:00Z')), minute('2026-10-16T23:30:00Z'));
  assert.equal(servingTime('02:30', 'America/Chicago', minute('2026-03-08T07:00:00Z')), minute('2026-03-09T07:30:00Z'));
  assert.equal(servingTime('01:30', 'America/Chicago', minute('2026-11-01T06:45:00Z')), minute('2026-11-01T07:30:00Z'));
  assert.equal(localTime(minute('2026-10-15T23:35:00Z'), 'America/Chicago'), '6:35 PM');
  assert.equal(localTime(minute('2026-10-15T23:35:00Z'), 'Asia/Seoul'), '8:35 AM');
  for (const input of ['2026-10-15T18:30:00', '25:00', '18:99', 'bad']) assert.throws(() => servingTime(input, 'UTC', minute('2026-10-15T00:00:00Z')));
});
test('speech lint rejects long or machine/display-oriented speech', () => {
  for (const text of ['2026-10-15T23:35:00Z', 'Use plan_meal.', 'See the screen.', 'Tap this card.', '{"say":"hi"}', 'Visit https://example.com.', 'Start salmon:1.', 'One. Two. Three.', 'word '.repeat(31), '']) assert.equal(speechLint(text).ok, false, text);
  assertSpeech('Dinner moves to 6:35 PM. Green beans start 5 minutes later.');
});
test('recipe validator rejects schema and semantic corruption', () => {
  const source = dish('salmon');
  const mutations: ((d: any) => void)[] = [
    d => delete d.steps[1].temperature_f, d => delete d.steps[1].oven_units,
    d => d.steps[1].oven_units = 5, d => d.steps[0].minutes = 0,
    d => d.steps[1].minutes = 100, d => d.steps[0].text = 'The salmon is ready.',
    d => d.steps[0].text = 'Season the Kraft salmon.', d => d.name = '연어',
    d => delete d.steps[1].doneness_check, d => delete d.safety_note,
    d => d.hold_max_minutes = 121, d => d.provenance.author = 'someone-else',
    d => d.provenance.calibrated = { date: '2026-10-15', measured_minutes: [4], note: 'Measured.' },
  ];
  for (const mutate of mutations) { const invalid = structuredClone(source); mutate(invalid); assert.throws(() => validateDish(invalid)); }
});
