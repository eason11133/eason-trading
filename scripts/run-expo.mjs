import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolveMobileTooling} from './mobile-tooling.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mobile=path.join(root,'mobile');
const {expoCli}=resolveMobileTooling(root);
const args=process.argv.slice(2);
if(!args.length)throw new Error('Expo command arguments are required.');
const child=spawn(process.execPath,[expoCli,...args],{cwd:mobile,env:process.env,stdio:'inherit',windowsHide:true});
child.once('error',e=>{console.error(`Expo CLI could not start: ${e.code||e.name} ${e.message}`);process.exitCode=1});
child.once('exit',(code,signal)=>{if(signal)console.error(`Expo CLI exited by ${signal}`);process.exitCode=code??1});
