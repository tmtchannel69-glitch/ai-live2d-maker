import {zip,strToU8,strFromU8} from 'fflate';
import {readBoundedZip} from '../../shared/bounded-zip.js';
import {GENERATED_ROLES} from '../../shared/generated-character.js';
import {MAKER_FORMAT,MAKER_RIG_PROFILE,makerDigest,matchMakerFiles,validateMakerOrigin,validateMakerPose,validateMakerHistory} from '../../shared/modular-character.js';
import {createMakerProject,validateMakerManifest,makerAssemblyManifest,auditMakerAssets} from './project.js';
import {assembleValidatedCharacter,checkAbort} from '../character-generation/generator.js';
import {buildModularRig} from '../../shared/modular-character-rig.js';

const MIB=1024*1024;
const need=(v,m)=>{if(!v)throw new Error(m);};
const sidecars=new Set(['preview.png','README.txt','INOCHI2D.txt','character.inp','character.inx','character_manifest.json','rig_metadata.json','inochi_intermediate.json','generation_recipe.json','character_design.json','design_blueprint.json','ai_generation_request.json','design_quality.json','inochi_model.json','inochi_rig.json','inochi_report.json','experimental_batch_report.json']);
const read=async(file,signal)=>readBoundedZip(file,{signal,maxBytes:48*MIB,maxCompressedBytes:48*MIB,maxFiles:128,allowDirectories:true,label:'制作ZIP',limitMessage:'制作ZIPは48 MiB以下にしてください。'});
const json=(entries,name)=>{const b=entries.get(name);need(b&&b.length<=768*1024,name+'が不足しているか大きすぎます。');try{return JSON.parse(strFromU8(b));}catch{throw new Error(name+'が正しくありません。');}};

export async function readMakerPartZip(file,parts,{signal}={}){
  need(file.size<=16*MIB,'部品用ZIPは16 MiB以下にしてください。作業ZIPは「制作を再開」から開いてください。');
  const entries=await read(file,signal);checkAbort(signal);
  need(!entries.has('maker_project.json'),'これは制作を再開するZIPです。「制作を再開」から開いてください。');
  const files=[];
  for(const [name,data] of entries){
    if(name==='parts/'&&data.length===0||sidecars.has(name))continue;
    const match=/^(?:parts\/)?([-a-zA-Z0-9_]+\.png)$/i.exec(name);
    need(match,'部品ZIPに対応していないファイルがあります: '+name);
    files.push(new File([data],match[1],{type:'image/png'}));
  }
  const matched=matchMakerFiles(files);need(parts.length===33,'33パーツの基準が必要です。');
  return matched.map(p=>p.file);
}

export async function createMakerArchive(project){
  const m=await validateMakerManifest(project.current.manifest);
  need(project.current.quality?.structural_checks_passed===true,'構造検査が完了していない状態はモデルとして保存できません。');
  validateMakerPose(project.pose);
  validateMakerHistory(project.history,project.revision);
  const files={},index=[],baseIndex=[];let total=0;
  const put=(name,b)=>{total+=b.length;need(total<=48*MIB,'制作ZIPが48 MiBを超えています。');files[name]=[b,{mtime:new Date('2000-01-01T00:00:00Z')}];};
  const putJSON=(name,v)=>put(name,strToU8(JSON.stringify(v,null,2)+'\n'));
  for(const p of m.parts){
    const b=new Uint8Array(await project.current.assets.get(p.role).arrayBuffer()),origin=validateMakerOrigin(project.origins[p.role]);
    need(await makerDigest(b)===origin.sha256,'パーツと由来の指紋が一致しません: '+p.role);
    put(p.file,b);index.push({role:p.role,file:p.file,sha256:origin.sha256,origin});
    const base=new Uint8Array(await project.base.assets.get(p.role).arrayBuffer()),baseOrigin=validateMakerOrigin(project.base.origins[p.role]);
    need(await makerDigest(base)===baseOrigin.sha256,'元に戻す基準PNGの指紋が一致しません。');
    const path='base/'+p.file;put(path,base);baseIndex.push({role:p.role,file:path,sha256:baseOrigin.sha256,origin:baseOrigin});
  }
  const native=project.current.native;
  need(native.report.profile===MAKER_RIG_PROFILE,'共通動作の版が一致しません。');
  put('preview.png',new Uint8Array(await project.current.preview.arrayBuffer()));put('character.inp',native.inp);put('character.inx',native.inx);
  putJSON('character_manifest.json',m);putJSON('assembly_manifest.json',makerAssemblyManifest(project));
  putJSON('rig_metadata.json',native.rig);putJSON('inochi_model.json',native.model);putJSON('inochi_report.json',native.report);putJSON('assembly_quality.json',project.current.quality);
  putJSON('maker_project.json',{format:MAKER_FORMAT,version:1,baseline_manifest:m,parts:index,base_parts:baseIndex,pose:project.pose,
    rig_profile:MAKER_RIG_PROFILE,revision:project.revision,history:project.history,
    native_sha256:await makerDigest(native.inp),ai_origin_verified:false,appearance_quality_passed:false});
  put('README.txt',strToU8('AI Live2D Maker 交換式33パーツ制作プロジェクト\n\nアプリの「制作を再開」でこのZIPを開けます。33枚の現在PNGと、元に戻す基準PNGを保存しています。\ncharacter_manifest.jsonは基準設計です。実際の現在素材と由来はassembly_manifest.json/maker_project.jsonを参照してください。\n外部PNGのAI出典、画風一致、自然さは未確認です。構造検査・モデル生成・公式動作・完成品質は別判定です。\ncharacter.inp/inxはInochi2D legacy0.8.6用。Cubism/MOC3/VTube Studio互換ではありません。\nBreathは小さな胴体変形の共通パラメータです。アプリの待機再生は独立描画で、公式SDKの自動再生ではありません。\n基準のdesign/recipeと入力PNGを保持して再生成できます。画像/モデルをGitHubへ無断で追加しないでください。\n'));
  return new Promise((resolve,reject)=>zip(files,{level:0},(error,bytes)=>error?reject(error):resolve(new Blob([bytes],{type:'application/zip'}))));
}

