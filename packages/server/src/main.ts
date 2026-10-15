import { join } from 'node:path';
import { Store } from './store.js';
import { Service } from './service.js';
import { app } from './server.js';

// npm workspaces change cwd; retain the caller's original default database location.
const database = process.env.DB_PATH ?? join(process.env.INIT_CWD ?? process.cwd(), 'data/one-oven.sqlite');
const store = new Store(database);
const port = Number(process.env.PORT ?? 3000);
const server = app(new Service(store)).listen(port, '127.0.0.1', () => {
  console.log(`One Oven MCP: http://127.0.0.1:${port}/mcp`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
}
