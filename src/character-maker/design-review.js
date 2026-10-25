import {zip,strToU8} from 'fflate';
import {DESIGN_HAIR_ROLES} from '../../shared/design-reference.js';
import {validateDesignReference,createReferenceContract,auditReferenceDesign} from './design-workflow.js';
import {checkAbort,pngBlob} from '../character-generation/generator.js';

export function referencePartInstructions(contract){
  const m=contract.reference,p=m.policy;
  return `共通デザイン原画から髪を揃える制作依頼（アプリはAI送信・生成をしていません）

【すべての生成に同じ資料を添付】
${m.source.file}：${m.label}。SHA256 ${m.source.sha256}
placement_guide.png：既存33パーツの座標と支点。part_contract.json：全33役割の仕様。
原画の女性1人の髪色・線・陰影・光源・画風を維持してください。別のキャラクターにしないでください。
前髪、横髪、後ろ髪を無関係に生成せず、同じ原画と既に生成した髪を毎回参照してください。
AImyなどの独自素材や既存キャラクターの複製はしないでください。

【共通条件】
対象は正面・胸から上。座標は768×1024pxの左上原点。l/rはキャラクター本人基準（本人左は画面右）。
指定線幅：${p.line_width_px===null?'原画に合わせる（数値未指定）':p.line_width_px+'px（基準キャンバス上）'}
指定髪色：${p.hair_palette.length?p.hair_palette.join(', '):'原画のベース色・明部・暗部を参照（色の意味は自動抽出していません）'}
陰影：${p.shading} ／ 光源：${p.lighting}。referenceは原画を基準とする意味です。
役割ごとの完全に独立した8bit RGBA透過PNG。背景・市松模様・顔・目・衣装を髪画像に描き込まないでください。
rect.width×rect.heightの切り抜き画像、または可視画素がrect内だけの768×1024配置済み画像を出してください。
縦横別の引き伸ばしをせず、毛先に透明余白を置いて切らないでください。後から分解する完成絵やパーツシートにしないでください。
原画の人物位置とテンプレート座標は自動で一致していません。ガイドの支点・目・顔との関係を守り、組み立て比較で確認してください。

【最初の3系統・4ファイル】
${contract.parts.filter(v=>DESIGN_HAIR_ROLES.includes(v.role)).map(v=>`${v.file}: rect=${JSON.stringify(v.rect)} anchor=${JSON.stringify(v.anchor)} parent=${v.parent} order=${v.order}`).join('\n')}
1. bangs_front：眉・瞳を覆いすぎず、額と根元を連続して描く。正面の見える毛先を原画と一致させる。
2. side_hair_l / side_hair_r：左右2枚を別々に出す。前髪と同じ毛束の太さ・色・照り返し。耳や顔を含めない。
3. back_hair：顔・首・胴体の後ろに隠れる形も描く。前髪・横髪の根元とつながる輪郭にする。
見えない根元・重なりの下地も動く範囲で描画してください。透明な穴、白縁、残った瞳や肌、別の髪色を混ぜないでください。
まず組み立てプレビューと4枚の髪を確認し、合わない箇所だけを同じ参照で修正してください。

【後続の顔・目・衣装】
同じ原画とpart_contract.jsonの33役割を引き継ぎます。目は白目・虹彩・反射・上下まぶた・まつ毛・眉を独立PNGにします。
髪の下の肌、首と襟の接続、衣装の重なりも描いてください。既存33役割と親・支点・描画順を維持します。
ファイル生成だけで完成品質としません。線幅・色・陰影の一致、隠れ面、瞬き途中、首と髪の境界は別途目視確認が必要です。
`;
}
const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
export async function createReferenceComparison(project,{signal}={}){
  const ref=await validateDesignReference(project.designReference,{signal}),c=canvas(768,554);let a,b;
  try{
    a=await createImageBitmap(ref.blob);b=await createImageBitmap(project.current.preview);checkAbort(signal);
    const ctx=c.getContext('2d');ctx.fillStyle='#eeebf2';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#302a42';ctx.font='16px sans-serif';ctx.fillText('共通原画（配置は未照合）',12,24);ctx.fillText('現在の組み立て・品質未確認',396,24);
    for(const [image,offset] of [[a,0],[b,384]]){const scale=Math.min(384/image.width,512/image.height);ctx.drawImage(image,offset+(384-image.width*scale)/2,36+(512-image.height*scale)/2,image.width*scale,image.height*scale);}
    return await pngBlob(c);
  }finally{a?.close();b?.close();c.width=c.height=0;}
}
export async function createReferencePlacementGuide(project,{signal}={}){
  const ref=await validateDesignReference(project.designReference,{signal}),m=project.current.manifest,c=canvas(m.canvas.width,m.canvas.height);let image;
  try{
    const ctx=c.getContext('2d');ctx.fillStyle='#f2eef7';ctx.fillRect(0,0,c.width,c.height);image=await createImageBitmap(ref.blob);checkAbort(signal);
    const scale=Math.min(c.width/image.width,c.height/image.height);ctx.globalAlpha=.28;ctx.drawImage(image,(c.width-image.width*scale)/2,(c.height-image.height*scale)/2,image.width*scale,image.height*scale);ctx.globalAlpha=1;ctx.lineWidth=2;ctx.font='16px sans-serif';
    for(const [i,role] of DESIGN_HAIR_ROLES.entries()){
      const p=m.parts.find(v=>v.role===role),r=p.rect;ctx.strokeStyle=ctx.fillStyle=['#9e2763','#164aa3','#176c39','#6e3fa0'][i];ctx.strokeRect(r.x+.5,r.y+.5,r.width-1,r.height-1);ctx.fillText(role,r.x+4,r.y+20);
      ctx.beginPath();ctx.moveTo(p.anchor[0]-9,p.anchor[1]);ctx.lineTo(p.anchor[0]+9,p.anchor[1]);ctx.moveTo(p.anchor[0],p.anchor[1]-9);ctx.lineTo(p.anchor[0],p.anchor[1]+9);ctx.stroke();
    }
    ctx.fillStyle='#302a42';ctx.fillText('既存パーツ座標のガイド／原画の解剖的位置は未照合',8,c.height-14);
    return await pngBlob(c);
  }finally{image?.close();c.width=c.height=0;}
}
export async function createHairComparisonSheet(project,{signal}={}){
  const c=canvas(768,676),ctx=c.getContext('2d');ctx.fillStyle='#eeebf2';ctx.fillRect(0,0,c.width,c.height);
  try{
    for(const [i,role] of DESIGN_HAIR_ROLES.entries()){
      checkAbort(signal);let im;
      try{
        im=await createImageBitmap(project.current.assets.get(role));const x=(i%4)*192,scale=Math.min(180/im.width,570/im.height),origin=project.origins[role];
        ctx.fillStyle='#302a42';ctx.font='15px sans-serif';ctx.fillText(role,x+5,22);ctx.font='13px sans-serif';ctx.fillText(origin.kind==='user-png'?'利用者のPNG（由来未確認）':'自作テンプレート',x+5,44);ctx.fillText(`${im.width}×${im.height}px`,x+5,64);
        ctx.fillStyle='#d6d0df';ctx.fillRect(x+6,78,180,580);ctx.drawImage(im,x+(192-im.width*scale)/2,82,im.width*scale,im.height*scale);
      }finally{im?.close();}
    }
    return await pngBlob(c);
  }finally{c.width=c.height=0;}
}
export async function createReferenceArchive(project,{signal,onProgress=()=>{},guideOnly=false}={}){
  const ref=await validateDesignReference(project.designReference,{signal}),contract=await createReferenceContract(project,{signal}),files={};let total=0;
  const put=(name,bytes)=>{total+=bytes.length;if(total>24*1024*1024)throw new Error('原画・比較ZIPは24 MiBまでです。');files[name]=[bytes,{mtime:new Date('2000-01-01T00:00:00Z')}];};
  const blob=async(n,b)=>{checkAbort(signal);put(n,new Uint8Array(await b.arrayBuffer()));};
  const json=(n,v)=>put(n,strToU8(JSON.stringify(v,null,2)+'\n'));
  await blob(ref.meta.source.file,ref.blob);await blob('placement_guide.png',await createReferencePlacementGuide(project,{signal}));json('part_contract.json',contract);
  put('chatgpt_hair_instructions.txt',strToU8(referencePartInstructions(contract)));
  if(!guideOnly){
    const audit=await auditReferenceDesign(project,{signal,onProgress});json('quality_report.json',audit);
    await blob('work_in_progress_preview.png',project.current.preview);await blob('reference_comparison.png',await createReferenceComparison(project,{signal}));
    await blob('hair_comparison.png',await createHairComparisonSheet(project,{signal}));
    for(const role of DESIGN_HAIR_ROLES)await blob('hair/'+role+'.png',project.current.assets.get(role));
  }
  put('README.txt',strToU8(`AI Live2D Maker 共通原画${guideOnly?'制作ガイド':'・髪の品質比較'}\n\n原画の元ファイルをそのまま含みます。AIへの送信・有料生成は行っていません。\n前髪・左右の横髪・後ろ髪の4枚で3系統です。ファイルの関連付けは自己申告で、AI生成元の認証ではありません。\nreference_comparison.pngは原画と現在の組み立てを並べる画像です。数値的な画素一致や自然な完成品を示しません。\n線幅の代理値・色差・陰影のコントラスト・接続点のalphaは注意候補です。光源、隠れた形、境界の自然さは未検証です。\nこのZIPから制作は再開できません。制作ZIPも別に保存してください。出力モデルはInochi2DでCubism/MOC3/VTube Studio互換ではありません。\n\niPhone：アプリの画像をタップすると拡大表示できます。「画像を共有・保存」が使える端末では共有先から「ファイルに保存」を選べます。未対応時は画像の保存・画像だけを開くを使います。\nZIPは保存後にファイルアプリでタップして展開してください。実iPhone/Safariでの保存は未検証です。クラウド内部パスはiPhone用URLではありません。\n`));
  checkAbort(signal);return new Promise((resolve,reject)=>zip(files,{level:0},(e,bytes)=>{
    if(e)return reject(e);if(bytes.length>24*1024*1024)return reject(new Error('原画・比較ZIPは24 MiBまでです。'));
    try{checkAbort(signal);resolve(new Blob([bytes],{type:'application/zip'}));}catch(error){reject(error);}
  }));
}
