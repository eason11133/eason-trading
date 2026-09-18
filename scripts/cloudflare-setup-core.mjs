import {spawnSync as nodeSpawnSync,spawn as nodeSpawn} from 'node:child_process';

export function semverAtLeast(v,min){
  const a=String(v).match(/\d+/g)?.slice(0,3).map(Number)||[0,0,0];
  const b=String(min).match(/\d+/g)?.slice(0,3).map(Number)||[0,0,0];
  while(a.length<3)a.push(0); while(b.length<3)b.push(0);
  for(let i=0;i<3;i++){if(a[i]>b[i])return true;if(a[i]<b[i])return false;} return true;
}
export function parseWorkerUrl(output){
  const m=String(output||'').match(/https:\/\/[A-Za-z0-9._-]+\.workers\.dev/);
  return m?.[0]?.replace(/\/$/,'')||null;
}

export const CURRENT_WORKERS_PAGES_URL='https://dash.cloudflare.com/?to=/:account/workers-and-pages';
export function parseWorkersDevOnboardingUrl(output){
  const text=String(output||'');
  const direct=text.match(/https:\/\/dash\.cloudflare\.com\/[A-Za-z0-9_-]+\/workers\/onboarding(?:[^\s\"']*)?/i)?.[0];
  // Wrangler 4.129 can still print the retired /workers/onboarding route.
  // Always send the user to Cloudflare's current Workers & Pages entry instead.
  return direct?CURRENT_WORKERS_PAGES_URL:null;
}
export function needsWorkersDevOnboarding(output){
  const text=String(output||'');
  return /register a workers\.dev subdomain/i.test(text)||/workers\/onboarding/i.test(text);
}
export function openExternalUrl(url,{spawn=nodeSpawn,platform=process.platform}={}){
  if(!/^https:\/\//i.test(String(url||'')))return false;
  try{
    let child;
    if(platform==='win32')child=spawn('cmd.exe',['/d','/s','/c','start','',url],{detached:true,stdio:'ignore',windowsHide:true});
    else if(platform==='darwin')child=spawn('open',[url],{detached:true,stdio:'ignore'});
    else child=spawn('xdg-open',[url],{detached:true,stdio:'ignore'});
    child?.unref?.();
    return true;
  }catch{return false;}
}
export function createWranglerRunner({cli,cwd,spawn=nodeSpawnSync,node=process.execPath,env=process.env}={}){
  if(!cli)throw new Error('Wrangler CLI path is required.');
  return function runWrangler(args,{capture=false,allowFailure=false,input=null,label=null}={}){
    if(!Array.isArray(args)||args.length===0)throw new Error('Wrangler argument array must be non-empty.');
    const opts={cwd,env,encoding:'utf8'};
    if(capture){opts.stdio=['pipe','pipe','pipe']; if(input!==null)opts.input=input;}
    else opts.stdio='inherit';
    const r=spawn(node,[cli,...args],opts);
    const code=Number.isInteger(r?.status)?r.status:1;
    if(r?.error&&!allowFailure)throw r.error;
    if(code!==0&&!allowFailure){
      const detail=capture?`${r?.stdout||''}${r?.stderr||''}`.trim():'';
      throw new Error(`${label||`wrangler ${args.join(' ')}`} failed with exit code ${code}${detail?`\n${detail}`:''}`);
    }
    return {code,stdout:String(r?.stdout||'').trim(),stderr:String(r?.stderr||'').trim()};
  };
}
