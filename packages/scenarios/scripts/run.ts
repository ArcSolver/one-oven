import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonlTrace } from '@one-oven/agent/trace';
import { parseModelSpec } from '@one-oven/agent/config';
import { createModel } from '@one-oven/agent/models';
import { loadAll } from '../src/load.js';
import { runScenario, type ScenarioResult } from '../src/runner.js';
import { summary, writeArtifacts } from '../src/report.js';
import { EngineDriver } from '../src/modes/engine.js';
import { McpDriver } from '../src/modes/mcp.js';
import { AgentDriver } from '../src/modes/agent.js';
import type { Driver, Mode } from '../src/types.js';
import type { Scenario } from '../src/schema.js';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const flag = (name: string) => process.argv.includes(name);
const modes = (arg('--mode') ?? 'engine,mcp,agent').split(',') as Mode[];
const only = arg('--scenario');
// --device show[,<beat>=dot]: run on another device class, optionally switching before a beat (video takes).
const deviceArg = arg('--device')?.split(',') ?? [];
const deviceBase = deviceArg.find(d => !d.includes('=')) as Scenario['device'] | undefined;
const deviceSwitches = Object.fromEntries(deviceArg.filter(d => d.includes('=')).map(d => d.split('='))) as Record<string, Scenario['device']>;
for (const d of [deviceBase, ...Object.values(deviceSwitches)]) if (d && d !== 'show' && d !== 'dot') throw new Error(`Unknown device ${d}`);
const tag = arg('--tag');
if (tag && !/^[a-z0-9-]+$/.test(tag)) throw new Error('--tag uses a-z, 0-9 and -');
const live = flag('--live');
const runs = Number(arg('--runs') ?? (live ? 5 : 1));
const required = Number(arg('--required') ?? (live ? 4 : runs));
const scenarios = loadAll().filter(s => !only || only.split(',').includes(s.id));
if (!scenarios.length) throw new Error(`Unknown scenario ${only}`);
const root = join(process.env.INIT_CWD ?? process.cwd(), 'runs', 'scenarios');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

async function driverFor(mode: Mode): Promise<Driver> {
  const spec = live ? parseModelSpec(process.env) : undefined;
  if (live) {
    // Development policy: only the authorized local OpenAI-compatible endpoint; never Bedrock or other clouds here.
    if (spec!.provider !== 'openai' || !spec!.baseUrl || new URL(spec!.baseUrl).origin !== 'http://127.0.0.1:10100') {
      throw new Error('--live requires AGENT_MODEL=openai:<id> and OPENAI_BASE_URL=http://127.0.0.1:10100/v1');
    }
  }
  const model = spec && (() => createModel(spec, process.env));
  const voiceMode = process.env.AGENT_VOICE_MODE !== '0';
  switch (mode) {
    case 'engine': return new EngineDriver();
    case 'mcp': return new McpDriver();
    case 'agent': return new AgentDriver({ model, provider: spec ? `${spec.provider}:${spec.modelId}` : 'scripted', voiceMode });
    case 'voice': {
      const { VoiceDriver } = await import('../src/modes/voice.js');
      const { voiceEngines } = await import('../../voice/src/config.js');
      const engines = voiceEngines(process.env);
      if (['transcribe', 'polly'].includes(engines.sttName) || engines.ttsName === 'polly') throw new Error('Scenario voice runs use local engines only');
      return new VoiceDriver({ model, provider: spec ? `${spec.provider}:${spec.modelId}` : 'scripted', ...engines,
        speed: Number(arg('--speed') ?? Infinity) });
    }
    default: throw new Error(`Unknown mode ${mode}`);
  }
}
const table: { scenario: string; mode: string; passed: number; runs: number; ok: boolean; directories: string[] }[] = [];
let exit = 0;
for (const mode of modes) {
  if ((mode === 'engine' || mode === 'mcp') && live) throw new Error('--live applies to agent and voice modes');
  for (const scenario of scenarios) {
    const results: ScenarioResult[] = [];
    const directories: string[] = [];
    for (let trial = 1; trial <= runs; trial++) {
      const directory = join(root, scenario.id, `${stamp}-${mode}${live ? '-live' : ''}${tag ? `-${tag}` : ''}${runs > 1 ? `-t${trial}` : ''}`);
      mkdirSync(directory, { recursive: true });
      const run = deviceBase ? { ...scenario, device: deviceBase } : scenario;
      const result = await runScenario(run, await driverFor(mode), new JsonlTrace(join(directory, 'trace.jsonl')), directory, { deviceSwitches });
      writeArtifacts(directory, result);
      results.push(result); directories.push(directory);
      const s = summary(result);
      console.log(`${result.passed ? 'PASS' : 'FAIL'} ${scenario.id} ${mode}${live ? ' live' : ''}${runs > 1 ? ` t${trial}` : ''}: ${s.turns} turns, ${s.toolCalls} tools, p95 ${s.turnP95Ms?.toFixed(1)} ms${
      result.failures.length ? ` — [${result.failures[0].category}] ${result.failures[0].beat}: ${result.failures[0].message.slice(0, 300)}` : ''}`);
    }
    const passed = results.filter(r => r.passed).length;
    const ok = passed >= required;
    if (!ok) exit = 1;
    table.push({ scenario: scenario.id, mode: `${mode}${live ? ' live' : ''}`, passed, runs, ok, directories });
  }
}
const summaryPath = join(root, `summary-${stamp}${live ? '-live' : ''}.json`);
// The commit a summary was measured at, so a quoted pass rate can be checked against the code it describes.
const git = (...args: string[]) => { try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return undefined; } };
const commit = git('rev-parse', 'HEAD');
const dirty = commit === undefined ? undefined : git('status', '--porcelain', '--untracked-files=no') !== '';
writeFileSync(summaryPath, JSON.stringify({ live, required, modes, model: live ? process.env.AGENT_MODEL : 'scripted', commit, dirty, table }, null, 2) + '\n');
console.log(table.map(r => `${r.ok ? '✓' : '✗'} ${r.mode.padEnd(11)} ${r.scenario.padEnd(15)} ${r.passed}/${r.runs}`).join('\n'));
console.log(`Summary: ${summaryPath}`);
process.exitCode = exit;
