// Reuse the browser generator; save private outputs without adding images to Git.
import {parseArgs} from 'node:util';
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
import {unzipSync,strFromU8} from 'fflate';
import {decode} from 'fast-png';
import {validateRecipe,validateCharacterManifest} from '../../shared/generated-character.js';

const {values}=parseArgs({options:{output:{type:'string'},recipe:{type:'string'},'static-only':{type:'boolean',default:false},url:{type:'string',default:'http://127.0.0.1:5173'}}});
if(!values.output)throw new Error('Usage: node scripts/character-generation/export.mjs --output NEW_PRIVATE_DIRECTORY [--recipe generation_recipe.json] [--url http://127.0.0.1:5173]');
const root=await realpath(fileURLToPath(new URL('../../',import.meta.url))),parent=await realpath(dirname(resolve(values.output))),output=join(parent,resolve(values.output).split(sep).at(-1));
const canonical=s=>process.platform==='win32'?s.toLowerCase():s;
if(canonical(output)===canonical(root)||canonical(output).startsWith(canonical(root)+sep))throw new Error('画像の保存先はGitリポジトリ外にしてください。');
try{await lstat(output);throw new Error('出力先が存在します。新しいフォルダを指定してください。');}catch(e){if(e.code!=='ENOENT')throw e;}
const url=new URL(values.url);
if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)throw new Error('生成先はローカルの開発サーバーを指定してください。');
let recipe={};if(values.recipe){const stat=await lstat(values.recipe);if(!stat.isFile()||stat.size>8192)throw new Error('再生成設定は8KiB以下の通常ファイルを指定してください。');const bytes=await readFile(values.recipe);if(bytes.length>8192)throw new Error('再生成設定のサイズが上限を超えています。');recipe=JSON.parse(bytes.toString('utf8'));}
recipe=validateRecipe(recipe);
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
let bytes;
try{
  const page=await browser.newPage();await page.route('**/*',route=>new URL(route.request().url()).origin===url.origin?route.continue():route.abort());
  await page.goto(url.href);const base64=await page.evaluate(async({recipe:r,staticOnly})=>{
    const {generateCharacter}=await import('/src/character-generation/generator.js'),{createCharacterArchive}=await import('/src/character-generation/archive.js');
    const {generateRiggedCharacter}=await import('/src/character-generation/model-generator.js');
    const output=await createCharacterArchive(await (staticOnly?generateCharacter(r):generateRiggedCharacter(r)));
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('ZIPの読出しに失敗しました。'));reader.readAsDataURL(output);});
  },{recipe,staticOnly:values['static-only']});
  if(typeof base64!=='string'||base64.length>24*1024*1024)throw new Error('ZIPの応答サイズが正しくありません。');bytes=Buffer.from(base64,'base64');
}finally{await browser.close();}
const files=unzipSync(bytes),manifest=validateCharacterManifest(JSON.parse(strFromU8(files['character_manifest.json'])));
const allowed=new Set(['preview.png','character_manifest.json','rig_metadata.json','inochi_intermediate.json','generation_recipe.json','README.txt',...manifest.parts.map(p=>p.file)]);
if(!values['static-only']&&recipe.provider==='template')for(const n of ['character.inp','character.inx','inochi_model.json','inochi_rig.json','inochi_report.json','INOCHI2D.txt'])allowed.add(n);
if(Object.keys(files).length!==allowed.size||Object.keys(files).some(n=>!allowed.has(n)))throw new Error('ZIPのファイル構成が一致しません。');
for(const p of manifest.parts){const im=decode(files[p.file]);if(im.width!==p.rect.width||im.height!==p.rect.height||im.channels!==4||im.depth!==8||!im.data.some((v,i)=>i%4===3&&v>0))throw new Error('空または不正なパーツPNG: '+p.role);}
await mkdir(output,{mode:0o700});await mkdir(join(output,'parts'),{mode:0o700});
for(const [name,data] of Object.entries(files))await writeFile(join(output,name),data,{flag:'wx',mode:0o600});
await writeFile(join(output,'ai-live2d-generated-character.zip'),bytes,{flag:'wx',mode:0o600});
let commit=null,dirty=null;try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();dirty=Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}));}catch{}
const fingerprint=createHash('sha256');for(const name of ['shared/generated-character.js','shared/generated-character-inochi.js','src/character-generation/template.js','src/character-generation/generator.js','src/character-generation/model-generator.js','src/character-generation/archive.js']){fingerprint.update(name);fingerprint.update('\0');fingerprint.update(await readFile(join(root,name)));fingerprint.update('\0');}
const report={format:'ai-live2d-generated-character-export',version:1,code_commit:commit,uncommitted_source_changes:dirty,source_code_sha256:fingerprint.digest('hex'),recipe,parts:manifest.parts.length,
  archive_bytes:bytes.length,archive_sha256:createHash('sha256').update(bytes).digest('hex'),browser:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'Playwright Chromium',
  file_generation_passed:true,ai_generated:false,native_model_generated:Boolean(files['character.inp']),official_creator_tested:false,appearance_quality_passed:false};
await writeFile(join(output,'generation_report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({output,...report}));
