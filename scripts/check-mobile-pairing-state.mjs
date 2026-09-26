import assert from 'node:assert/strict';
import {clearedConnection,deriveMobileConnectionState,derivePairingStatus} from '../mobile/src/pairingState.ts';

const valid={apiUrl:'http://192.168.1.23:8787',apiKey:'a'.repeat(64),cloudUrl:'https://cloud.example.test',deviceId:'dev_12345678-1234-1234-1234-123456789abc',deviceToken:'b'.repeat(64),persisted:true};
const state=(connection,online)=>deriveMobileConnectionState(connection,online);

assert.equal(state(clearedConnection(),false),'UNPAIRED','A: fresh install');
assert.equal(state(clearedConnection('http://192.168.1.23:8787'),false),'UNPAIRED','B: fresh install while backend is offline');
assert.equal(state(valid,false),'PAIRED_BUT_PC_OFFLINE','C: paired while backend is offline');
assert.equal(state(valid,true),'PAIRED_AND_ONLINE','D: paired while backend is online');
assert.equal(state({...valid,apiUrl:'not a URL'},true),'UNPAIRED','E: malformed SecureStore state');
assert.equal(state({...valid,deviceToken:''},false),'UNPAIRED','F: partial credentials');
assert.equal(derivePairingStatus({...valid}),'PAIRED','G: app update preserves complete valid credentials');
assert.equal(state(clearedConnection(valid.apiUrl,valid.apiKey),true),'UNPAIRED','H: clearConnection reset model');
assert.equal(state({...valid,persisted:false},true),'UNPAIRED','unpersisted build defaults are never pairing proof');
assert.equal(state({...valid,apiKey:'old-token'},false),'UNPAIRED','stale short token');
assert.equal(state({...valid,apiKey:'c'.repeat(64)},'AUTH_INVALID'),'UNPAIRED','stale well-formed token rejected by backend');
assert.equal(state(valid,'UNREACHABLE'),'PAIRED_BUT_PC_OFFLINE','reachability failure is not pairing proof or disproof');

console.log('Mobile pairing state regression checks passed: A-H and stale/default credential cases.');
