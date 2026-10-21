#!/usr/bin/env node
import {readFile,lstat,realpath,writeFile,unlink} from 'node:fs/promises';
import {dirname,basename,join,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildInochiModel,ROLES} from './model.mjs';
const require=(ok,message)=>{if(!ok)throw new Error(message);};
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
async function readBounded(path,max){const stat=await lstat(path);require(stat.isFile() && !stat.isSymbolicLink() && stat.size>0 && stat.size<=max,'入力ファイルの種類かサイズが正しくありません。');const b=new Uint8Array(await readFile(path));require(b.length<=max,'入力ファイルが大きすぎます。');return b;}
export async function generateTrial(manifestPath,outputBase){
  manifestPath=resolve(manifestPath);const input=JSON.parse(new TextDecoder().decode(await readBounded(manifestPath,256*1024))),parent=await realpath(dirname(outputBase)),base=join(parent,basename(outputBase)),rel=relative(repo,base);
  require(isAbsolute(rel) || rel==='..' || rel.startsWith('..'+sep),'モデルを含む出力はGitの外へ保存してください。');
  require(Array.isArray(input.parts) && input.parts.length===ROLES.length,'5役割の素材manifestが必要です。');
  const root=await realpath(dirname(manifestPath));const partDir=join(root,'parts');require(!(await lstat(partDir)).isSymbolicLink(),'素材のリンクは使用できません。');
  const parts=[];
  for(const p of input.parts){require(ROLES.includes(p.role) && p.path===`parts/${p.role}.png`,'素材のパスが正しくありません。');parts.push({...p,png:await readBounded(join(root,p.path),8*1024*1024)});}
  const result=buildInochiModel({...input,parts}),sha=b=>createHash('sha256').update(b).digest('hex');
  const report={...result.report,inpSha256:sha(result.inp),assetLicense:input.assetLicense||'not specified; source artwork rights remain separate',sourcePngSha256:Object.fromEntries(parts.map(p=>[p.role,sha(p.png)]))};
  const outputs=[[base+'.inp',result.inp],[base+'.inx',result.inx],[base+'.json',JSON.stringify(result.model,null,2)],[base+'-report.json',JSON.stringify(report,null,2)]],created=[];
  try{for(const [path,data] of outputs){await writeFile(path,data,{flag:'wx',mode:0o600});created.push(path);}}catch(e){for(const path of created)await unlink(path);throw e;}
  return {outputs:outputs.map(([path])=>path),report};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))try{const args=process.argv.slice(2);require(args.length===2,'使い方: generate.mjs MANIFEST.json NEW_OUTPUT_BASE');console.log(JSON.stringify(await generateTrial(...args)));}catch(e){console.error(e.message);process.exitCode=1;}
