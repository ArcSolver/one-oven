import { Model, type BaseModelConfig, type Message, type ModelStreamEvent, type StreamOptions } from '@strands-agents/sdk';
import type { ScheduledStep } from '@one-oven/contracts';

/** A deliberately small weekday fixture, not a natural language model or a scheduler. */
export class ScriptedModel extends Model {
  private config: BaseModelConfig;
  constructor(scenario: string) {
    super();
    if (scenario !== 'weekday-3') throw new Error(`Unknown scripted scenario: ${scenario}`);
    this.config = { modelId: scenario };
  }
  updateConfig(config: BaseModelConfig): void { this.config = { ...this.config, ...config }; }
  getConfig(): BaseModelConfig { return this.config; }
  async *stream(messages: Message[], _options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const envelopes: Record<string, any>[] = [];
    for (const message of messages) for (const block of message.content) {
      if (block.type !== 'toolResultBlock') continue;
      for (const content of block.content) if (content.type === 'textBlock') {
        try { const data = JSON.parse(content.text); if (typeof data.say === 'string') envelopes.push(data); } catch { /* spoken content */ }
      }
    }
    const last = messages.at(-1)!;
    const envelope = envelopes.at(-1);
    const plan = envelopes.findLast(e => e.plan_id);
    const kitchen = envelopes.findLast(e => e.kitchen_id);
    let call: { name: string; input: Record<string, unknown> } | undefined;
    let reply = envelope?.say ?? 'Tell me your kitchen setup, then ask for salmon, rice and green beans.';
    if (!last.content.some(block => block.type === 'toolResultBlock')) {
      const utterance = last.content.filter(b => b.type === 'textBlock').map(b => b.text).join(' ');
      if (/my kitchen/i.test(utterance)) call = { name: 'set_kitchen', input: { ovens: 1, burners: 4, helpers: 1, timezone: 'America/Chicago' } };
      else if (/on the table|plan.*salmon/i.test(utterance)) call = { name: 'plan_meal', input: { kitchen_id: kitchen?.kitchen_id, dish_ids: ['salmon', 'rice', 'green-beans'], serve_at: '18:30' } };
      else if (/salmon needs (five|5) more/i.test(utterance)) call = { name: 'report_delay', input: { plan_id: plan?.plan_id, dish_id: 'salmon', minutes: 5 } };
      else if (/done|finished/i.test(utterance)) {
        const running = (plan?.display?.steps as ScheduledStep[] ?? []).filter(s => s.status === 'running');
        const done = running.find(s => utterance.toLowerCase().replace(/[^a-z0-9 ]/g, '').includes(s.text.toLowerCase().replace(/[^a-z0-9 ]/g, ''))) ?? (running.length === 1 ? running[0] : undefined);
        if (done) call = { name: 'next_step', input: { plan_id: plan?.plan_id, done_step_id: done.step_id } };
        else reply = 'Which cooking step have you finished?';
      } else if (/next/i.test(utterance)) call = { name: 'next_step', input: { plan_id: plan?.plan_id } };
    }
    yield { type: 'modelMessageStartEvent', role: 'assistant' };
    if (call) {
      yield { type: 'modelContentBlockStartEvent', start: { type: 'toolUseStart', name: call.name, toolUseId: `scripted-${messages.length}` } };
      yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'toolUseInputDelta', input: JSON.stringify(call.input) } };
    } else {
      yield { type: 'modelContentBlockStartEvent' };
      yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: reply } };
    }
    yield { type: 'modelContentBlockStopEvent' };
    yield { type: 'modelMessageStopEvent', stopReason: call ? 'toolUse' : 'endTurn' };
  }
}
