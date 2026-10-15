import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseModelSpec } from '@one-oven/agent/config';
import { createModel } from '@one-oven/agent/models';
import { JsonlTrace } from '@one-oven/agent/trace';
import { runWeekday } from '../../agent/test/weekday.js';
const spec = parseModelSpec();
if (spec.provider !== 'openai' || spec.baseUrl !== 'http://127.0.0.1:10100/v1') throw new Error('Latency measurements require the authorized local OpenAI endpoint');
const directory = process.env.VOICE_REPORT_DIR ?? `runs/s3-latency-${Date.now()}`;
await mkdir(directory, { recursive: true });
const quantiles = (values: number[]) => { const sorted = values.slice().sort((a,b) => a-b); return { n: sorted.length,
  p50: sorted[Math.ceil(sorted.length * .5)-1], p95: sorted[Math.ceil(sorted.length * .95)-1], max: sorted.at(-1) }; };
const reports = [];
const modes = process.argv.includes('--voice-only') ? [true] : [false, true];
const count = Number(process.env.LATENCY_RUNS ?? 1);
if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error('LATENCY_RUNS must be 1..5');
for (const voice of modes) for (let i = 1; i <= count; i++) {
  const trace = new JsonlTrace(join(directory, `${voice ? 'voice' : 'baseline'}-${i}.jsonl`));
  const at = performance.now();
  try {
    const result = await runWeekday(createModel(spec), spec.provider, trace, voice);
    const requests = result.turns.flatMap(t => t.modelRequests);
    const report = { mode: voice ? 'voice' : 'baseline', trial: i, passed: true, turns: result.turns.length,
      modelRequests: requests.length, mcpCalls: result.toolCalls, rawLintViolations: result.turns.filter(t => !t.rawLint.ok).length,
      turnMs: quantiles(result.turns.map(t => t.timings.totalMs)), modelMs: quantiles(result.turns.map(t => t.timings.modelMs)),
      firstDeltaMs: quantiles(requests.flatMap(t => t.firstDeltaMs === undefined ? [] : [t.firstDeltaMs])),
      toolMs: quantiles(result.turns.flatMap(t => t.toolCalls.map(c => c.ms))),
      inputTokens: requests.reduce((n,t) => n+(t.inputTokens ?? 0),0), outputTokens: requests.reduce((n,t) => n+(t.outputTokens ?? 0),0),
      totalMs: performance.now()-at, completedSteps: result.final.steps.length, finalVersion: result.final.version };
    reports.push(report); console.log(JSON.stringify(report));
  } catch (error) {
    const report = { mode: voice ? 'voice' : 'baseline', trial: i, passed: false, totalMs: performance.now()-at,
      error: error instanceof Error ? error.message : String(error), cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined };
    reports.push(report); console.log(JSON.stringify(report));
  }
  await writeFile(join(directory, 'report.json'), JSON.stringify({ spec, reports }, null, 2)+'\n');
}
if (reports.some(r => !r.passed)) process.exitCode = 1;
