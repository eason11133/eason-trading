export type ConnectionCredentials={apiUrl:string;apiKey:string;cloudUrl:string;deviceId:string;deviceToken:string;persisted:boolean};
export type PairingStatus='UNPAIRED'|'PAIRED';
export type MobileConnectionState='UNPAIRED'|'PAIRED_BUT_PC_OFFLINE'|'PAIRED_AND_ONLINE';
export type BackendProbeResult='REACHABLE'|'UNREACHABLE'|'AUTH_INVALID';

function validHttpUrl(value:string){
 try{const url=new URL(String(value||'').trim());return url.protocol==='http:'||url.protocol==='https:'}catch{return false}
}

export function derivePairingStatus(connection:ConnectionCredentials):PairingStatus{
 if(!connection.persisted)return 'UNPAIRED';
 if(!validHttpUrl(connection.apiUrl)||String(connection.apiKey||'').trim().length<20)return 'UNPAIRED';
 if(!validHttpUrl(connection.cloudUrl)||!/^dev_[0-9a-f-]{16,}$/i.test(String(connection.deviceId||'').trim()))return 'UNPAIRED';
 if(!/^[0-9a-f]{40,}$/i.test(String(connection.deviceToken||'').trim()))return 'UNPAIRED';
 return 'PAIRED';
}

export function deriveMobileConnectionState(connection:ConnectionCredentials,probe:boolean|BackendProbeResult):MobileConnectionState{
 if(derivePairingStatus(connection)==='UNPAIRED'||probe==='AUTH_INVALID')return 'UNPAIRED';
 return probe===true||probe==='REACHABLE'?'PAIRED_AND_ONLINE':'PAIRED_BUT_PC_OFFLINE';
}

export function clearedConnection(apiUrl='',apiKey=''):ConnectionCredentials{
 return {apiUrl,apiKey,cloudUrl:'',deviceId:'',deviceToken:'',persisted:false};
}
