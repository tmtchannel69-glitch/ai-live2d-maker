import {generateCharacter, checkAbort} from './generator.js';
import {buildGeneratedInochi} from '../../shared/generated-character-inochi.js';

// Keep the original static generator API and the 33 original PNGs intact.
export async function generateRiggedCharacter(recipe={},options={}){
  const {signal,onProgress=()=>{}}=options;
  const character=await generateCharacter(recipe,{...options,onProgress:p=>onProgress({...p,stage:'parts',total:66})});
  if(character.manifest.generator.id==='dummy')return character;
  const bytes=new Map();
  for(const [role,blob] of character.assets){checkAbort(signal);bytes.set(role,new Uint8Array(await blob.arrayBuffer()));}
  const native=await buildGeneratedInochi(character.manifest,bytes,{signal,onProgress:p=>onProgress({...p,completed:33+p.completed,total:66,stage:'model'})});
  checkAbort(signal);return {...character,native};
}
