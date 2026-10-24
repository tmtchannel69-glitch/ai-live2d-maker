// Reproducible PRIVATE matrix. This generates no AI images and contacts no
// provider. Optional Python diagnostics read actual serialized models.
import {parseArgs} from 'node:util';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {normalizeDesign} from '../../shared/character-design.js';

const run=promisify(execFile),root=await realpath(fileURLToPath(new URL('../../',import.meta.url)));
const {values}=parseArgs({options:{output:{type:'string'},python:{type:'string'},url:{type:'string',default:'http://127.0.0.1:5173'}}});
if(!values.output)throw new Error('Usage: design-trial.mjs --output NEW_PRIVATE_DIRECTORY [--python /path/to/python]');
const parent=await realpath(dirname(resolve(values.output))),output=join(parent,resolve(values.output).split(sep).at(-1)),key=s=>process.platform==='win32'?s.toLowerCase():s;
if(key(output)===key(root)||key(output).startsWith(key(root)+sep))throw new Error('Output must be outside Git.');
try{await lstat(output);throw new Error('Output exists. Use a new directory.');}catch(e){if(e.code!=='ENOENT')throw e;}
const recipes=JSON.parse(await readFile(new URL('./design-examples.json',import.meta.url),'utf8')),reports=[];
await mkdir(output,{mode:0o700});
for(const [name,input] of Object.entries(recipes)){
  const design=normalizeDesign(input),recipe=join(output,name+'.json');await writeFile(recipe,JSON.stringify(design,null,2)+'\n',{flag:'wx',mode:0o600});
  const started=performance.now();const result=await run(process.execPath,[join(root,'scripts/character-generation/export.mjs'),'--design',recipe,'--output',join(output,name),'--url',values.url],{cwd:root,maxBuffer:1024*1024});
  const generation=JSON.parse(result.stdout.trim()),model=await readFile(join(output,name,'character.inp'));
  let quality=null;
  if(values.python){const result=await run(values.python,[join(root,'scripts/character-generation/render-inochi.py'),'--input',join(output,name),'--output',join(output,name+'-quality')],{cwd:root,maxBuffer:1024*1024});quality=JSON.parse(result.stdout.trim());}
  reports.push({name,design,model_sha256:createHash('sha256').update(model).digest('hex'),archive_sha256:generation.archive_sha256,elapsed_seconds:(performance.now()-started)/1000,
    file_generation_passed:generation.file_generation_passed,ai_generated:false,official_creator_tested:false,appearance_quality_passed:false,
    cpu_geometry_passed:quality?.geometry_checks_passed??null,cpu_neutral_comparison:quality?.neutral_comparison??null});
}
const report={format:'ai-live2d-local-design-trial',version:1,provider:'local-design-v1',ai_generation_executed:false,external_provider_calls:0,variants:reports,
  note:'Local parametric SVG designs validate the pipeline only, not genuine AI visual consistency. Official Creator results require separate evidence.'};
await writeFile(join(output,'trial-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({output,...report}));
