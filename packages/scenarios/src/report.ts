import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScenarioResult } from './runner.js';

const cell = (value: unknown) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const ms = (value: number | undefined) => value === undefined ? '' : value.toFixed(1);
export function percentile(values: number[], p: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}
export function transcriptMarkdown(result: ScenarioResult): string {
  const lines = [`# ${result.title} — ${result.mode}${result.live ? ' (live)' : ''}`, '', `Driver: ${result.driver}`, '',
    '| Clock | Beat | User | Heard | Assistant | Tools | Timer |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const t of result.turns) lines.push(`| ${t.clock} | ${t.beat}${t.iteration ? ` #${t.iteration}` : ''} | ${cell(t.utterance)} | ${cell(t.transcript ?? '')} | ${cell(t.reply)} | ${
    cell(t.tools.map(c => `${c.name}${c.deduplicated ? ' (dedup)' : ''}${c.ok ? '' : ' ✗'}`).join(', '))} | ${cell(t.timers.map(f => f.text).join(' '))} |`);
  return lines.join('\n') + '\n';
}
export function timingsCsv(result: ScenarioResult): string {
  const rows = ['beat,iteration,clock,total_ms,model_ms,tool_ms,stt_ms,tts_ms,output_start_ms,model_requests,reply_source'];
  for (const t of result.turns) rows.push([t.beat, t.iteration ?? '', t.clock, ms(t.timings.totalMs), ms(t.timings.modelMs), ms(t.timings.toolMs),
    ms(t.timings.sttMs), ms(t.timings.ttsMs), ms(t.timings.outputStartMs), t.modelRequests ?? '', t.replySource ?? ''].join(','));
  return rows.join('\n') + '\n';
}
export function summary(result: ScenarioResult) {
  const total = result.turns.map(t => t.timings.totalMs);
  const tool = result.turns.flatMap(t => t.tools.map(c => c.ms));
  return { turns: result.turns.length, toolCalls: tool.length, turnP50Ms: percentile(total, .5), turnP95Ms: percentile(total, .95),
    toolP95Ms: percentile(tool, .95), timerFires: result.turns.reduce((n, t) => n + t.timers.length, 0),
    lintViolations: result.turns.reduce((n, t) => n + t.lint.length + t.rawLint.length, 0) };
}
export function reportMarkdown(result: ScenarioResult): string {
  const s = summary(result);
  return [`# ${result.scenario} — ${result.passed ? 'PASS' : 'FAIL'}`, '',
    `- Mode: ${result.mode}${result.live ? ' (live)' : ''}; ${result.driver}`,
    `- Protocol: ${result.protocolVersion ?? 'n/a (in-process)'}`,
    `- Final: ${result.final ? `version ${result.final.version}, serve ${result.final.serve_local}, ${result.final.done}/${result.final.steps} steps done, ${result.final.warnings} warnings` : 'no plan'}`,
    `- Turns ${s.turns}, tool calls ${s.toolCalls}, timer announcements ${s.timerFires}, lint violations ${s.lintViolations}`,
    `- Turn p50/p95 ${ms(s.turnP50Ms)}/${ms(s.turnP95Ms)} ms, tool p95 ${ms(s.toolP95Ms)} ms, wall ${(result.totalMs / 1000).toFixed(2)} s`,
    '', '## Failures', '', ...(result.failures.length ? result.failures.map(f => `- [${f.category}] ${f.beat}${f.iteration ? ` #${f.iteration}` : ''}: ${f.message}`) : ['None.']),
    '', '## Soft wording differences (live only, not failures)', '',
    ...(result.softFailures.length ? result.softFailures.map(f => `- ${f.beat}: ${f.message}`) : ['None.']), ''].join('\n');
}
export function writeArtifacts(directory: string, result: ScenarioResult): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'report.json'), JSON.stringify({ ...result, summary: summary(result) }, null, 2) + '\n');
  writeFileSync(join(directory, 'report.md'), reportMarkdown(result));
  writeFileSync(join(directory, 'transcript.md'), transcriptMarkdown(result));
  writeFileSync(join(directory, 'timings.csv'), timingsCsv(result));
}
