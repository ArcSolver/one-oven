import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { openSession } from '@one-oven/agent/runtime';
import type { Backend, Runtime } from './app.js';

/** Default simulated start: the salmon-delay scenario's 5:05 PM in Chicago. */
export const DEFAULT_SIM_START = '2026-10-15T17:05:00-05:00';
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

async function waitFor(url: string, child: ChildProcess, label: string, ms = 30000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited with ${child.exitCode}`);
    try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (response.status < 500) return; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`${label} did not start at ${url}`);
}
async function stop(child?: ChildProcess): Promise<void> {
  if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  await exited;
  clearTimeout(timer);
}
/**
 * Each take spawns the real One Oven MCP server (packages/server/src/main.ts) as a child process
 * with the opt-in simulation clock and a fresh SQLite file, then opens a Strands session against it.
 */
export class LocalBackend implements Backend {
  private server?: ChildProcess;
  private runtime?: Runtime;
  constructor(readonly root: string, readonly env: NodeJS.ProcessEnv = process.env) {}
  async open() {
    await this.close();
    const id = `sim-${stamp()}`, dir = join(this.root, 'runs', id);
    mkdirSync(dir, { recursive: true });
    const port = Number(this.env.SIM_MCP_PORT ?? 3010);
    const mcpUrl = `http://127.0.0.1:${port}/mcp`;
    const env = { ...this.env, PORT: String(port), DB_PATH: join(dir, 'one-oven.sqlite'), ENABLE_DEV_CLOCK: '1',
      SIM_CLOCK_START: this.env.SIM_CLOCK_START ?? DEFAULT_SIM_START, INIT_CWD: this.root };
    this.server = spawn(process.execPath, ['--import', 'tsx', join(this.root, 'packages/server/src/main.ts')],
      { cwd: this.root, env, stdio: ['ignore', 'inherit', 'inherit'] });
    await waitFor(`http://127.0.0.1:${port}/dev/clock`, this.server, 'One Oven MCP server');
    this.runtime = await openSession({ ...env, MCP_URL: mcpUrl, AGENT_VOICE_MODE: this.env.AGENT_VOICE_MODE ?? '1',
      AGENT_DEVICE: this.env.AGENT_DEVICE ?? 'show' }, id);
    return { id, dir, runtime: this.runtime, mcpUrl };
  }
  async close(): Promise<void> {
    const runtime = this.runtime;
    this.runtime = undefined;
    try { await runtime?.session.close(); } finally { await stop(this.server); this.server = undefined; }
  }
}
/** Reuse a reachable local Whisper server, or start the one installed by `npm run voice:setup`. */
export async function startWhisper(root: string, env: NodeJS.ProcessEnv): Promise<{ ready: () => Promise<boolean>; stop: () => Promise<void> }> {
  const url = env.WHISPER_SERVER_URL;
  const reachable = async () => {
    if (!url) return !!env.WHISPER_MODEL;
    try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).status < 500; } catch { return false; }
  };
  if ((env.VOICE_STT ?? 'whisper') !== 'whisper' || !url || await reachable()) return { ready: async () => (env.VOICE_STT ?? 'whisper') !== 'whisper' || reachable(), stop: async () => {} };
  const tools = env.VOICE_TOOLS_DIR ?? join(root, '.local/voice');
  const binary = join(tools, 'whisper.cpp/build/bin/whisper-server'), model = env.WHISPER_MODEL ?? join(tools, 'models/ggml-base.en.bin');
  if (!existsSync(binary) || !existsSync(model)) return { ready: reachable, stop: async () => {} };
  const target = new URL(url);
  const child = spawn(binary, ['-m', model, '--host', target.hostname, '--port', target.port || '80', '-t', env.WHISPER_THREADS ?? '4', '-bs', '1', '-bo', '1', '-nc'],
    { stdio: 'ignore' });
  // A binary built for another OS fails to launch; text input keeps working and the UI reports voice as unavailable.
  const failed = new Promise<void>(resolve => child.once('error', error => { console.warn(`Whisper server not started: ${error.message}`); resolve(); }));
  await Promise.race([waitFor(url, child, 'Whisper server', 60000).catch(() => {}), failed]);
  return { ready: reachable, stop: () => stop(child) };
}
