import { Store } from './store.js';
import { Service } from './service.js';
import { app } from './server.js';
const store=new Store(process.env.DB_PATH??'data/one-oven.sqlite');
const port=Number(process.env.PORT??3000);
const server=app(new Service(store)).listen(port,'127.0.0.1',()=>console.log(`One Oven MCP: http://127.0.0.1:${port}/mcp`));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
