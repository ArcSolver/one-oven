import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { SimClock } from '@one-oven/contracts';
import { Store } from '../../server/src/store.js';
import { Service } from '../../server/src/service.js';
import { app } from '../../server/src/http.js';
import { createGateway } from '../src/gateway.js';
import { ConversationSession } from '../src/session.js';
import { OneOvenMcpClient } from '../src/mcp.js';
import { ScriptedModel } from '../src/models/scripted.js';
import { MemoryTrace } from '../src/trace.js';
import { ServerClock } from '../src/runtime.js';

async function url(server: Server) {
  await once(server, 'listening'); const address = server.address();
  assert.ok(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`;
}
const close = (server: Server) => new Promise<void>(resolve => server.close(() => resolve()));
test('gateway JSON + SSE preserve one session and real MCP state; invalid/cross-origin requests are rejected', async () => {
  const clock = new SimClock('2026-10-15T17:05:00-05:00');
  const store = new Store(':memory:');
  const mcpServer = app(new Service(store, () => clock.now() / 60000)).listen(0, '127.0.0.1');
  const mcpUrl = await url(mcpServer);
  const traces: MemoryTrace[] = [];
  const gateway = createGateway(async () => {
    const trace = new MemoryTrace(); traces.push(trace);
    return new ConversationSession({ model: new ScriptedModel('weekday-3'), mcp: new OneOvenMcpClient(`${mcpUrl}/mcp`, trace),
      device: { deviceClass: 'dot', timezone: 'America/Chicago', nowIso: new Date(clock.now()).toISOString() }, clock, trace });
  });
  const server = gateway.app.listen(0, '127.0.0.1');
  const base = await url(server);
  const send = (utterance: string, accept = 'application/json', origin?: string) => fetch(`${base}/session/demo/turn`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: accept, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ utterance }),
  });
  try {
    assert.equal((await send('My kitchen has one oven.')).status, 200);
    const response = await send('I want salmon, rice and green beans on the table at 6:30 PM.', 'text/event-stream');
    assert.match(response.headers.get('content-type')!, /text\/event-stream/);
    const stream = await response.text();
    assert.match(stream, /event: start/); assert.match(stream, /event: turn/);
    const data = JSON.parse(stream.split('event: turn\ndata: ')[1].trim());
    const envelope = data.toolCalls.find((c: { name: string }) => c.name === 'plan_meal').result.structuredContent;
    assert.equal(store.plan(envelope.plan_id).version, 1);
    assert.equal(traces.length, 1);
    assert.equal((await send('')).status, 400);
    assert.equal((await send('next', 'application/json', 'http://evil.invalid')).status, 403);
    assert.equal((await fetch(`${base}/session/demo`, { method: 'DELETE' })).status, 204);
    await send('My kitchen has one oven.');
    assert.equal(traces.length, 2);
  } finally { await close(server); await gateway.close(); await close(mcpServer); store.close(); }
});
test('gateway rejects concurrent turns and returns a readable SSE error after failure', async () => {
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const gateway = createGateway(async () => ({ turn: async () => { entered(); await blocked; throw new Error('private'); }, close: async () => {} }));
  const server = gateway.app.listen(0, '127.0.0.1'); const base = await url(server);
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ utterance: 'next' }) };
  try {
    const first = fetch(`${base}/session/same/turn`, init); await ready;
    assert.equal((await fetch(`${base}/session/same/turn`, init)).status, 409);
    release(); const text = await (await first).text();
    assert.match(text, /event: error/); assert.ok(!text.includes('private'));
  } finally { release(); await close(server); await gateway.close(); }
});
test('simulation clock endpoint is absent by default, opt-in, monotonic, and same-origin only', async () => {
  const clock = new SimClock('2026-10-15T17:05:00-05:00');
  const store = new Store(':memory:');
  const service = new Service(store, () => clock.now() / 60000);
  const ordinary = app(service).listen(0, '127.0.0.1'); const ordinaryUrl = await url(ordinary);
  const simulated = app(service, { devClock: clock }).listen(0, '127.0.0.1'); const simulatedUrl = await url(simulated);
  try {
    assert.equal((await fetch(`${ordinaryUrl}/dev/clock`)).status, 404);
    const remote = new ServerClock(new URL(simulatedUrl)); await remote.sync();
    const before = remote.now(); await remote.advance(10); assert.equal(remote.now(), before + 600000);
    await assert.rejects(remote.advance(-1));
    assert.equal((await fetch(`${simulatedUrl}/dev/clock`, { headers: { Origin: 'http://evil.invalid' } })).status, 403);
    assert.equal(clock.now(), remote.now());
  } finally { await close(ordinary); await close(simulated); store.close(); }
});

test('session retains raw lint violations while returning safe speech and logs MCP domain errors', async () => {
  const { Model } = await import('@strands-agents/sdk');
  class UnsafeModel extends Model {
    getConfig() { return { modelId: 'test-only' }; }
    updateConfig() {}
    async *stream(): AsyncIterable<import('@strands-agents/sdk').ModelStreamEvent> {
      yield { type: 'modelMessageStartEvent', role: 'assistant' };
      yield { type: 'modelContentBlockStartEvent' };
      yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: 'Tap the screen to call set_timer.' } };
      yield { type: 'modelContentBlockStopEvent' };
      yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' };
    }
  }
  const clock = new SimClock('2026-10-15T17:05:00-05:00');
  const store = new Store(':memory:');
  const server = app(new Service(store, () => clock.now() / 60000)).listen(0, '127.0.0.1');
  const base = await url(server);
  const trace = new MemoryTrace();
  const make = (model: import('@strands-agents/sdk').Model) => new ConversationSession({ model, clock, trace,
    mcp: new OneOvenMcpClient(`${base}/mcp`, trace), device: { deviceClass: 'dot', timezone: 'America/Chicago', nowIso: new Date(clock.now()).toISOString() } });
  const unsafe = make(new UnsafeModel());
  const error = make(new ScriptedModel('weekday-3'));
  try {
    const result = await unsafe.turn('Hello');
    assert.equal(result.rawLint.ok, false);
    assert.equal(result.lint.ok, true);
    assert.equal(result.fallback, true);
    assert.equal(trace.records.find(r => r.type === 'turn')?.rawReply, 'Tap the screen to call set_timer.');
    const failure = await error.turn('The salmon needs five more minutes.');
    assert.equal(failure.toolCalls[0].result?.isError, true);
    assert.equal(failure.lint.ok, true);
  } finally { await unsafe.close(); await error.close(); await close(server); store.close(); }
});

test('compiled chat CLI switches device, advances the real simulation clock, and calls MCP', async () => {
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const clock = new SimClock('2026-10-15T17:05:00-05:00');
  const store = new Store(':memory:');
  const server = app(new Service(store, () => clock.now() / 60000), { devClock: clock }).listen(0, '127.0.0.1');
  const base = await url(server);
  const directory = mkdtempSync(join(tmpdir(), 'one-oven-cli-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/cli.js', import.meta.url))], {
    env: { ...process.env, INIT_CWD: directory, AGENT_MODEL: 'scripted:weekday-3', MCP_URL: `${base}/mcp`, ENABLE_DEV_CLOCK: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  const exited = once(child, 'exit');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    child.stdin.end(':show\n:dot\n:advance 10\nMy kitchen has one oven.\n:quit\n');
    const [code] = await exited;
    assert.equal(code, 0, errors);
    assert.match(output, /Device: show/); assert.match(output, /Device: dot/);
    assert.match(output, /Your kitchen has 1 oven/);
    assert.equal(clock.now(), Date.parse('2026-10-15T17:15:00-05:00'));
  } finally { clearTimeout(timeout); child.kill(); await close(server); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('voice handoff preserves MCP failures, releases speech once, and keeps plan steps after catalog refresh', async () => {
  const clock = new SimClock('2026-10-15T17:05:00-05:00');
  const store = new Store(':memory:');
  const server = app(new Service(store, () => clock.now() / 60000)).listen(0, '127.0.0.1');
  const base = await url(server), trace = new MemoryTrace();
  const prompts: string[] = [];
  class ObservedModel extends ScriptedModel {
    override async *stream(messages: import('@strands-agents/sdk').Message[], options?: import('@strands-agents/sdk').StreamOptions) {
      prompts.push(JSON.stringify(options?.systemPrompt));
      yield* super.stream(messages, options);
    }
  }
  const mcp = new OneOvenMcpClient(`${base}/mcp`, trace);
  const session = new ConversationSession({ model: new ObservedModel('weekday-3'), mcp, clock, trace, voiceMode: true, provider: 'scripted',
    device: { deviceClass: 'dot', timezone: 'America/Chicago', nowIso: new Date(clock.now()).toISOString() } });
  try {
    await session.prepare();
    const spoken: string[] = [];
    const error = await session.turn('The salmon needs five more minutes.', text => spoken.push(text));
    assert.ok(error.toolCalls.at(-1)?.result?.isError);
    assert.equal(error.modelRequests.length, 1); assert.deepEqual(spoken, [error.reply]);
    assert.equal(error.replySource, 'tool-say'); assert.equal(session.timers.list().length, 0);
    await session.turn('My kitchen has one oven.');
    await session.turn('I want salmon, rice and green beans on the table at 6:30 PM.');
    const tools = await mcp.listTools(); await mcp.callTool(tools.find(t => t.name === 'list_dishes')!, {});
    await session.turn('Hello');
    assert.match(prompts.at(-1)!, /salmon:1/); assert.match(prompts.at(-1)!, /pending/);
  } finally { await session.close(); await close(server); store.close(); }
});
