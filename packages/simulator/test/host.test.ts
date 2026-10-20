import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { SimClock } from '@one-oven/contracts';
import { openSession } from '@one-oven/agent/runtime';
import { Store } from '../../server/src/store.js';
import { Service } from '../../server/src/service.js';
import { app as mcpApp } from '../../server/src/http.js';
import { SilentTts } from '../../voice/src/tts/silent.js';
import { FixtureStt } from '../../voice/src/stt/fixture.js';
import { pcmToClip } from '../../voice/src/audio/clip.js';
import { downsample, encodeWav } from '../src/shared/wav.js';
import { clipPcm } from '../../voice/src/audio/clip.js';
import { createSimHost, type Backend } from '../src/host/app.js';
import { SyncLog } from '../src/host/synclog.js';
import { nextEvent, sameDayAt } from '../src/host/state.js';

const listen = async (server: Server) => { await once(server, 'listening'); return (server.address() as { port: number }).port; };

test('host turns go through the real MCP client and write the sync log', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'one-oven-sim-'));
  const clock = new SimClock('2026-10-15T17:05:00-05:00');
  const store = new Store(':memory:');
  const service = new Service(store, () => Math.ceil(clock.now() / 60000), () => clock.now());
  const server = mcpApp(service, { devClock: clock }).listen(0, '127.0.0.1');
  const port = await listen(server);
  const backend: Backend = {
    async open() {
      const runtime = await openSession({ MCP_URL: `http://127.0.0.1:${port}/mcp`, AGENT_MODEL: 'scripted:weekday-3', ENABLE_DEV_CLOCK: '1',
        AGENT_VOICE_MODE: '1', INIT_CWD: dir, KITCHEN_TIMEZONE: 'America/Chicago' }, 'take');
      this.close = () => runtime.session.close();
      return { id: 'take', dir: join(dir, 'runs/take'), runtime, mcpUrl: `http://127.0.0.1:${port}/mcp` };
    },
    async close() {},
  };
  const host = createSimHost({ backend, stt: new FixtureStt(), tts: new SilentTts(), sttName: 'fixture', ttsName: 'silent',
    sttReady: async () => true, timezone: 'America/Chicago', chime: pcmToClip(new Uint8Array(32)).wav });
  await host.openTake();
  const web = express().use(host.router).listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${await listen(web)}`;
  const post = async (path: string, body: unknown) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await post('/api/turn', { utterance: 'My kitchen has one oven, four burners, and one cook.' })).status, 200);
    const plan = await post('/api/turn', { utterance: 'I want salmon, rice and green beans on the table at 6:30 PM.' });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.state.plan.serve_at_local, '6:30 PM');
    assert.deepEqual(plan.body.state.plan.dish_ids, ['salmon', 'rice', 'green-beans']);
    assert.equal(plan.body.state.last.tools[0].name, 'plan_meal');
    assert.equal(plan.body.speech[0].kind, 'reply');
    const advanced = await post('/api/clock', { to: 'next' });
    assert.equal(advanced.body.clock.local, '5:55 PM');
    assert.equal((await post('/api/clock', { at: '17:50' })).status, 400, 'the clock never moves backwards');
    assert.equal((await post('/api/device', { device: 'dot' })).body.device, 'dot');
    const cross = await fetch(`${base}/api/state`, { headers: { Origin: 'http://evil.example' } });
    assert.equal(cross.status, 403);
    const records = readFileSync(join(dir, 'runs/take/sync.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const types = records.map(r => r.type);
    for (const type of ['take_start', 'turn_start', 'tool_return', 'plan', 'reply_ready', 'tts_ready', 'turn_end', 'clock', 'device']) assert.ok(types.includes(type), type);
    assert.equal(records[0].protocol, '2025-11-25');
    assert.ok(records[0].t0_mono_ms > 0 && records[0].t0_mono_ms < performance.now());
    assert.ok(records.every((r, i) => i === 0 || r.t_ms >= records[i - 1].t_ms));
  } finally {
    await host.close();
    web.close(); server.close(); store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('sync log time never decreases and maps browser time after pairing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'one-oven-log-'));
  const times = [1000, 1010, 1005, 1020, 1030];
  const log = new SyncLog(join(dir, 's.jsonl'), () => times.shift() ?? 1040, () => 0);
  log.write('a'); log.write('b'); log.write('c');
  log.sync(100, 104, 25);
  log.write('ui', { ui_ms: 200 });
  const records = readFileSync(join(dir, 's.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(records.map(r => r.t_ms), [10, 10, 20, 30, 40]);
  assert.equal(records.at(-1).ui_t_ms, 200 + 25 - 102);
  rmSync(dir, { recursive: true, force: true });
});
test('browser WAV matches the voice package clip format', () => {
  const samples = new Float32Array(48000).map((_, i) => Math.sin(i / 10) * 0.5);
  const wav = encodeWav(downsample(samples, 48000));
  assert.equal(clipPcm({ wav, sampleRate: 16000 }).length, 16000 * 2);
  assert.equal(downsample(new Float32Array(441), 44100).length, 160);
});
test('clock helpers follow the scenario runner', () => {
  const now = Date.parse('2026-10-15T18:18:00-05:00');
  assert.equal(sameDayAt(now, '18:20', 'America/Chicago'), Date.parse('2026-10-15T18:20:00-05:00'));
  assert.ok(Number.isNaN(sameDayAt(now, '25:00', 'America/Chicago')));
  const plan = { steps: [{ status: 'running', end: now / 60000 + 5, start: 0 }, { status: 'pending', start: now / 60000 + 2, end: 0 }] } as never;
  assert.equal(nextEvent(plan, now), now + 2 * 60000);
});
