import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAll } from '../src/load.js';
import { summary, percentile } from '../src/report.js';
import { buildScript, findSource, scriptMarkdown, scriptSrt, timecode } from '../src/video-script.js';

const root = process.env.INIT_CWD ?? process.cwd();
const runs = join(root, 'runs', 'scenarios');
const sources = loadAll().map(scenario => {
  const source = findSource(runs, scenario);
  if (!source) throw new Error(`No passing run for ${scenario.id}; run npm run e2e:scenarios or npm run e2e:live first`);
  return source;
});
const toolMs = sources.flatMap(s => s.result.turns.flatMap(t => t.tools.map(c => c.ms)));
const calls = sources.reduce((n, s) => n + summary(s.result).toolCalls, 0);
const p95 = percentile(toolMs, .95) ?? 0;
const closing = `Four scenarios, ${calls} tool calls over MCP, every plan checked by an independent verifier. Tool round trip p95 ${Math.max(1, Math.round(p95))} milliseconds on a local machine.`;
const rows = buildScript(sources, closing);
const directory = join(root, 'docs', 'submission');
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'VIDEO_SCRIPT.md'), scriptMarkdown(rows, sources, root));
writeFileSync(join(directory, 'VIDEO_SCRIPT.srt'), scriptSrt(rows));
const total = rows.reduce((n, r) => n + r.seconds, 0);
console.log(`VIDEO_SCRIPT.md: ${rows.length} rows, ${timecode(total)} from ${sources.map(s => `${s.scenario.id}=${s.result.mode}${s.result.live ? '-live' : ''}`).join(', ')}`);
