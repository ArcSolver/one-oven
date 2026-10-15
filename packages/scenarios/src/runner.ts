import { isDeepStrictEqual } from 'node:util';
import type { Plan, ScheduledStep } from '@one-oven/contracts';
import type { TraceSink } from '@one-oven/agent/trace';
import { verifyPlan } from '../../server/src/engine/verify.js';
import { localTime } from '../../server/src/engine/time.js';
import { dishes } from '../../server/src/dishes.js';
import { Harness } from './harness.js';
import { matchCalls, resolveCalls, type Ids } from './match.js';
import type { Beat, Scenario, StateExpect } from './schema.js';
import { clockLabel } from './time.js';
import type { Driver, ObservedCall, PlannedCall, TimerFire, TurnInput, TurnOutput } from './types.js';

export type FailureCategory = 'tool_selection' | 'arguments' | 'tool_error' | 'speech_lint' | 'state' | 'reply' | 'turn_error' | 'harness';
export type Failure = { beat: string; iteration?: number; category: FailureCategory; message: string; soft?: boolean };
export type TurnRecord = {
  beat: string; iteration?: number; clock: string; utterance: string; transcript?: string; reply: string; rawReply: string;
  tools: { name: string; args: unknown; ok: boolean; deduplicated?: boolean; ms: number }[];
  timers: TimerFire[]; replySource?: string; modelRequests?: number; lint: string[]; rawLint: string[];
  timings: TurnOutput['timings']; video: boolean;
};
export type ScenarioResult = {
  scenario: string; title: string; mode: string; live: boolean; driver: string; passed: boolean;
  failures: Failure[]; softFailures: Failure[]; turns: TurnRecord[]; protocolVersion?: string;
  final?: { version: number; serve_local: string; steps: number; done: number; warnings: number };
  totalMs: number;
};
class BeatFailure extends Error {
  constructor(readonly failure: Omit<Failure, 'beat'>) { super(failure.message); }
}
const spoken = (step: ScheduledStep) => step.source === 'preheat' ? 'oven preheat'
  : step.source === 'transition' ? 'oven temperature change' : (step.dish_id ?? 'oven').replaceAll('-', ' ');
