import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseModelSpec } from '../src/config.js';
import { createModel } from '../src/models.js';
import { JsonlTrace } from '../src/trace.js';
import { runWeekday } from '../test/weekday.js';

const spec = parseModelSpec(process.argv.includes('--scripted') ? { AGENT_MODEL: 'scripted:weekday-3' } : process.env);
const live = process.argv.includes('--live');
if (live && spec.provider === 'scripted') throw new Error('Set AGENT_MODEL=openai:<available-model-id> for a live run');
if (spec.provider === 'bedrock' || spec.provider === 'anthropic') throw new Error('S2 E2E permits scripted or the local OpenAI-compatible endpoint only');
if (spec.provider !== 'scripted' && (!live || !spec.baseUrl || new URL(spec.baseUrl).origin !== 'http://127.0.0.1:10100')) {
  throw new Error('Live S2 requires --live and OPENAI_BASE_URL=http://127.0.0.1:10100/v1');
}
const runs = live ? 5 : 1;
const directory = join(process.env.INIT_CWD ?? process.cwd(), 'runs', `s2-${spec.provider}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(directory, { recursive: true });
const reports = [];
for (let i = 1; i <= runs; i++) {
  const trace = new JsonlTrace(join(directory, `trial-${i}`, 'trace.jsonl'));
  const started = performance.now();
  try {
    const result = await runWeekday(createModel(spec), spec.provider, trace);
    const latency = result.turns.map(t => t.timings.totalMs).sort((a, b) => a - b);
    const report = { trial: i, passed: true, turns: result.turns.length, toolCalls: result.toolCalls,
      rawLintViolations: result.turns.reduce((n, t) => n + t.rawLint.violations.length, 0),
      outputLintViolations: result.turns.reduce((n, t) => n + t.lint.violations.length, 0),
      turnP50Ms: latency[Math.ceil(latency.length * .5) - 1], turnP95Ms: latency[Math.ceil(latency.length * .95) - 1],
      totalMs: performance.now() - started, finalVersion: result.final.version, completedSteps: result.final.steps.length,
      protocolVersion: result.protocolVersion };
    reports.push(report);
    console.log(JSON.stringify(report));
  } catch (error) {
    const report = { trial: i, passed: false, totalMs: performance.now() - started,
      error: error instanceof Error ? error.message : 'Unknown error',
      cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined };
    reports.push(report);
    console.error(JSON.stringify(report));
  }
}
const passed = reports.filter(r => r.passed).length;
const report = { provider: spec.provider, modelId: spec.modelId, baseUrl: spec.baseUrl, passed, runs,
  required: live ? 4 : 1, reports };
writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Report: ${directory}/report.json — ${passed}/${runs}`);
if (passed < report.required) process.exitCode = 1;
