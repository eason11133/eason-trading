import { getConnection, initializeConnection } from './connection';
export type FocusSnapshot={symbol:string;name?:string;price:number;changePct?:number;high?:number;low?:number;vwap?:number;rvol?:number;volume?:number};
export function connectFocus(onSnapshot:(x:FocusSnapshot)=>void,onStatus?:(s:string)=>void){
 if(process.env.EXPO_PUBLIC_FOCUS_WS!=='true')return()=>{};
 let closed=false,ws:WebSocket|null=null,timer:ReturnType<typeof setTimeout>|null=null;
 const open=async()=>{if(closed)return;await initializeConnection();const c=getConnection();const base=c.apiUrl.replace(/^http/,'ws');const url=`${base}/v1/focus${c.apiKey?`?key=${encodeURIComponent(c.apiKey)}`:''}`;ws=new WebSocket(url);ws.onopen=()=>onStatus?.('connected');ws.onmessage=e=>{try{const x=JSON.parse(String(e.data));if(x.type==='market')onSnapshot(x.snapshot);if(x.type==='status')onStatus?.(x.status)}catch{}};ws.onerror=()=>onStatus?.('error');ws.onclose=()=>{onStatus?.('closed');if(!closed)timer=setTimeout(()=>{open().catch(()=>{})},3000)}};
 open().catch(()=>onStatus?.('error'));return()=>{closed=true;if(timer)clearTimeout(timer);try{ws?.close()}catch{}};
}
