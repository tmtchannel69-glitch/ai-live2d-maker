import {zip,strToU8} from 'fflate';
import {canonicalBangsManifest} from '../../shared/bangs-placement.js';
import {DEFAULT_POSE,makerDigest} from '../../shared/modular-character.js';
import {buildModularRig} from '../../shared/modular-character-rig.js';
import {assembleValidatedCharacter,checkAbort,pngBlob} from '../character-generation/generator.js';
import {createMakerPreview} from './preview.js';
import {bangsRegenerationRequest} from './bangs-prompt.js';
const MIB=1024*1024;
export const BANGS_REVIEW_POSES=[['neutral',{}],['left_blink',{EyeOpenL:0}],['right_blink',{EyeOpenR:0}],['both_blink',{EyeOpenL:0,EyeOpenR:0}],['mouth_open',{MouthOpen:1}],['head_left',{HeadX:-1}],['head_right',{HeadX:1}],['head_up',{HeadY:-1}],['head_down',{HeadY:1}],['tilt_left',{HeadTilt:-1}],['tilt_right',{HeadTilt:1}],['breath',{Breath:1}]];
const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
export async function createBangsReviewArchive(project,{signal,onProgress=()=>{}}={}){
  const origin=project.origins.bangs_front,prep=origin?.import_preparation;
  if(!prep||origin.sha256!==prep.prepared_sha256||await makerDigest(await project.current.assets.get('bangs_front').arrayBuffer())!==origin.sha256)throw new Error('自動配置した前髪の検証情報がありません。前髪PNGを選んで自動装着してください。');
  const base=canonicalBangsManifest(project.current.manifest),assets=new Map(project.current.assets);assets.set('bangs_front',project.base.assets.get('bangs_front'));
  const before=await assembleValidatedCharacter(base,assets,{signal}),beforeNative=await buildModularRig(base,assets,{signal});checkAbort(signal);
  const files={},canvases=[],renderers=[];let total=0;
  const put=(name,bytes)=>{total+=bytes.length;if(total>16*MIB)throw new Error('比較ZIPは16 MiBまでです。');files[name]=[bytes,{mtime:new Date('2000-01-01T00:00:00Z')}];};
  const blob=async(name,b)=>put(name,new Uint8Array(await b.arrayBuffer()));
  const make=(w,h)=>{const c=canvas(w,h);canvases.push(c);return c;};
  try{
    await blob('before.png',before);await blob('after.png',project.current.preview);await blob('fitted_bangs.png',project.current.assets.get('bangs_front'));
    const source=project.bangsImport;let originalIncluded=false;
    if(source?.original&&await makerDigest(await source.original.arrayBuffer())===prep.source_sha256){await blob('source_original.png',source.original);await blob('source_alpha_cleaned.png',source.cleaned);originalIncluded=true;}
    const a=await createMakerPreview(beforeNative,{signal});renderers.push(a);const b=await createMakerPreview(project.current.native,{signal});renderers.push(b);
    const left=make(320,426),right=make(320,426),pair=make(640,458),sheet=make(640,458*BANGS_REVIEW_POSES.length);
    for(const [i,[name,overrides]] of BANGS_REVIEW_POSES.entries()){
      checkAbort(signal);onProgress(`比較画像を作成中 ${i+1}/${BANGS_REVIEW_POSES.length}: ${name}`);const pose={...DEFAULT_POSE,...overrides};a.render(left,pose);b.render(right,pose);
      const ctx=pair.getContext('2d');ctx.fillStyle='#f1edf6';ctx.fillRect(0,0,pair.width,pair.height);ctx.fillStyle='#302a42';ctx.font='16px sans-serif';ctx.fillText('Before / '+name,10,23);ctx.fillText('After / '+name,330,23);ctx.drawImage(left,0,32);ctx.drawImage(right,320,32);sheet.getContext('2d').drawImage(pair,0,i*458);
      const png=await pngBlob(pair);await blob('motion/'+name+'.png',png);if(name==='neutral')await blob('side_by_side.png',png);await new Promise(resolve=>setTimeout(resolve,0));
    }
    await blob('motion_comparison.png',await pngBlob(sheet));
    put('import_report.json',strToU8(JSON.stringify({format:'ai-live2d-bangs-review',version:1,source_sha256:prep.source_sha256,model_sha256:await makerDigest(project.current.native.inp),
      renderer:'independent Canvas reading serialized Inochi model bindings; not official SDK',poses:BANGS_REVIEW_POSES,original_source_included:originalIncluded,
      before_description:'Current other parts retained; only bangs reset to saved baseline. Not a full history snapshot.',preparation:prep,
      appearance_quality_passed:false,official_creator_tested_by_this_export:false},null,2)+'\n'));
    put('README.txt',strToU8('AI Live2D Maker 前髪取り込み比較\n\nZIPを端末に保存し、iPhoneのファイルアプリでタップして展開するとPNGを確認できます。\nside_by_side.pngは前髪交換の比較。motion/内は1状態ずつ、motion_comparison.pngは12状態の一覧です。元と同じ他のパーツを保ち、前髪だけを基準へ戻したものと比較しています。\n独立Canvas描画で、公式Creatorの画面ではありません。ファイル生成と完成品質は別判定です。画風・陰影・後ろ髪の形状との不一致は残ります。\n'+(originalIncluded?'source_original.pngは元の前髪を全バイト保持。source_alpha_cleaned.pngは低alpha背景だけの処理、fitted_bangs.pngは縦横比を保った配置用PNGです。\n':'元の入力PNGはこの再開セッションにはないため含めません。fitted_bangs.pngと再現情報は保持しています。\n')+'制作の再開やモデルが必要な場合は、アプリの「制作ZIPを保存」も別に保存してください。画像/モデルをGitHubや第三者へ自動送信しません。Inochi2DとCubism/VTube Studioは異なる形式です。\n'));
    put('regeneration_request.txt',strToU8(bangsRegenerationRequest(project)));
    checkAbort(signal);return await new Promise((resolve,reject)=>zip(files,{level:0},(e,bytes)=>e?reject(e):resolve(new Blob([bytes],{type:'application/zip'}))));
  }finally{renderers.forEach(r=>r.close());canvases.forEach(c=>{c.width=c.height=0;});}
}
