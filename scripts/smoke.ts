import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../src/store.js';
import { Service } from '../src/service.js';
import { app } from '../src/server.js';
import type { Plan } from '../src/engine.js';
const dir=mkdtempSync(join(tmpdir(),'one-oven-smoke-'));const path=join(dir,'state.sqlite');
let store=new Store(path);let now=30000000;const service=new Service(store,()=>now);
const listener=app(service).listen(0,'127.0.0.1');await once(listener,'listening');
const address=listener.address();assert.ok(address&&typeof address!=='string');
const url=new URL(`http://127.0.0.1:${address.port}/mcp`);
const timings:number[]=[];let negotiated='';
const transport=new StreamableHTTPClientTransport(url,{fetch:async(input,init)=>{
  const response=await fetch(input,init);
  const body=init?.body?JSON.parse(String(init.body)):null;
  if(body?.method==='initialize') {const json=await response.clone().json();negotiated=json.result.protocolVersion;assert.equal(body.params.protocolVersion,'2025-11-25');}
  else if(body?.method) assert.equal(new Headers(init?.headers).get('mcp-protocol-version'),'2025-11-25');
  return response;
}});
const client=new Client({name:'one-oven-smoke',version:'0.1.0'},{capabilities:{}});
async function call(name:string,args:Record<string,unknown>,error=false):Promise<any> {
  const start=performance.now();const r=await client.callTool({name,arguments:args});timings.push(performance.now()-start);
  assert.equal(Boolean(r.isError),error,JSON.stringify(r));
  if(error)return r;
  const d=r.structuredContent as any;assert.ok(d.say);assert.ok(d.display);assert.doesNotMatch(d.say,/look at the screen|tools\/call/);return d;
}
try {
  await client.connect(transport);assert.equal(negotiated,'2025-11-25');
  const list=await client.listTools();assert.equal(list.tools.length,6);
  const k=await call('set_kitchen',{ovens:1,burners:4,helpers:1});
  const ds=await call('list_dishes',{});assert.equal(ds.dishes.length,8);
  const p=await call('plan_meal',{dish_ids:['salmon','rice','green-beans'],serve_at:new Date((now+180)*60000).toISOString(),kitchen_id:k.kitchen_id});
  const read=async():Promise<Plan>=>{const r=await client.readResource({uri:`plan://${p.plan_id}`});return JSON.parse((r.contents[0] as {text:string}).text);};
  let plan=await read();now=Math.min(...plan.steps.map(s=>s.start));
  const n=await call('next_step',{plan_id:p.plan_id});assert.equal(n.step.status,'running');
  plan=await read();const before=structuredClone(plan);const running=plan.steps.find(s=>s.status==='running')!;
  const revised=await call('report_delay',{plan_id:p.plan_id,dish_id:running.dish_id,minutes:5});
  assert.equal(revised.plan_id,p.plan_id);assert.equal(revised.version,plan.version+1);assert.ok(revised.changed_steps.length>0);
  plan=await read();assert.equal(plan.steps.find(s=>s.step_id===running.step_id)!.start,running.start);
  assert.equal(plan.steps.find(s=>s.step_id===running.step_id)!.end,running.end+5);
  const actual=plan.steps.filter(s=>{const old=before.steps.find(o=>o.step_id===s.step_id)!;return s.start!==old.start||s.end!==old.end;}).map(s=>s.step_id).sort();
  assert.deepEqual(revised.changed_steps.map((s:any)=>s.step_id).sort(),actual);
  now=plan.steps.find(s=>s.step_id===running.step_id)!.end;
  await call('next_step',{plan_id:p.plan_id,done_step_id:running.step_id});
  plan=await read();assert.equal(plan.steps.find(s=>s.step_id===running.step_id)!.status,'done');
  const untouched=plan.steps.find(s=>s.dish_id!==running.dish_id && plan.steps.filter(o=>o.dish_id===s.dish_id).every(o=>o.status==='pending'))!;
  assert.ok(untouched);const swapped=await call('swap_dish',{plan_id:p.plan_id,dish_id:untouched.dish_id,replacement_id:'potatoes'});assert.equal(swapped.plan_id,p.plan_id);assert.ok(swapped.removed_step_ids.length);
  // Walk real tool transitions with an injected clock to the exact demo moment.
  const demo=await call('plan_meal',{dish_ids:['salmon','rice','green-beans'],serve_at:new Date((now+180)*60000).toISOString(),kitchen_id:k.kitchen_id});
  let demoPlan=store.plan(demo.plan_id);
  for(let guard=0;guard<40&&!demoPlan.steps.some(s=>s.step_id==='salmon:1'&&s.status==='running');guard++) {
    const events=demoPlan.steps.filter(s=>s.status!=='done').map(s=>s.status==='running'?s.end:s.start).filter(t=>t>=now);
    now=Math.min(...events);assert.ok(Number.isFinite(now));
    const ended=demoPlan.steps.filter(s=>s.status==='running'&&s.end<=now);
    for(const s of ended) await call('next_step',{plan_id:demo.plan_id,done_step_id:s.step_id});
    await call('next_step',{plan_id:demo.plan_id});demoPlan=store.plan(demo.plan_id);
  }
  assert.equal(demoPlan.steps.find(s=>s.step_id==='salmon:1')!.status,'running');
  const salmonDelay=await call('report_delay',{plan_id:demo.plan_id,dish_id:'salmon',minutes:5});
  const demoAfter=store.plan(demo.plan_id);
  assert.equal(demoAfter.serve,demoPlan.serve+5);
  assert.deepEqual(demoAfter.steps.filter(s=>s.dish_id!=='salmon'),demoPlan.steps.filter(s=>s.dish_id!=='salmon'));
  assert.deepEqual(salmonDelay.changed_steps.map((s:any)=>s.step_id).sort(),['salmon:1','salmon:2']);
  assert.deepEqual(demoAfter.steps.filter(s=>s.status==='done'),demoPlan.steps.filter(s=>s.status==='done'));
  const valid=await read();await call('report_delay',{plan_id:p.plan_id,dish_id:'unknown',minutes:5},true);assert.deepEqual(await read(),valid);
  await call('report_delay',{plan_id:p.plan_id,dish_id:'salmon',minutes:-1},true);
  await call('plan_meal',{dish_ids:['rice','rice'],serve_at:new Date((now+180)*60000).toISOString(),kitchen_id:k.kitchen_id},true);
  await client.readResource({uri:'dish://salmon'});assert.ok((await client.listResources()).resources.length>=9);assert.equal((await client.listResourceTemplates()).resourceTemplates.length,2);
  assert.equal((await fetch(url,{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(url)).status,405);
  // Close and reopen the actual SQLite file, then read through HTTP again.
  store.close();store=new Store(path);(service as {store:Store}).store=store;
  assert.deepEqual(await read(),valid);assert.deepEqual(store.kitchen(k.kitchen_id),{ovens:1,burners:4,helpers:1});
  console.log(JSON.stringify({status:'PASS',protocol:negotiated,tools:list.tools.map(t=>t.name),changed_steps:actual,salmon_demo:{serve_shift_minutes:demoAfter.serve-demoPlan.serve,changed_steps:salmonDelay.changed_steps.map((s:any)=>s.step_id)},persistence:'SQLite reopen + HTTP resources/read passed',latency_ms:{calls:timings.length,max:+Math.max(...timings).toFixed(2),mean:+(timings.reduce((a,b)=>a+b)/timings.length).toFixed(2)}},null,2));
} finally {await client.close();await new Promise<void>((resolve,reject)=>listener.close(e=>e?reject(e):resolve()));store.close();rmSync(dir,{recursive:true,force:true});}
