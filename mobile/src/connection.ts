import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const URL_KEY='eason_trading_api_url_v1';
const TOKEN_KEY='eason_trading_api_token_v1';
const configuredDefaultUrl=String(process.env.EXPO_PUBLIC_TRADING_API_URL||'').trim();
const defaultUrl=configuredDefaultUrl?normalizeApiUrl(configuredDefaultUrl):(Platform.OS==='web'?'http://127.0.0.1:8787':'');
const defaultKey=String(process.env.EXPO_PUBLIC_TRADING_API_KEY||'');
let current={apiUrl:defaultUrl,apiKey:defaultKey,persisted:false};
let loaded=false;
let loading:Promise<typeof current>|null=null;

function webStorage(){try{return (globalThis as any).localStorage||null}catch{return null}}
async function getStored(key:string){if(Platform.OS==='web')return webStorage()?.getItem(key)||null;return SecureStore.getItemAsync(key);}
async function setStored(key:string,value:string){if(Platform.OS==='web'){webStorage()?.setItem(key,value);return;}await SecureStore.setItemAsync(key,value);}
async function delStored(key:string){if(Platform.OS==='web'){webStorage()?.removeItem(key);return;}await SecureStore.deleteItemAsync(key);}

export function normalizeApiUrl(input:string){
 let x=String(input||'').trim().replace(/\/+$/,'');
 if(!x)return '';
 if(!/^https?:\/\//i.test(x))x=`http://${x}`;
 try{const u=new URL(x);if(!u.port)u.port='8787';return u.toString().replace(/\/$/,'');}catch{return x;}
}

export function connectionReady(c=current){return !!(c.apiUrl&&c.apiKey&&c.apiKey.length>=20);}
export async function initializeConnection(){
 if(loaded)return current;if(loading)return loading;
 loading=(async()=>{
  const [url,key]=await Promise.all([getStored(URL_KEY),getStored(TOKEN_KEY)]);
  if(url&&key)current={apiUrl:normalizeApiUrl(url),apiKey:key,persisted:true};
  loaded=true;loading=null;return current;
 })();
 return loading;
}
export function getConnection(){return current;}
export async function saveConnection(apiUrl:string,apiKey:string){
 const url=normalizeApiUrl(apiUrl),key=String(apiKey||'').trim();
 if(!/^https?:\/\//i.test(url))throw new Error('Backend URL 格式不正確');
 if(Platform.OS!=='web'&&/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url))throw new Error('手機不能使用 127.0.0.1／localhost，請填電腦的 Wi-Fi IP');
 if(key.length<20)throw new Error('Backend token 不完整');
 await Promise.all([setStored(URL_KEY,url),setStored(TOKEN_KEY,key)]);
 current={apiUrl:url,apiKey:key,persisted:true};loaded=true;return current;
}
export async function clearConnection(){await Promise.all([delStored(URL_KEY),delStored(TOKEN_KEY)]);current={apiUrl:defaultUrl,apiKey:defaultKey,persisted:false};loaded=true;return current;}
