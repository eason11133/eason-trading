import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export function resolveMobileTooling(root){
  const mobile=path.join(root,'mobile');
  const mobileRequire=createRequire(path.join(mobile,'package.json'));
  function resolve(spec,label){
    try{return mobileRequire.resolve(spec)}
    catch(e){
      const detail=e?.code||e?.message||String(e);
      throw new Error(`${label} is missing after npm install. Resolution from mobile/package.json failed (${detail}). npm workspaces may place dependencies in either root/node_modules or mobile/node_modules.`);
    }
  }
  const expoPackage=resolve('expo/package.json','Expo dependencies');
  function resolveBin(packageName,binName=packageName,label=packageName){
    const packageFile=resolve(`${packageName}/package.json`,`${label} package`);
    const meta=JSON.parse(fs.readFileSync(packageFile,'utf8'));
    const binRel=typeof meta.bin==='string'?meta.bin:(meta.bin?.[binName]||meta.bin?.[packageName]);
    if(!binRel)throw new Error(`${label} package does not declare CLI bin ${binName}.`);
    const cli=path.resolve(path.dirname(packageFile),binRel);
    if(!fs.existsSync(cli))throw new Error(`${label} CLI entry does not exist: ${cli}`);
    return cli;
  }
  return {
    expoPackage,
    expoCli: resolveBin('expo','expo','Expo'),
    expoDoctorCli: resolveBin('expo-doctor','expo-doctor','Expo Doctor'),
    tsc: resolve('typescript/bin/tsc','TypeScript compiler'),
    resolvePackage(spec,label=spec){return resolve(`${spec}/package.json`,label)}
  };
}
