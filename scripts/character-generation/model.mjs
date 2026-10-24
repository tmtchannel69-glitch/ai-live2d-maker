// Rebuild only the model from an existing private 33-PNG manifest directory.
// No browser, source portrait, AI model, network service or manual rig needed.
import {parseArgs} from 'node:util';
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateCharacterManifest} from '../../shared/generated-character.js';
import {buildGeneratedInochi} from '../../shared/generated-character-inochi.js';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const hash=b=>createHash('sha256').update(b).digest('hex');
async function ordinary(path,limit){const s=await lstat(path);need(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=limit,'通常ファイルのサイズ上限を超えています: '+path);const b=await readFile(path);need(b.length<=limit,'ファイルの読込上限を超えています。');return b;}

export async function generateModelDirectory(input,requestedOutput){
  const folder=await realpath(resolve(input)),parent=await realpath(dirname(resolve(requestedOutput)));
  const output=join(parent,resolve(requestedOutput).split(sep).at(-1)),root=await realpath(ROOT);
  const canonical=s=>process.platform==='win32'?s.toLowerCase():s;
  need(canonical(output)!==canonical(root)&&!canonical(output).startsWith(canonical(root)+sep),'モデルの保存先はGitリポジトリ外にしてください。');
  try{await lstat(output);throw new Error('出力先が存在します。新規フォルダを指定してください。');}catch(e){if(e.code!=='ENOENT')throw e;}
  const manifest=validateCharacterManifest(JSON.parse((await ordinary(join(folder,'character_manifest.json'),256*1024)).toString('utf8')));
  const partDir=await lstat(join(folder,'parts'));need(partDir.isDirectory()&&!partDir.isSymbolicLink(),'通常のpartsディレクトリが必要です。');
  let bytes=0;const assets=new Map();for(const p of manifest.parts){const b=await ordinary(join(folder,p.file),4*1024*1024);bytes+=b.length;need(bytes<=12*1024*1024,'合計PNGサイズが上限を超えています。');assets.set(p.role,new Uint8Array(b));}
  const built=await buildGeneratedInochi(manifest,assets),report={...built.report,source_png_sha256:Object.fromEntries([...assets].map(([role,b])=>[role,hash(b)])),model_sha256:hash(built.inp)};
  await mkdir(output,{mode:0o700});
  for(const [name,b] of [['character.inp',built.inp],['character.inx',built.inx],['inochi_model.json',JSON.stringify(built.model,null,2)+'\n'],['inochi_rig.json',JSON.stringify(built.rig,null,2)+'\n'],['inochi_report.json',JSON.stringify(report,null,2)+'\n']])await writeFile(join(output,name),b,{flag:'wx',mode:0o600});
  return {output,model_sha256:report.model_sha256,parts:33,parameters:report.parameters,file_generation_passed:true,official_creator_tested:false,appearance_quality_passed:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{
  const {values}=parseArgs({options:{input:{type:'string'},output:{type:'string'}}});
  need(values.input&&values.output,'Usage: node scripts/character-generation/model.mjs --input PRIVATE_33_PART_DIRECTORY --output NEW_PRIVATE_DIRECTORY');
  console.log(JSON.stringify(await generateModelDirectory(values.input,values.output)));
}catch(e){console.error(e.message);process.exitCode=1;}
