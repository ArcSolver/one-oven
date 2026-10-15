import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Service } from './service.js';
import { dish, dishes } from './dishes.js';
const id=z.string().min(1).max(100);
export function mcp(service:Service) {
  const server=new McpServer({name:'one-oven',version:'0.1.0'});
  const result=(fn:()=>Record<string,unknown>):CallToolResult=>{try {const data=fn();return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};}catch(e){return {isError:true,content:[{type:'text',text:e instanceof Error?e.message:'Unable to update the meal.'}]};}};
  server.registerTool('set_kitchen',{description:'Describe the ovens, burners, and people available to cook. Returns a kitchen ID for planning dinner.',inputSchema:{ovens:z.number().int().min(0).max(4),burners:z.number().int().min(0).max(8),helpers:z.number().int().min(1).max(4).describe('Total cooks, including you; use 1 for one pair of hands.')}},a=>result(()=>service.setKitchen(a)));
  server.registerTool('list_dishes',{description:'Find dishes by course and total cooking time. Returns dish IDs to use in a meal plan.',inputSchema:{course:z.enum(['main','side']).optional(),max_minutes:z.number().int().positive().max(1440).optional()},annotations:{readOnlyHint:true}},a=>result(()=>service.listDishes(a.course,a.max_minutes)));
  server.registerTool('plan_meal',{description:'Plan selected dishes backward from a serving time using your kitchen. Returns a stable plan ID and the first action.',inputSchema:{dish_ids:z.array(id).min(1).max(8),serve_at:z.string().datetime({offset:true}),kitchen_id:id}},a=>result(()=>service.planMeal(a.dish_ids,a.serve_at,a.kitchen_id)));
  server.registerTool('next_step',{description:'Get the next available action and start it when its scheduled time arrives. Optionally confirm that a running step is complete.',inputSchema:{plan_id:id,done_step_id:id.optional()}},a=>result(()=>service.nextStep(a.plan_id,a.done_step_id)));
  server.registerTool('report_delay',{description:'Add time to the first unfinished step of a dish. Preserves completed work and returns only changed steps with the revised serving time.',inputSchema:{plan_id:id,dish_id:id,minutes:z.number().int().min(1).max(180)}},a=>result(()=>service.reportDelay(a.plan_id,a.dish_id,a.minutes)));
  server.registerTool('swap_dish',{description:'Replace a dish that has not started cooking. Keeps the plan ID and returns the new version and changed steps.',inputSchema:{plan_id:id,dish_id:id,replacement_id:id}},a=>result(()=>service.swapDish(a.plan_id,a.dish_id,a.replacement_id)));
  server.registerResource('dish',new ResourceTemplate('dish://{id}',{list:async()=>({resources:dishes.map(d=>({uri:`dish://${d.dish_id}`,name:d.name,mimeType:'application/json'}))})}),{description:'Original recipe timing fixtures and resource requirements.',mimeType:'application/json'},async(uri,{id})=>({contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(dish(String(id)))}]}));
  server.registerResource('plan',new ResourceTemplate('plan://{id}',{list:async()=>({resources:service.store.planIds().map(id=>({uri:`plan://${id}`,name:id,mimeType:'application/json'}))})}),{description:'Current persisted plan, version and explicit step states.',mimeType:'application/json'},async(uri,{id})=>({contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(service.store.plan(String(id)))}]}));
  return server;
}
export function app(service:Service) {
  const app=createMcpExpressApp({host:'127.0.0.1'});
  app.use('/mcp',(req,res,next)=>{
    const origin=req.headers.origin;
    if(origin && origin!==`http://${req.headers.host}`) {res.status(403).json({error:'Origin not allowed'});return;}
    next();
  });
  app.post('/mcp',async(req,res)=>{
    const server=mcp(service);const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    res.on('close',()=>{void transport.close();void server.close();});
    try {await server.connect(transport);await transport.handleRequest(req,res,req.body);}catch {if(!res.headersSent)res.status(500).json({jsonrpc:'2.0',id:null,error:{code:-32603,message:'Internal server error'}});}
  });
  app.get('/mcp',(_req,res)=>{res.status(405).set('Allow','POST').end();});
  app.delete('/mcp',(_req,res)=>{res.status(405).set('Allow','POST').end();});
  return app;
}
