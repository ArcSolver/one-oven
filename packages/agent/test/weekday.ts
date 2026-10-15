import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Model } from '@strands-agents/sdk';
import { SimClock, type Plan } from '@one-oven/contracts';
import { Store } from '../../server/src/store.js';
import { Service } from '../../server/src/service.js';
import { app } from '../../server/src/http.js';
import { verifyPlan } from '../../server/src/engine/verify.js';
import { dishes } from '../../server/src/dishes.js';
import { OneOvenMcpClient } from '../src/mcp.js';
import { ConversationSession, type TurnResult } from '../src/session.js';
import type { TraceSink } from '../src/trace.js';

/** All state changes go through the model -> Strands tools -> real HTTP server.
 * The harness reads SQLite only to judge outcomes and advance simulated time. */
export async function runWeekday(model: Model, provider: string, trace: TraceSink) {
  const clock = new SimClock('2026-10-15T17:05:00-05:00');
  const store = new Store(':memory:');
  const server = app(new Service(store, () => clock.now() / 60000, () => clock.now())).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const mcp = new OneOvenMcpClient(`http://127.0.0.1:${address.port}/mcp`, trace);
  const session = new ConversationSession({ model, mcp, clock, trace, provider, autoTimers: provider === 'scripted',
    device: { deviceClass: 'dot', timezone: 'America/Chicago', nowIso: new Date(clock.now()).toISOString() } });
  const turns: TurnResult[] = [];
  const turn = async (text: string, tool: string) => {
    const result = await session.turn(text);
    turns.push(result);
    assert.equal(result.rawLint.ok, true, `Raw speech lint: ${JSON.stringify(result.rawLint)}: ${result.rawReply}`);
    assert.equal(result.lint.ok, true);
    assert.ok(result.toolCalls.some(c => c.name === tool), `Missing ${tool} for ${text}`);
    assert.ok(result.toolCalls.every(c => !c.error && !c.result?.isError), `Tool error for ${text}`);
    return result;
  };
  try {
    const kitchen = await turn('My kitchen has one oven, four burners, and one cook. My timezone is America/Chicago.', 'set_kitchen');
    const k = kitchen.toolCalls.find(c => c.name === 'set_kitchen')!.result!.structuredContent as { kitchen_id: string };
    assert.equal(store.kitchen(k.kitchen_id).ovens.length, 1);
    assert.equal(store.kitchen(k.kitchen_id).helpers, 1);
    assert.equal(store.kitchen(k.kitchen_id).burners, 4);
    await turn('I want salmon, rice and green beans on the table at 6:30 PM.', 'plan_meal');
    const planned = mcp.calls.find(c => c.name === 'plan_meal')!.result!.structuredContent as { plan_id: string; serve_at_local: string };
    assert.equal(planned.serve_at_local, '6:30 PM');
    const id = planned.plan_id;
    assert.deepEqual([...new Set(store.plan(id).steps.flatMap(s => s.dish_id ? [s.dish_id] : []))].sort(), ['green-beans', 'rice', 'salmon']);
    let delayed = false;
    for (let guard = 0; guard < 80; guard++) {
      let plan = store.plan(id);
      verifyPlan(plan, dishes);
      if (plan.steps.every(s => s.status === 'done')) break;
      if (!delayed && plan.steps.some(s => s.step_id === 'salmon:1' && s.status === 'running')) {
        const before = structuredClone(plan);
        const result = await turn('The salmon needs five more minutes.', 'report_delay');
        plan = store.plan(id);
        assert.equal(plan.serve, before.serve + 5);
        assert.equal(plan.version, before.version + 1);
        assert.deepEqual(plan.steps.filter(s => s.dish_id !== 'salmon'), before.steps.filter(s => s.dish_id !== 'salmon'));
        const payload = result.toolCalls.find(c => c.name === 'report_delay')!.result!.structuredContent as { changed_steps: { step_id: string }[] };
        assert.deepEqual(payload.changed_steps.map(s => s.step_id).sort(), ['salmon:1', 'salmon:2']);
        await turn('The salmon needs five more minutes.', 'report_delay');
        assert.deepEqual(store.plan(id), plan, 'Repeated delay must not accumulate');
        delayed = true;
        continue;
      }
      const times = plan.steps.filter(s => s.status !== 'done').map(s => (s.status === 'running' ? s.end : s.start) * 60000);
      clock.set(Math.max(clock.now(), Math.min(...times)));
      const done = plan.steps.find(s => s.status === 'running' && s.end * 60000 <= clock.now());
      const version = plan.version;
      await turn(done ? `I've finished this step: ${done.text} What's next?` : "What's next?", 'next_step');
      plan = store.plan(id);
      if (done) assert.equal(plan.steps.find(s => s.step_id === done.step_id)!.status, 'done');
      assert.ok(plan.version > version, 'Each cooking turn must advance the plan');
    }
    const final: Plan = store.plan(id);
    assert.ok(delayed, 'Delay beat executed');
    assert.ok(final.steps.every(s => s.status === 'done'), 'All recipe and oven steps completed');
    assert.deepEqual(final.warnings, []);
    assert.equal(final.serve, Date.parse('2026-10-15T18:35:00-05:00') / 60000, 'Dinner remains at 6:35 PM');
    assert.equal(mcp.protocolVersion, '2025-11-25');
    assert.ok(turns.flatMap(t => t.hostActions).some(a => a.name === 'set_timer'), 'Host timers used');
    return { turns, final, protocolVersion: mcp.protocolVersion, toolCalls: mcp.calls.length };
  } finally {
    await session.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
  }
}