const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
/** Words speech recognition must keep: dish names, numbers and the next/done keywords. */
export function deriveIntents(text: string): string[] {
  const lower = text.toLowerCase();
  const names = ['green beans', 'glazed carrots', 'salmon', 'rice', 'turkey', 'potatoes', 'stuffing', 'gravy', 'carrots', 'oven', 'preheat', 'temperature', 'next', 'swap', 'done'];
  const words = names.filter(n => new RegExp(`\\b${n}\\b`).test(lower)).filter((n, _, all) => !all.some(o => o !== n && o.includes(n)));
  const digits = [...lower.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine)\b/g)].map(m => String(NUMBERS.indexOf(m[1]) >= 0 ? NUMBERS.indexOf(m[1]) : m[1]));
  return [...new Set([...words, ...digits])];
}
function nextEvent(plan: Plan, now: number): number {
  const times = plan.steps.filter(s => s.status !== 'done').map(s => (s.status === 'running' ? s.end : s.start) * 60000);
  return Math.max(now, Math.min(...times));
}
export async function runScenario(scenario: Scenario, driver: Driver, trace: TraceSink, directory: string): Promise<ScenarioResult> {
  const started = performance.now();
  const harness = new Harness(scenario);
  const ids: Ids = {};
  const turns: TurnRecord[] = [];
  const failures: Failure[] = [];
  const softFailures: Failure[] = [];
  const tz = scenario.timezone;
  const plan = () => ids.plan ? harness.store.plan(ids.plan) : undefined;
  let pendingTimers: TimerFire[] = [];
  const move = async (target: number) => { pendingTimers.push(...await driver.advance(target)); };

  const turn = async (beat: Beat, input: TurnInput): Promise<{ output: TurnOutput; matched: ObservedCall[] }> => {
    let output: TurnOutput;
    try { output = await driver.turn(input); }
    catch (error) {
      throw new BeatFailure({ iteration: input.iteration, category: 'turn_error',
        message: `${error instanceof Error ? error.message : error}${error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : ''}` });
    }
    const record: TurnRecord = { beat: beat.id, iteration: input.iteration, clock: clockLabel(harness.clock.now(), tz),
      utterance: input.utterance, transcript: output.transcript, reply: output.reply, rawReply: output.rawReply,
      tools: output.toolCalls.map(c => ({ name: c.name, args: c.args, ok: !c.error && !c.result?.isError,
        deduplicated: (c.result?.structuredContent as { deduplicated?: boolean } | undefined)?.deduplicated, ms: c.ms })),
      timers: pendingTimers, replySource: output.replySource, modelRequests: output.modelRequests,
      lint: output.lint, rawLint: output.rawLint, timings: output.timings, video: !!beat.video };
    pendingTimers = [];
    turns.push(record);
    trace.write({ type: 'scenario_turn', scenario: scenario.id, mode: driver.mode, ...record });
    for (const call of output.toolCalls) {
      const data = call.result?.structuredContent as { kitchen_id?: string; plan_id?: string } | undefined;
      if (!data || call.result?.isError || call.error) continue;
      if (call.name === 'set_kitchen' && data.kitchen_id) ids.kitchen = data.kitchen_id;
      if (call.name === 'plan_meal' && data.plan_id) ids.plan = data.plan_id;
    }
    const failed = output.toolCalls.find(c => c.error || c.result?.isError);
    const match = matchCalls(input.calls, output.toolCalls, tz);
    if (!match.ok) {
      throw new BeatFailure({ iteration: input.iteration, category: match.nameSeen ? 'arguments' : 'tool_selection',
        message: `Expected ${match.missing.name}(${JSON.stringify(match.missing.args)}); observed ${JSON.stringify(output.toolCalls.map(c => ({ name: c.name, args: c.args })))}; reply "${output.reply}"` });
    }
    if (failed) throw new BeatFailure({ iteration: input.iteration, category: 'tool_error',
      message: `${failed.name} failed: ${JSON.stringify((failed.result?.structuredContent as object | undefined) ?? failed.error)}` });
    if (output.rawLint.length || output.lint.length) throw new BeatFailure({ iteration: input.iteration, category: 'speech_lint',
      message: `Lint ${[...output.rawLint, ...output.lint].join(', ')}: "${output.rawReply}"` });
    const current = plan();
    if (current) verifyPlan(current, dishes);
    return { output, matched: match.matched };
  };

  const checkReply = (beat: Beat, reply: string) => {
    const problems = [
      ...(beat.expect.reply_includes ?? []).filter(s => !reply.toLowerCase().includes(s.toLowerCase())).map(s => `missing "${s}"`),
      ...(beat.expect.reply_excludes ?? []).filter(s => reply.toLowerCase().includes(s.toLowerCase())).map(s => `contains "${s}"`),
    ];
    if (!problems.length) return;
    const failure: Failure = { beat: beat.id, category: 'reply', message: `${problems.join('; ')} in "${reply}"` };
    // Live language models may phrase replies differently; state decides, wording is linted only.
    if (driver.live && driver.mode !== 'engine') softFailures.push({ ...failure, soft: true });
    else throw new BeatFailure(failure);
  };
  const checkState = (expect: StateExpect | undefined, before: Plan | undefined, matched: ObservedCall[]) => {
    if (!expect) return;
    const after = plan();
    const problems: string[] = [];
    if (!after) throw new BeatFailure({ category: 'state', message: 'No plan exists' });
    const result = matched.at(-1)?.result?.structuredContent as { changed_steps?: { step_id: string }[]; deduplicated?: boolean; plan_id?: string } | undefined;
    if (expect.serve_local && localTime(after.serve, tz) !== expect.serve_local) problems.push(`serve ${localTime(after.serve, tz)} ≠ ${expect.serve_local}`);
    if (expect.no_warnings && after.warnings.length) problems.push(`warnings ${JSON.stringify(after.warnings)}`);
    if (expect.all_done && !after.steps.every(s => s.status === 'done')) problems.push('not every step is done');
    for (const id of expect.running ?? []) if (after.steps.find(s => s.step_id === id)?.status !== 'running') problems.push(`${id} is not running`);
    if (expect.changed_steps) {
      const actual = (result?.changed_steps ?? []).map(c => c.step_id).sort();
      if (!isDeepStrictEqual(actual, [...expect.changed_steps].sort())) problems.push(`changed ${actual.join(',')} ≠ ${expect.changed_steps.join(',')}`);
    }
    if (expect.deduplicated !== undefined && (result?.deduplicated ?? false) !== expect.deduplicated) problems.push(`deduplicated ${result?.deduplicated}`);
    if (expect.version_delta !== undefined && after.version - (before?.version ?? 0) !== expect.version_delta) problems.push(`version ${before?.version}→${after.version}`);
    if (expect.same_plan && (result?.plan_id !== before?.plan_id || after.plan_id !== before?.plan_id)) problems.push('plan id changed');
    for (const id of expect.unchanged_dishes ?? []) {
      const pick = (p?: Plan) => p?.steps.filter(s => s.dish_id === id);
      if (!pick(before)?.length || !isDeepStrictEqual(pick(before), pick(after))) problems.push(`${id} changed`);
    }
    for (const source of expect.system_steps ?? []) if (!after.steps.some(s => s.source === source)) problems.push(`no ${source} step`);
    for (const overlap of expect.overlaps ?? []) {
      const base = after.steps.find(s => s.step_id === overlap.step);
      for (const id of overlap.with) {
        const other = after.steps.find(s => s.step_id === id);
        if (!base || !other || !(other.start < base.end && base.start < other.end)) problems.push(`${id} does not overlap ${overlap.step}`);
      }
    }
    if (problems.length) throw new BeatFailure({ category: 'state', message: problems.join('; ') });
  };

  try {
    await driver.open(harness, scenario, trace, directory);
    for (const beat of scenario.beats) {
      try {
        if (!beat.repeat) {
          if (beat.at) {
            const target = harness.at(beat.at);
            if (target < harness.clock.now()) throw new BeatFailure({ category: 'harness', message: `${beat.at} is in the past` });
            await move(target);
          } else if (beat.advance_to) {
            const current = plan();
            const target = typeof beat.advance_to === 'object' ? harness.clock.now() + beat.advance_to.minutes * 60000
              : current ? nextEvent(beat.advance_to === 'timer' ? { ...current, steps: current.steps.filter(s => s.status === 'running') } : current, harness.clock.now())
              : harness.clock.now();
            await move(target);
          }
          const before = plan() && structuredClone(plan());
          const calls = resolveCalls(beat.expect.tools, ids);
          const { output, matched } = await turn(beat, { beatId: beat.id, utterance: beat.user, calls, intents: beat.intents ?? deriveIntents(beat.user) });
          checkState(beat.expect.state, before, matched);
          checkReply(beat, output.reply);
          continue;
        }
        if (!ids.plan) throw new BeatFailure({ category: 'harness', message: 'Repeat beats need a plan' });
        const until = beat.repeat.until;
        const stopAt = typeof until === 'object' && 'at' in until ? harness.at(until.at) : undefined;
        const satisfied = (p: Plan) => until === 'all_done' ? p.steps.every(s => s.status === 'done')
          : 'running' in until ? p.steps.some(s => s.step_id === until.running && s.status === 'running') : false;
        let last: TurnOutput | undefined;
        let lastMatched: ObservedCall[] = [];
        const before = structuredClone(plan()!);
        for (let iteration = 1; ; iteration++) {
          let current = plan()!;
          if (satisfied(current)) break;
          if (iteration > beat.repeat.max_turns) throw new BeatFailure({ category: 'state', message: `Not finished after ${beat.repeat.max_turns} turns` });
          const target = nextEvent(current, harness.clock.now());
          if (stopAt !== undefined && target > stopAt) { await move(stopAt); break; }
          await move(target);
          current = plan()!;
          const now = harness.clock.now() / 60000;
          const done = current.steps.filter(s => s.status === 'running' && s.end <= now).sort((a, b) => a.end - b.end || a.step_id.localeCompare(b.step_id))[0];
          const utterance = done ? beat.user.replace('{subject}', spoken(done)) : beat.user_idle ?? "What's next?";
          const call: PlannedCall = { name: 'next_step', args: { plan_id: ids.plan, ...(done ? { done_step_id: done.step_id } : {}) } };
          const versionBefore = current.version;
          const result = await turn(beat, { beatId: beat.id, iteration, utterance, calls: [call], intents: deriveIntents(utterance) });
          last = result.output; lastMatched = result.matched;
          const after = plan()!;
          if (done && after.steps.find(s => s.step_id === done.step_id)?.status !== 'done') throw new BeatFailure({ iteration, category: 'state', message: `${done.step_id} not completed` });
          if (after.version <= versionBefore) throw new BeatFailure({ iteration, category: 'state', message: 'Cooking turn did not advance the plan' });
        }
        checkState(beat.expect.state, before, lastMatched);
        if (last) checkReply(beat, last.reply);
        if (turns.length && beat.video) turns.findLast(t => t.beat === beat.id)!.video = true;
      } catch (error) {
        if (error instanceof BeatFailure) failures.push({ beat: beat.id, ...error.failure });
        else failures.push({ beat: beat.id, category: 'harness', message: error instanceof Error ? error.message : String(error) });
        break;
      }
    }
  } catch (error) {
    failures.push({ beat: 'open', category: 'harness', message: error instanceof Error ? error.message : String(error) });
  }
  const final = plan();
  const protocolVersion = driver.protocolVersion();
  if (driver.mode !== 'engine' && !failures.length && protocolVersion !== '2025-11-25') {
    failures.push({ beat: 'open', category: 'harness', message: `Negotiated protocol ${protocolVersion}` });
  }
  try { await driver.close(); } catch (error) { failures.push({ beat: 'close', category: 'harness', message: String(error) }); }
  await harness.close();
  return { scenario: scenario.id, title: scenario.title, mode: driver.mode, live: driver.live, driver: driver.description,
    passed: failures.length === 0, failures, softFailures, turns, protocolVersion,
    final: final && { version: final.version, serve_local: localTime(final.serve, tz), steps: final.steps.length,
      done: final.steps.filter(s => s.status === 'done').length, warnings: final.warnings.length },
    totalMs: performance.now() - started };
}
