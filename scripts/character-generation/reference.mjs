// Private audit fixture: display the original assembled preview through the
// SAME official runtime/filtering as the articulated model. Not a product rig.
import {readFile,writeFile,realpath,lstat} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {decode,encode} from 'fast-png';
import {readCharacterContainer} from '../inochi2d/character-model.mjs';
import {packRigContainer} from '../inochi2d/head-rig.mjs';
import {validateCharacterManifest} from '../../shared/generated-character.js';

const {values}=parseArgs({options:{input:{type:'string'},output:{type:'string'}}});
if(!values.input||!values.output)throw new Error('Usage: reference.mjs --input PRIVATE_GENERATED_DIRECTORY --output NEW_PRIVATE_REFERENCE.inx');
const root=await realpath(fileURLToPath(new URL('../../',import.meta.url))),parent=await realpath(dirname(resolve(values.output)));
const output=resolve(parent,resolve(values.output).split(sep).at(-1));
if(output===root||output.startsWith(root+sep))throw new Error('Reference model must be outside Git.');
try{await lstat(output);throw new Error('Output exists.');}catch(e){if(e.code!=='ENOENT')throw e;}
const folder=resolve(values.input),manifest=validateCharacterManifest(JSON.parse(await readFile(resolve(folder,'character_manifest.json'),'utf8')));
if(manifest.background!=='transparent')throw new Error('Use the transparent recipe for the reference runtime comparison.');
const bytes=await readFile(resolve(folder,'character.inp'));
const {model,textures}=readCharacterContainer(new Uint8Array(bytes));
const pngPath=resolve(folder,'preview.png'),stat=await lstat(pngPath);if(!stat.isFile()||stat.size>8*1024*1024)throw new Error('Invalid preview.');
const im=decode(await readFile(pngPath));if(im.width!==768||im.height!==1024||im.channels!==4||im.depth!==8)throw new Error('Invalid preview dimensions.');
const pixels=new Uint8Array(im.data);for(let i=0;i<pixels.length;i+=4)for(let c=0;c<3;c++)pixels[i+c]=Math.floor(pixels[i+c]*pixels[i+3]/255);
const hide=n=>{if(n.type==='Part')n.opacity=0;for(const c of n.children)hide(c);};hide(model.nodes);
const x0=Math.min(...manifest.parts.map(p=>p.rect.x)),y0=Math.min(...manifest.parts.map(p=>p.rect.y));
const x1=Math.max(...manifest.parts.map(p=>p.rect.x+p.rect.width)),y1=Math.max(...manifest.parts.map(p=>p.rect.y+p.rect.height));
const mesh={verts:[],uvs:[],indices:[],origin:[0,0]};
for(let j=0;j<3;j++)for(let i=0;i<3;i++){
  const x=x0+(x1-x0)*i/2,y=y0+(y1-y0)*j/2;mesh.verts.push(x-384,y-512);mesh.uvs.push(x/768,y/1024);
}
for(let j=0;j<2;j++)for(let i=0;i<2;i++){const a=j*3+i;mesh.indices.push(a,a+1,a+3,a+1,a+4,a+3);}
model.nodes.children.push({uuid:50000,name:'REFERENCE original assembled preview',type:'Part',enabled:true,zsort:-10000,transform:{trans:[0,0,0],rot:[0,0,0],scale:[1,1]},lockToRoot:false,children:[],mesh,
  textures:[textures.length,4294967295,4294967295],opacity:1,mask_threshold:.001,tint:[1,1,1],screenTint:[0,0,0],blend_mode:'Normal',masks:[]});
textures.push(encode({width:768,height:1024,data:pixels,channels:4,depth:8}));
model.meta.name='AUDIT ONLY: original assembled preview';await writeFile(output,packRigContainer(model,textures),{flag:'wx',mode:0o600});
console.log(JSON.stringify({output,reference_only:true,original_model_unchanged:true}));
