import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { openSession } from './runtime.js';

const runtime = await openSession();
const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
console.log(`One Oven text chat (${runtime.session.provider}:${runtime.session.modelId}).`);
console.log(':dot, :show, :advance 10 (enabled simulation only), :mark (recording_t0), :quit');
console.log(`Trace: ${runtime.tracePath}`);
try {
  for await (const line of rl) {
    const text = line.trim();
    if (!text) continue;
    if (text === ':quit') break;
    try {
      if (text === ':mark') {
        runtime.trace.mark('recording_t0');
        console.log('Marked recording_t0');
      } else if (text === ':dot' || text === ':show') {
        runtime.device.deviceClass = text.slice(1) as 'dot' | 'show';
        console.log(`Device: ${runtime.device.deviceClass}`);
      } else if (text.startsWith(':advance ')) {
        if (!runtime.serverClock) throw new Error('Start a local server with ENABLE_DEV_CLOCK=1 and SIM_CLOCK_START first');
        await runtime.serverClock.advance(Number(text.slice(9)));
        console.log(`Kitchen clock: ${new Date(runtime.serverClock.now()).toISOString()}`);
      } else {
        await runtime.serverClock?.sync();
        console.log((await runtime.session.turn(text)).reply);
      }
    } catch (error) { console.error(error instanceof Error ? error.message : 'Chat failed'); }
  }
} finally { rl.close(); await runtime.session.close(); }
