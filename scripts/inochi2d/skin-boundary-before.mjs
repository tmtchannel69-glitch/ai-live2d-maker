// Reuse the existing head loader/writer with only the old inferred skin PNG.
// Does not create artwork, adjust any mesh, or mutate the final common assets.
import {readFile,lstat} from 'node:fs/promises';
import {decode} from 'fast-png';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateHeadModel,buildHeadModel} from './head-rig.mjs';

export async function generateSkinBoundaryBefore(manifest,beforePath,output){
  const stat=await lstat(beforePath);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<33||stat.size>8*1024*1024)throw Error('Invalid original inferred skin PNG.');
  const bytes=await readFile(beforePath),width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(width<1||height<1||width>4096||height>4096||width*height>4_000_000)throw Error('Original inferred skin exceeds budget.');
  const before=decode(bytes);
  if(before.depth!==8||before.channels!==4)throw Error('Original inferred skin must be RGBA8.');
  return generateHeadModel(manifest,output,{builder:(graph,images)=>{
    const part=graph.parts.find(p=>p.id==='eye_skin_underpaint');
    if(!part?.completion.rgba||graph.source.width!==width||graph.source.height!==height)throw Error('Skin comparison source dimensions differ.');
    const current=images[part.completion.rgba];
    for(let i=3;i<before.data.length;i+=4)if(before.data[i]!==current.data[i])throw Error('Skin comparison alpha differs.');
    return buildHeadModel(graph,{...images,[part.completion.rgba]:before});
  }});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{
  if(process.argv.length!==5)throw Error('Usage: skin-boundary-before.mjs COMMON_PARTS BEFORE_SKIN_PNG NEW_OUTPUT_BASE');
  console.log(JSON.stringify(await generateSkinBoundaryBefore(...process.argv.slice(2))));
}catch(error){console.error(error.message);process.exitCode=1;}
