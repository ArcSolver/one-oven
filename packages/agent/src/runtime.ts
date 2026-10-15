import { SystemClock, type Clock } from '@one-oven/contracts';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseModelSpec } from './config.js';
import { createModel } from './models.js';
import { OneOvenMcpClient } from './mcp.js';
import { ConversationSession, type DeviceContext } from './session.js';
import { JsonlTrace } from './trace.js';

export class ServerClock implements Clock {
  private time: number | undefined;
  constructor(readonly url: URL) {}
  now(): number { return this.time ?? Date.now(); }
  private async request(minutes?: number): Promise<void> {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(this.url.hostname)) throw new Error('Clock commands require a loopback server');
    const response = await fetch(new URL('/dev/clock', this.url), minutes === undefined
      ? { signal: AbortSignal.timeout(3000) }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes }), signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('This server has no enabled simulation clock');
    const body = await response.json() as { kind: string; nowIso: string };
    if (body.kind !== 'sim' || !Number.isFinite(Date.parse(body.nowIso))) throw new Error('Invalid clock response');
    this.time = Date.parse(body.nowIso);
  }
  async sync(): Promise<void> { await this.request(); }
  async advance(minutes: number): Promise<void> { await this.request(minutes); }
}
export async function openSession(env: NodeJS.ProcessEnv = process.env, id: string = randomUUID()) {
  const url = env.MCP_URL ?? 'http://127.0.0.1:3000/mcp';
  const spec = parseModelSpec(env);
  const trace = new JsonlTrace(join(env.INIT_CWD ?? process.cwd(), 'runs', id, 'trace.jsonl'));
  const mcp = new OneOvenMcpClient(url, trace);
  const device: DeviceContext = { deviceClass: env.AGENT_DEVICE === 'show' ? 'show' : 'dot',
    timezone: env.KITCHEN_TIMEZONE ?? 'America/Chicago', nowIso: new Date().toISOString() };
  new Intl.DateTimeFormat('en', { timeZone: device.timezone });
  let clock: Clock = new SystemClock();
  let serverClock: ServerClock | undefined;
  // No probe or clock endpoint on ordinary production sessions.
  if (env.ENABLE_DEV_CLOCK === '1') { serverClock = new ServerClock(new URL(url)); await serverClock.sync(); clock = serverClock; }
  try {
    await mcp.listTools();
    const session = new ConversationSession({ model: createModel(spec, env), mcp, device, clock, trace,
      provider: spec.provider, autoTimers: env.HOST_AUTO_TIMERS === '1' });
    return { session, device, serverClock, tracePath: trace.path };
  } catch (error) { await mcp.disconnect(); throw error; }
}
