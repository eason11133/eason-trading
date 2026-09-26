import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {clearedConnection,derivePairingStatus} from './pairingState';
import type {ConnectionCredentials} from './pairingState';

const URL_KEY='eason_trading_api_url_v1';
const TOKEN_KEY='eason_trading_api_token_v1';
const CLOUD_URL_KEY='eason_trading_ledger_cloud_url_v1';
const DEVICE_ID_KEY='eason_trading_ledger_device_id_v1';
const DEVICE_TOKEN_KEY='eason_trading_ledger_device_token_v1';
const configuredDefaultUrl=String(process.env.EXPO_PUBLIC_TRADING_API_URL||'').trim();
const defaultUrl=configuredDefaultUrl?normalizeApiUrl(configuredDefaultUrl):(Platform.OS==='web'?'http://127.0.0.1:8787':'');
const defaultKey=String(process.env.EXPO_PUBLIC_TRADING_API_KEY||'');
let current:ConnectionCredentials=clearedConnection(defaultUrl,defaultKey);
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

export function connectionReady(c=current){return derivePairingStatus(c)==='PAIRED';}
export async function initializeConnection(){
 if(loaded)return current;if(loading)return loading;
 loading=(async()=>{
  try{
   const [url,key,cloudUrl,deviceId,deviceToken]=await Promise.all([getStored(URL_KEY),getStored(TOKEN_KEY),getStored(CLOUD_URL_KEY),getStored(DEVICE_ID_KEY),getStored(DEVICE_TOKEN_KEY)]);
   const stored={apiUrl:normalizeApiUrl(String(url||'')),apiKey:String(key||'').trim(),cloudUrl:String(cloudUrl||'').trim().replace(/\/+$/,''),deviceId:String(deviceId||'').trim(),deviceToken:String(deviceToken||'').trim(),persisted:true};
   current=derivePairingStatus(stored)==='PAIRED'?stored:clearedConnection(defaultUrl,defaultKey);
  }catch{current=clearedConnection(defaultUrl,defaultKey)}
  finally{loaded=true;loading=null}
  return current;
 })();
 return loading;
}
export function getConnection(){return current;}
export async function saveConnection(apiUrl:string,apiKey:string,ledgerCloud?:{url?:string;deviceId?:string;deviceToken?:string}|null){
 const url=normalizeApiUrl(apiUrl),key=String(apiKey||'').trim();
 if(!/^https?:\/\//i.test(url))throw new Error('Backend URL 格式不正確');
 if(Platform.OS!=='web'&&/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url))throw new Error('手機不能使用 127.0.0.1／localhost，請填電腦的 Wi-Fi IP');
 if(key.length<20)throw new Error('Backend token 不完整');
 const cloudUrl=String(ledgerCloud?.url||'').trim().replace(/\/+$/,''),deviceId=String(ledgerCloud?.deviceId||'').trim(),deviceToken=String(ledgerCloud?.deviceToken||'').trim();
 const next={apiUrl:url,apiKey:key,cloudUrl,deviceId,deviceToken,persisted:true};
 if(derivePairingStatus(next)!=='PAIRED')throw new Error('配對回應缺少有效的手機裝置憑證，請確認雲端監控設定後重新配對');
 await Promise.all([setStored(URL_KEY,url),setStored(TOKEN_KEY,key),setStored(CLOUD_URL_KEY,cloudUrl),setStored(DEVICE_ID_KEY,deviceId),setStored(DEVICE_TOKEN_KEY,deviceToken)]);
 current=next;loaded=true;return current;
}
export async function clearConnection(){await Promise.all([delStored(URL_KEY),delStored(TOKEN_KEY),delStored(CLOUD_URL_KEY),delStored(DEVICE_ID_KEY),delStored(DEVICE_TOKEN_KEY)]);current=clearedConnection(defaultUrl,defaultKey);loaded=true;return current;}
