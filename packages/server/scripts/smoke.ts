import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PlanSchema, ToolErrorSchema, assertSpeech, defaultOven, type Plan } from '@one-oven/contracts';
import { Store } from '../src/store.js';
import { Service } from '../src/service.js';
import { app } from '../src/server.js';
import { verifyPlan } from '../src/engine/verify.js';
import { dishes } from '../src/dishes.js';

const dir = mkdtempSync(join(tmpdir(), 'one-oven-smoke-'));
const path = join(dir, 'state.sqlite');
let store = new Store(path);
let now = Date.parse('2026-10-15T17:05:00-05:00') / 60000;
const service = new Service(store, () => now);
const listener = app(service).listen(0, '127.0.0.1');
await once(listener, 'listening');
const address = listener.address();
assert.ok(address && typeof address !== 'string');
const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
const timings: number[] = [];
let negotiated = '';
const transport = new StreamableHTTPClientTransport(url, { fetch: async (input, init) => {
  const response = await fetch(input, init);
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (body?.method === 'initialize') {
    negotiated = (await response.clone().json()).result.protocolVersion;
    assert.equal(body.params.protocolVersion, '2025-11-25');
  } else if (body?.method) assert.equal(new Headers(init?.headers).get('mcp-protocol-version'), '2025-11-25');
  return response;
} });
const client = new Client({ name: 'one-oven-smoke', version: '0.2.0' }, { capabilities: {} });
async function call(name: string, args: Record<string, unknown>, error = false, requestId?: string): Promise<any> {
  const start = performance.now();
  const result = await client.callTool({ name, arguments: args, ...(requestId ? { _meta: { 'io.oneoven/request_id': requestId } } : {}) });
  timings.push(performance.now() - start);
  assert.equal(Boolean(result.isError), error, JSON.stringify(result));
  const data = result.structuredContent as any;
  assertSpeech(data.say);
  assert.equal((result.content as { text: string }[])[0].text, data.say);
  if (error) ToolErrorSchema.parse(data);
  else assert.ok(data.display);
  for (const timer of data.timer_suggestions ?? []) assertSpeech(timer.say);
  return data;
}
async function read(id: string): Promise<Plan> {
  const result = await client.readResource({ uri: `plan://${id}` });
  const plan = PlanSchema.parse(JSON.parse((result.contents[0] as { text: string }).text));
  verifyPlan(plan, dishes);
  return plan;
}
try {
  await client.connect(transport);
  assert.equal(negotiated, '2025-11-25');
  const list = await client.listTools();
  assert.equal(list.tools.length, 6);
  for (const tool of list.tools) assert.ok((tool.description?.match(/\./g) ?? []).length <= 2);
  const k = await call('set_kitchen', { ovens: 1, burners: 4, helpers: 1, timezone: 'America/Chicago' });
  assert.equal((await call('list_dishes', {})).dishes.length, 8);
  const p = await call('plan_meal', { dish_ids: ['salmon', 'rice', 'green-beans'], serve_at: '18:30', kitchen_id: k.kitchen_id });
  assert.equal(p.serve_at_local, '6:30 PM');
  let plan = await read(p.plan_id);
  for (let guard = 0; guard < 100 && !plan.steps.some(s => s.step_id === 'salmon:1' && s.status === 'running'); guard++) {
    const events = plan.steps.filter(s => s.status !== 'done').map(s => s.status === 'running' ? s.end : s.start).filter(t => t >= now);
    now = Math.min(...events);
    assert.ok(Number.isFinite(now));
    for (const s of plan.steps.filter(s => s.status === 'running' && s.end <= now)) await call('next_step', { plan_id: p.plan_id, done_step_id: s.step_id });
    const current = await read(p.plan_id);
    if (!current.steps.some(s => s.status === 'running' && s.end <= now)) await call('next_step', { plan_id: p.plan_id, allow_repeat: true });
    plan = await read(p.plan_id);
  }
  assert.equal(plan.steps.find(s => s.step_id === 'salmon:1')!.status, 'running');
  const before = structuredClone(plan);
  const args = { plan_id: p.plan_id, dish_id: 'salmon', minutes: 5 };
  const revised = await call('report_delay', args);
  plan = await read(p.plan_id);
  assert.equal(revised.serve_at_local, '6:35 PM');
  assert.equal(plan.version, before.version + 1);
  assert.deepEqual(revised.changed_steps.map((s: any) => s.step_id).sort(), ['salmon:1', 'salmon:2']);
  assert.deepEqual(plan.steps.filter(s => s.dish_id !== 'salmon'), before.steps.filter(s => s.dish_id !== 'salmon'));
  const duplicate = await call('report_delay', args);
  assert.equal(duplicate.deduplicated, true);
  assert.match(duplicate.say, /already added 5/);
  assert.deepEqual(await read(p.plan_id), plan);
  // Argument and metadata request IDs share one namespace, including stale-version replay.
  const explicit = { ...args, based_on_version: plan.version, allow_repeat: true };
  const keyed = await call('report_delay', explicit, false, 'smoke-delay-0001');
  const replay = await call('report_delay', { ...explicit, request_id: 'smoke-delay-0001' });
  assert.deepEqual(replay, { ...keyed, deduplicated: true });
  assert.equal((await call('report_delay', { ...explicit, minutes: 6 }, true, 'smoke-delay-0001')).error_code, 'request_id_reused');
  const valid = await read(p.plan_id);
  assert.equal((await call('report_delay', { ...args, based_on_version: 1 }, true)).error_code, 'version_conflict');
  await call('report_delay', { ...args, minutes: -1 }, true);
  await call('report_delay', { ...args, dish_id: 'unknown' }, true);
  await call('plan_meal', { dish_ids: ['rice', 'rice'], serve_at: '18:30', kitchen_id: k.kitchen_id }, true);
  assert.deepEqual(await read(p.plan_id), valid);
  const swapPlan = await call('plan_meal', { dish_ids: ['salmon', 'rice', 'green-beans'], serve_at: new Date((now + 180) * 60000).toISOString(), kitchen_id: k.kitchen_id });
  const swapped = await call('swap_dish', { plan_id: swapPlan.plan_id, dish_id: 'green-beans', replacement_id: 'carrots' });
  assert.equal(swapped.plan_id, swapPlan.plan_id);
  assert.equal(swapped.version, 2);
  assert.equal(swapped.removed_step_ids.length, 4);
  await read(swapped.plan_id);
  await client.readResource({ uri: 'dish://salmon' });
  assert.ok((await client.listResources()).resources.length >= 10);
  assert.equal((await client.listResourceTemplates()).resourceTemplates.length, 2);
  assert.equal((await fetch(url, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(url)).status, 405);
  const history = store.events(p.plan_id);
  store.close();
  store = new Store(path);
  (service as { store: Store }).store = store;
  assert.deepEqual(await read(p.plan_id), valid);
  assert.deepEqual(store.events(p.plan_id), history);
  assert.deepEqual(store.kitchen(k.kitchen_id), { ovens: [defaultOven()], burners: 4, helpers: 1, timezone: 'America/Chicago' });
  assert.equal((await call('report_delay', explicit, false, 'smoke-delay-0001')).deduplicated, true);
  console.log(JSON.stringify({ status: 'PASS', protocol: negotiated, tools: list.tools.map(t => t.name),
    salmon_demo: { serve_local: revised.serve_at_local, changed_steps: revised.changed_steps.map((s: any) => s.step_id), deduplicated: duplicate.deduplicated },
    persistence: 'SQLite reopen + plans, history, idempotency + HTTP resources/read passed',
    latency_ms: { calls: timings.length, max: +Math.max(...timings).toFixed(2), mean: +(timings.reduce((a,b) => a+b) / timings.length).toFixed(2) } }, null, 2));
} finally {
  await client.close();
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
