import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Model, type BaseModelConfig, type Message, type ModelStreamEvent } from '@strands-agents/sdk';
import { SimClock } from '@one-oven/contracts';
import { Store } from '../../server/src/store.js';
import { Service } from '../../server/src/service.js';
import { app } from '../../server/src/http.js';
import { ConversationSession } from '../src/session.js';
import { OneOvenMcpClient } from '../src/mcp.js';
import { MemoryTrace } from '../src/trace.js';

/** Emits the queued done_step_id values, one per model call within a turn. */
class QueueModel extends Model {
  queue: string[] = [];
  planId = '';
  getConfig(): BaseModelConfig { return { modelId: 'queue' }; }
  updateConfig(): void {}
  async *stream(_messages: Message[]): AsyncIterable<ModelStreamEvent> {
    const id = this.queue.shift();
    yield { type: 'modelMessageStartEvent', role: 'assistant' };
    if (id) {
      yield { type: 'modelContentBlockStartEvent', start: { type: 'toolUseStart', name: 'next_step', toolUseId: `q-${Math.random()}` } };
      yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'toolUseInputDelta', input: JSON.stringify({ plan_id: this.planId, done_step_id: id }) } };
    } else {
      yield { type: 'modelContentBlockStartEvent' };
      yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: 'Which step is done?' } };
    }
    yield { type: 'modelContentBlockStopEvent' };
    yield { type: 'modelMessageStopEvent', stopReason: id ? 'toolUse' : 'endTurn' };
  }
}

test('voice mode returns a failure caused by an invented ID to the model once, but speaks real domain errors', async () => {
  const clock = new SimClock('2026-10-15T17:05:00-05:00');
  const store = new Store(':memory:');
  const server = app(new Service(store, () => clock.now() / 60000, () => clock.now())).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const trace = new MemoryTrace();
  const model = new QueueModel();
  const mcp = new OneOvenMcpClient(`http://127.0.0.1:${address.port}/mcp`, trace);
  const session = new ConversationSession({ model, mcp, clock, trace, voiceMode: true, provider: 'test',
    device: { deviceClass: 'dot', timezone: 'America/Chicago', nowIso: new Date(clock.now()).toISOString() } });
  try {
    await session.prepare();
    const tools = await mcp.listTools();
    const call = (name: string, args: Record<string, string | number | string[]>) => mcp.callTool(tools.find(t => t.name === name)!, args);
    const kitchen = mcp.calls.length;
    await call('set_kitchen', { ovens: 1, burners: 4, helpers: 1, timezone: 'America/Chicago' });
    const kitchenId = (mcp.calls[kitchen].result!.structuredContent as { kitchen_id: string }).kitchen_id;
    await call('plan_meal', { kitchen_id: kitchenId, dish_ids: ['salmon', 'rice', 'green-beans'], serve_at: '18:30' });
    model.planId = (mcp.calls.at(-1)!.result!.structuredContent as { plan_id: string }).plan_id;
    clock.set(Date.parse('2026-10-15T17:55:00-05:00'));
    await call('next_step', { plan_id: model.planId });
    clock.set(Date.parse('2026-10-15T18:09:00-05:00'));

    model.queue = ['oven0:preheat:1 / end', 'oven0:preheat:1'];
    const spoken: string[] = [];
    const fixed = await session.turn("I'm done with the oven preheat. What's next?", text => spoken.push(text));
    assert.deepEqual(fixed.toolCalls.map(c => !!c.result?.isError), [true, false]);
    assert.equal(fixed.modelRequests.length, 2);
    assert.equal(fixed.replySource, 'tool-say');
    assert.deepEqual(spoken, [fixed.reply]);
    assert.equal(store.plan(model.planId).steps.find(s => s.step_id === 'oven0:preheat:1')!.status, 'done');
    assert.deepEqual(trace.records.filter(r => r.type === 'voice_correction').map(r => r.invented), [['done_step_id']]);

    model.queue = ['green-beans:3'];
    const domain = await session.turn("I'm done with the green beans.");
    assert.equal(domain.toolCalls.length, 1);
    assert.equal(domain.modelRequests.length, 1);
    assert.equal(domain.reply, 'Only a step already in progress can be completed.');
  } finally { await session.close(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});
