import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bars, diffBars, focus, lanes, laneOrder, lockAxis, planAxis, shortLabel, ticks, tickStep, xOf, type StepView } from '../src/shared/timeline.js';

// Minute epochs on 2026-10-15 in Chicago (UTC-5): 17:40 local = 22:40 UTC.
const at = (hhmm: string) => Date.parse(`2026-10-15T${hhmm}:00-05:00`) / 60000;
const step = (step_id: string, dish_id: string | null, start: string, end: string, extra: Partial<StepView> = {}): StepView => ({
  step_id, dish_id, source: dish_id ? 'recipe' : 'preheat', kind: 'prep', text: 'Step.', start: at(start), end: at(end),
  status: 'pending', index: 0, ...extra });
// salmon-delay at 6:20 PM, the shape recorded in the S4 trace.
const before: StepView[] = [
  step('oven0:preheat:1', null, '17:55', '18:09', { oven: 0, setpoint_f: 400, status: 'done', kind: 'oven' }),
  step('salmon:0', 'salmon', '18:05', '18:09', { status: 'done' }),
  step('salmon:1', 'salmon', '18:09', '18:27', { kind: 'oven', oven: 0, temperature_f: 400, status: 'running', text: 'Roast the salmon in the preheated oven.' }),
  step('salmon:2', 'salmon', '18:27', '18:30', { kind: 'rest' }),
  step('rice:2', 'rice', '18:10', '18:25', { status: 'running' }),
  step('rice:3', 'rice', '18:25', '18:30'),
  step('green-beans:1', 'green-beans', '18:18', '18:23', { status: 'running' }),
  step('green-beans:2', 'green-beans', '18:23', '18:28'),
];
const after = before.map(s => s.step_id === 'salmon:1' ? { ...s, end: s.end + 5 } : s.step_id === 'salmon:2' ? { ...s, start: s.start + 5, end: s.end + 5 } : s);
const track = { x0: 0, width: 862 };

test('the axis spans the plan with 15 minutes of padding and stays fixed for the plan', () => {
  const axis = planAxis(before, at('18:30'));
  assert.deepEqual(axis, { start: at('17:40'), end: at('18:45') });
  assert.deepEqual(lockAxis({ plan_id: 'p', axis }, 'p', after, at('18:35')), { axis, extended: false });
  const late = lockAxis({ plan_id: 'p', axis }, 'p', [...after, step('x', 'salmon', '18:40', '18:50')], at('18:50'));
  assert.equal(late.extended, true);
  assert.equal(late.axis.start, axis.start);
  assert.deepEqual(lockAxis({ plan_id: 'p', axis }, 'q', after, at('18:35')).axis, planAxis(after, at('18:35')));
  assert.deepEqual(ticks(axis).length, 7);
});
test('a delay moves only the delayed dish; other bars keep identical pixels', () => {
  const axis = planAxis(before, at('18:30'));
  const laneList = lanes(['salmon', 'rice', 'green-beans'], before);
  assert.deepEqual(laneList.map(l => l.id), ['dish:salmon', 'dish:rice', 'dish:green-beans', 'oven:0']);
  const v1 = bars(laneList, before, axis, track), v2 = bars(laneList, after, axis, track);
  const changes = diffBars(v1, v2);
  assert.deepEqual([...changes.keys()].sort(), ['dish:salmon/salmon:1', 'dish:salmon/salmon:2', 'oven:0/salmon:1']);
  assert.ok([...changes.values()].every(c => c === 'moved'));
  for (const bar of v1.filter(b => b.dish_id !== 'salmon')) assert.deepEqual(v2.find(b => b.key === bar.key), bar);
  const roast = (list: typeof v1) => list.find(b => b.key === 'dish:salmon/salmon:1')!;
  assert.equal(roast(v2).x, roast(v1).x);
  assert.ok(Math.abs(roast(v2).width - roast(v1).width - 5 * 862 / 65) <= 1);
  assert.ok(v2.every(b => Number.isInteger(b.x) && Number.isInteger(b.width)));
});
test('status-only changes are reported separately from geometry', () => {
  const axis = planAxis(before, at('18:30'));
  const laneList = lanes(['salmon', 'rice', 'green-beans'], before);
  const done = before.map(s => s.step_id === 'rice:2' ? { ...s, status: 'done' as const } : s);
  assert.deepEqual([...diffBars(bars(laneList, before, axis, track), bars(laneList, done, axis, track))], [['dish:rice/rice:2', 'status']]);
});
test('pixel positions are rounded integers on the fixed track', () => {
  const axis = { start: at('17:40'), end: at('18:45') };
  assert.equal(xOf(axis.start, axis, track), 0);
  assert.equal(xOf(axis.end, axis, track), 862);
  assert.equal(xOf(at('18:20'), axis, track), Math.round(40 * 862 / 65));
});
test('lanes keep their order and a swapped dish takes the old slot', () => {
  assert.deepEqual(laneOrder([], ['salmon', 'rice', 'green-beans']), ['salmon', 'rice', 'green-beans']);
  assert.deepEqual(laneOrder(['salmon', 'rice', 'green-beans'], ['salmon', 'rice', 'carrots']), ['salmon', 'rice', 'carrots']);
  assert.deepEqual(laneOrder(['salmon', 'rice'], ['rice', 'salmon', 'gravy']), ['salmon', 'rice', 'gravy']);
});
test('bar labels are short verbs, oven blocks name the dish', () => {
  assert.equal(shortLabel({ ...before[2] }), 'Roast 400°F');
  assert.equal(shortLabel({ ...before[3], text: 'Bring the rice to a simmer.' }), 'Simmer');
  assert.equal(shortLabel({ ...before[3], text: 'Heat water for the beans.' }), 'Heat water');
  assert.equal(shortLabel(before[0]), 'Preheat 400°F');
  const oven = bars(lanes(['salmon'], before), before, planAxis(before, at('18:30')), track).find(b => b.key === 'oven:0/salmon:1');
  assert.equal(oven?.label, 'Salmon roast');
});
test('Now shows running steps, Next the earliest pending step', () => {
  const view = focus(before);
  assert.equal(view.current?.step_id, 'salmon:1');
  assert.deepEqual(view.also.map(s => s.step_id), ['rice:2', 'green-beans:1']);
  assert.equal(view.next?.step_id, 'green-beans:2');
});
test('tick spacing stays readable for long plans', () => {
  assert.equal(tickStep({ start: at('17:40'), end: at('18:45') }, 862), 10);
  assert.equal(tickStep({ start: at('11:45'), end: at('16:15') }, 862), 30);
});
test('steps sharing an oven stack in rows instead of covering each other', () => {
  const shared = [step('potatoes:1', 'potatoes', '15:20', '15:55', { kind: 'oven', oven: 0 }),
    step('stuffing:1', 'stuffing', '15:25', '15:50', { kind: 'oven', oven: 0 }),
    step('salmon:1', 'salmon', '15:55', '16:10', { kind: 'oven', oven: 0 })];
  const oven = bars(lanes([], shared), shared, planAxis(shared, at('16:15')), track);
  assert.deepEqual(oven.map(b => [b.step_id, b.row, b.rows]), [['potatoes:1', 0, 2], ['stuffing:1', 1, 2], ['salmon:1', 0, 2]]);
  const single = bars(lanes(['salmon'], before), before, planAxis(before, at('18:30')), track);
  assert.ok(single.every(b => b.row === 0 && b.rows === 1));
});
