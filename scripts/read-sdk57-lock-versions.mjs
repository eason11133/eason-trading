import fs from 'node:fs';
import path from 'node:path';

const file=process.argv[2];
if(!file){console.error('Usage: read-sdk57-lock-versions.mjs <package-lock.json>');process.exit(2)}
const lock=JSON.parse(fs.readFileSync(path.resolve(file),'utf8').replace(/^\uFEFF/,''));
const v=name=>lock.packages?.[`node_modules/${name}`]?.version||null;
console.log(JSON.stringify({
  expo:v('expo'),
  react:v('react'),
  reactNative:v('react-native'),
  typescript:v('typescript'),
  expoDoctor:v('expo-doctor'),
  localBuildCacheProvider:v('@expo/local-build-cache-provider')
}));
