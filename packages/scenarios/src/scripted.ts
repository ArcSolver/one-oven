import { Model, type BaseModelConfig, type Message, type ModelStreamEvent, type StreamOptions } from '@strands-agents/sdk';
import { normalize } from '../../voice/src/intents.js';
import type { PlannedCall } from './types.js';

export const NOT_UNDERSTOOD = "Sorry, I didn't catch that. Please say it again.";
const singular = (text: string) => normalize(text).split(' ').map(w => w.length > 3 ? w.replace(/oes$/, 'o').replace(/s$/, '') : w).join(' ');
/** Intent words missing from an utterance, ignoring case, punctuation, spelled numbers and plural endings. */
export function missingIntentWords(utterance: string, intents: string[]): string[] {
  const heard = ` ${singular(utterance)} `;
  return intents.filter(intent => !heard.includes(` ${singular(intent)} `));
}
/**
 * Deterministic CI stand-in for a language model. The runner primes it with the beat's
 * expected tool calls; it still goes through the Strands agent loop, the MCP client and
 * the real HTTP server. It proves plumbing and state, not language understanding.
 * It refuses to act when the (possibly speech-recognized) utterance lacks the beat's intent words.
 */
export class ScenarioScriptedModel extends Model {
  private config: BaseModelConfig = { modelId: 'scenario-script' };
  private calls: PlannedCall[] = [];
  private intents: string[] = [];
  prime(calls: PlannedCall[], intents: string[]): void { this.calls = calls; this.intents = intents; }
  updateConfig(config: BaseModelConfig): void { this.config = { ...this.config, ...config }; }
  getConfig(): BaseModelConfig { return this.config; }
  async *stream(messages: Message[], _options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const userIndex = messages.findLastIndex(m => m.role === 'user' && m.content.some(b => b.type === 'textBlock'));
    const utterance = messages[userIndex].content.filter(b => b.type === 'textBlock').map(b => b.text).join(' ');
    const after = messages.slice(userIndex + 1);
    const used = after.flatMap(m => m.content).filter(b => b.type === 'toolUseBlock').length;
    let call: PlannedCall | undefined;
    let reply = NOT_UNDERSTOOD;
    if (used === 0 && missingIntentWords(utterance, this.intents).length) call = undefined;
    else if (used < this.calls.length) call = this.calls[used];
    else {
      for (const block of after.flatMap(m => m.content)) {
        if (block.type !== 'toolResultBlock') continue;
        for (const content of block.content) if (content.type === 'textBlock') {
          try { const data = JSON.parse(content.text); if (typeof data.say === 'string') reply = data.say; } catch { /* spoken text */ }
        }
      }
    }
    yield { type: 'modelMessageStartEvent', role: 'assistant' };
    if (call) {
      yield { type: 'modelContentBlockStartEvent', start: { type: 'toolUseStart', name: call.name, toolUseId: `scenario-${messages.length}` } };
      yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'toolUseInputDelta', input: JSON.stringify(call.args) } };
    } else {
      yield { type: 'modelContentBlockStartEvent' };
      yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: reply } };
    }
    yield { type: 'modelContentBlockStopEvent' };
    yield { type: 'modelMessageStopEvent', stopReason: call ? 'toolUse' : 'endTurn' };
  }
}
