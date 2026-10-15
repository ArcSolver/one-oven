import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { Service } from './service.js';
import { mcp } from './mcp/server.js';
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
