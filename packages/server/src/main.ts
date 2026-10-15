import { join } from 'node:path';
import { Store } from './store.js';
import { Service } from './service.js';
import { SimClock } from './clock.js';
import { app } from './server.js';

// npm workspaces change cwd; retain the caller's original default database location.
const database = process.env.DB_PATH ?? join(process.env.INIT_CWD ?? process.cwd(), 'data/one-oven.sqlite');
const store = new Store(database);
const port = Number(process.env.PORT ?? 3000);
const clock = process.env.ENABLE_DEV_CLOCK === '1' ? new SimClock(process.env.SIM_CLOCK_START ?? '') : undefined;
const service = new Service(store, clock ? () => Math.ceil(clock.now() / 60000) : undefined, clock ? () => clock.now() : undefined);
const server = app(service, { devClock: clock }).listen(port, '127.0.0.1', () => {
  console.log(`One Oven MCP: http://127.0.0.1:${port}/mcp`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
}
