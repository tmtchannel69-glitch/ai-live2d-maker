import {readFile,lstat,realpath,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
export const ROOT=await realpath(fileURLToPath(new URL('../../',import.meta.url)));
export async function readJsonFile(path,limit=256*1024){
  const stat=await lstat(path);if(!stat.isFile()||stat.size>limit)throw new Error('Use a bounded regular JSON file, not a symlink.');
  const bytes=await readFile(path);if(bytes.length>limit)throw new Error('JSON exceeds the size limit.');return JSON.parse(bytes.toString('utf8'));
}
export async function newPrivateDirectory(path){
  const parent=await realpath(dirname(resolve(path))),output=join(parent,resolve(path).split(sep).at(-1));
  const key=s=>process.platform==='win32'?s.toLowerCase():s;
  if(key(output)===key(ROOT)||key(output).startsWith(key(ROOT)+sep))throw new Error('Keep guides and generated images outside the Git repository.');
  await mkdir(output,{mode:0o700});return output; // existing outputs fail, never overwrite
}
export const writePrivate=(path,value)=>writeFile(path,value,{flag:'wx',mode:0o600});
export const json=value=>JSON.stringify(value,null,2)+'\n';
