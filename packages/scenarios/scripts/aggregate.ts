import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScenarioResult } from '../src/runner.js';
import { percentile } from '../src/report.js';

/** Aggregates a run summary into a pass-rate and latency table. Usage: aggregate.ts <summary.json> [out.json] */
const [file, out] = process.argv.slice(2);
if (!file) throw new Error('Usage: aggregate.ts <summary.json> [out.json]');
const summary = JSON.parse(readFileSync(file, 'utf8')) as { model: string; required: number;
  table: { scenario: string; mode: string; passed: number; runs: number; directories: string[] }[] };
const rows = summary.table.map(row => {
  const trials = row.directories.map(d => ({ report: JSON.parse(readFileSync(join(d, 'report.json'), 'utf8')) as ScenarioResult,
    trace: readFileSync(join(d, 'trace.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { type: string }) }));
  const turns = trials.filter(t => t.report.passed).flatMap(t => t.report.turns);
  const total = turns.map(t => t.timings.totalMs);
  const tools = turns.flatMap(t => t.tools.map(c => c.ms));
  return { scenario: row.scenario, mode: row.mode, passed: row.passed, runs: row.runs,
    turns: turns.length, turnP50Ms: percentile(total, .5), turnP95Ms: percentile(total, .95), turnMaxMs: Math.max(...total),
    toolP95Ms: percentile(tools, .95), modelRequestsPerTurn: turns.reduce((n, t) => n + (t.modelRequests ?? 0), 0) / (turns.length || 1),
    lintViolations: turns.reduce((n, t) => n + t.lint.length + t.rawLint.length, 0),
    softWording: trials.reduce((n, t) => n + t.report.softFailures.length, 0),
    idCorrections: trials.reduce((n, t) => n + t.trace.filter(r => r.type === 'voice_correction').length, 0),
    failures: trials.flatMap((t, i) => t.report.failures.map(f => ({ trial: i + 1, ...f }))) };
});
const fmt = (ms?: number) => ms === undefined ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;
console.log('| Scenario | Mode | Pass | Turns | Turn p50 | Turn p95 | Max | Tool p95 | Model req/turn | Lint | ID fixes |');
console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const r of rows) console.log(`| ${r.scenario} | ${r.mode} | ${r.passed}/${r.runs} | ${r.turns} | ${fmt(r.turnP50Ms)} | ${fmt(r.turnP95Ms)} | ${fmt(r.turnMaxMs)} | ${fmt(r.toolP95Ms)} | ${r.modelRequestsPerTurn.toFixed(2)} | ${r.lintViolations} | ${r.idCorrections} |`);
for (const r of rows) for (const f of r.failures) console.log(`- ${r.scenario} t${f.trial} [${f.category}] ${f.beat}: ${f.message.slice(0, 240)}`);
if (out) writeFileSync(out, JSON.stringify({ source: file, model: summary.model, required: summary.required, rows }, null, 2) + '\n');
