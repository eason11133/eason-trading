import http from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createTradingMcp } from './tools.js';
const port=Number(process.env.MCP_PORT||8790); const token=process.env.MCP_BEARER_TOKEN;
const handler=createMcpHandler(createTradingMcp);
const nodeHandler=toNodeHandler(handler);
http.createServer((req,res)=>{
 if(req.url!=='/mcp'){res.writeHead(404);return res.end('not found');}
 if(token&&req.headers.authorization!==`Bearer ${token}`){res.writeHead(401,{'content-type':'application/json'});return res.end(JSON.stringify({error:'unauthorized'}));}
 return nodeHandler(req,res);
}).listen(port,()=>console.error(`Eason Trading MCP http://localhost:${port}/mcp`));
