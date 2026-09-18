import crypto from 'node:crypto';

export function createPairingManager({
  getApiKey=()=>String(process.env.TRADING_API_KEY||''),
  now=()=>Date.now(),
  randomInt=(max)=>crypto.randomInt(0,max),
  ttlMs=5*60*1000,
  maxAttemptsPerClient=10,
  maxAttemptsTotal=30
}={}){
  let active=null;
  const attempts=new Map();
  let totalAttempts=0;

  const expireIfNeeded=()=>{
    if(active && now()>=active.expiresAt){active=null;attempts.clear();totalAttempts=0;}
  };

  return {
    start(){
      const apiKey=String(getApiKey()||'').trim();
      if(apiKey.length<20)throw new Error('TRADING_API_KEY is not configured');
      const code=String(randomInt(1_000_000)).padStart(6,'0');
      const createdAt=now();
      active={code,createdAt,expiresAt:createdAt+ttlMs};
      attempts.clear();totalAttempts=0;
      return {code,createdAt:new Date(createdAt).toISOString(),expiresAt:new Date(createdAt+ttlMs).toISOString(),ttlSeconds:Math.round(ttlMs/1000)};
    },
    claim(inputCode,client='unknown'){
      expireIfNeeded();
      if(!active)throw new Error('PAIRING_NOT_ACTIVE');
      const id=String(client||'unknown');
      const used=attempts.get(id)||0;
      if(used>=maxAttemptsPerClient || totalAttempts>=maxAttemptsTotal)throw new Error('PAIRING_RATE_LIMITED');
      const code=String(inputCode||'').trim();
      if(!/^\d{6}$/.test(code) || code!==active.code){
        attempts.set(id,used+1);totalAttempts++;
        throw new Error('PAIRING_CODE_INVALID');
      }
      const apiKey=String(getApiKey()||'').trim();
      if(apiKey.length<20)throw new Error('TRADING_API_KEY is not configured');
      const result={apiKey,pairedAt:new Date(now()).toISOString()};
      active=null;attempts.clear();totalAttempts=0;
      return result;
    },
    status(){expireIfNeeded();return active?{active:true,expiresAt:new Date(active.expiresAt).toISOString()}:{active:false};}
  };
}