export async function readMakerArchive(file,{signal}={}){
  const entries=await read(file,signal);checkAbort(signal);
  if(!entries.has('maker_project.json')){
    // Existing v1/v2 character ZIPs retain their original PNGs. Imported archive
    // origins are unverified; an old manifest is never proof of AI provenance.
    const manifest=await validateMakerManifest(json(entries,'character_manifest.json')),assets=new Map();
    for(const [name] of entries)need(sidecars.has(name)||name==='parts/'||manifest.parts.some(p=>p.file===name),'既存キャラクターZIPに未対応の項目があります: '+name);
    for(const p of manifest.parts){need(entries.has(p.file),'パーツが不足しています: '+p.role);assets.set(p.role,new Blob([entries.get(p.file)],{type:'image/png'}));}
    return createMakerProject({manifest,assets},{signal,imported:true});
  }
  const meta=json(entries,'maker_project.json');
  need(meta.format===MAKER_FORMAT&&meta.version===1&&meta.rig_profile===MAKER_RIG_PROFILE&&meta.ai_origin_verified===false&&meta.appearance_quality_passed===false,'この制作プロジェクトの版/由来には対応していません。');
  const manifest=await validateMakerManifest(meta.baseline_manifest),assets=new Map(),baseAssets=new Map(),origins={},baseOrigins={};
  need(Array.isArray(meta.parts)&&meta.parts.length===33&&Array.isArray(meta.base_parts)&&meta.base_parts.length===33,'33パーツの現在/基準情報が不足しています。');
  const allowed=new Set(['maker_project.json','preview.png','character.inp','character.inx','character_manifest.json','assembly_manifest.json','rig_metadata.json','inochi_model.json','inochi_report.json','assembly_quality.json','README.txt']);
  for(const [list,dest,sources,prefix] of [[meta.parts,assets,origins,''],[meta.base_parts,baseAssets,baseOrigins,'base/']]){
    const roles=new Set();
    for(const item of list){
      need(item&&GENERATED_ROLES.includes(item.role)&&!roles.has(item.role)&&item.file===prefix+`parts/${item.role}.png`,'役割/保存先が重複または不正です。');roles.add(item.role);allowed.add(item.file);
      const origin=validateMakerOrigin(item.origin),bytes=entries.get(item.file);need(bytes&&bytes.length<=4*MIB,'PNGが不足しているか大きすぎます。');
      need(await makerDigest(bytes)===item.sha256&&origin.sha256===item.sha256,'PNGの指紋が一致しません: '+item.role);checkAbort(signal);
      dest.set(item.role,new Blob([bytes],{type:'image/png'}));sources[item.role]=origin;
    }
  }
  for(const name of entries.keys())need(allowed.has(name)||['parts/','base/','base/parts/'].includes(name)&&entries.get(name).length===0,'制作ZIPに未対応の項目があります: '+name);
  const history=validateMakerHistory(meta.history,meta.revision);
  const pose=validateMakerPose(meta.pose);
  await auditMakerAssets(manifest,baseAssets,{signal});const quality=await auditMakerAssets(manifest,assets,{signal});
  if(entries.has('character.inp'))need(await makerDigest(entries.get('character.inp'))===meta.native_sha256,'保存モデルの指紋が一致しません。');
  if(entries.has('character.inx'))need(await makerDigest(entries.get('character.inx'))===meta.native_sha256,'保存INXの指紋が一致しません。');
  const preview=await assembleValidatedCharacter(manifest,assets,{signal}),native=await buildModularRig(manifest,assets,{signal});checkAbort(signal);
  return {format:'ai-live2d-modular-session',base:{manifest,assets:baseAssets,origins:baseOrigins},current:{manifest,assets,preview,native,quality},origins,pose,revision:meta.revision,history,undo:[]};
}
