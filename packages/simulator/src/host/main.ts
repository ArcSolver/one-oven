import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { voiceEngines } from '../../../voice/src/config.js';
import { createSimHost } from './app.js';
import { LocalBackend, startWhisper } from './backend.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const pkg = fileURLToPath(new URL('../../', import.meta.url));
const env: NodeJS.ProcessEnv = { ...process.env, INIT_CWD: process.env.INIT_CWD ?? root };
// The server and agent packages resolve each other through dist/; build once after npm ci.
if (!['contracts', 'agent', 'voice'].every(name => existsSync(`${root}packages/${name}/dist`))) {
  console.log('Building workspaces once (npm run build)…');
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
}
// Same default as .env.example: a warm loopback Whisper server, started below when installed.
if ((env.VOICE_STT ?? 'whisper') === 'whisper' && !env.WHISPER_SERVER_URL) env.WHISPER_SERVER_URL = 'http://127.0.0.1:18080';
const engines = voiceEngines(env);
const whisper = await startWhisper(root, env);
const host = createSimHost({ backend: new LocalBackend(root, env), ...engines, sttReady: whisper.ready,
  timezone: env.KITCHEN_TIMEZONE ?? 'America/Chicago', chime: await readFile(new URL('../../../voice/src/audio/chime.wav', import.meta.url)) });
await host.openTake();

const app = express();
app.use(host.router);
const server = createServer(app);
if (env.SIM_UI === 'dist') app.use(express.static(`${pkg}dist`));
else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({ root: pkg, configFile: `${pkg}vite.config.ts`, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(env.SIM_PORT ?? 5180);
server.listen(port, '127.0.0.1', () => {
  console.log(`One Oven simulator: http://127.0.0.1:${port}/  ·  film mode: http://127.0.0.1:${port}/?film=1`);
  console.log(`Model ${host.state().model} · sync log ${host.state().log}`);
});
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (closing) return;
  closing = true;
  server.close();
  void host.close().finally(() => whisper.stop()).finally(() => process.exit(0));
});
