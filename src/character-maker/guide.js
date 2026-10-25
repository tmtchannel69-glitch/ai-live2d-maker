import {zip,strToU8} from 'fflate';
import {assembleValidatedCharacter} from '../character-generation/generator.js';
import {PART_SETS} from '../../shared/modular-character.js';

// Download only. This module never calls a remote generation provider.
export async function createMakerGuide(project){
  const m=project.base.manifest,reference=await assembleValidatedCharacter(m,project.base.assets);
  const spec={format:'ai-live2d-independent-part-request',version:1,canvas:m.canvas,
    character_design:m.design||m.generator.recipe,sides:'character-personal-left-right',
    coordinates:'canvas-pixels-top-left',generation_performed:false,
    parts:m.parts.map(p=>({role:p.role,filename:p.role+'.png',rect:p.rect,anchor:p.anchor,parent:p.parent,order:p.order,clip_to:p.clip_to})),
    replacement_sets:PART_SETS,
    requirements:['Use this shared character design and reference for all requested parts. Do not make unrelated characters.',
      'Each file is one independent RGBA8 transparent PNG, not a sheet, checkerboard painting, or flattened eye/face.',
      'Use the exact cropped width/height and placement in rect. Alternatively use the 768x1024 reference canvas with visible pixels only inside rect.',
      'l/r mean the character’s own left/right. Keep eye whites, irises, highlights, lids and lashes independent.',
      'Draw hidden overlap/attachment areas needed for motion. Preserve the reference line weight, palette and lighting.',
      'Do not copy any third-party character design or proprietary assets. Rights and AI provenance must be checked separately.']};
  const text='独立パーツ制作ガイド（AIへの送信は行っていません）\n\nshared_reference.pngは元に戻す基準キャラクター、part_request.jsonは同じデザインに沿った33役割の配置表です。\n前髪ならbangs_front.png、目なら白目・虹彩・反射・まぶた・まつ毛を別PNGで用意してください。目全体1枚をirisなどとして取り込まないでください。\n1枚のシートを自動で正しく分離する機能はありません。透過RGBA8、指定の切り抜き寸法か768x1024配置済みキャンバスを使います。\nファイル名で自動照合し、画面の「確認して交換」で端末内だけで検査します。基準外の形状・隠れ領域・画風は自動保証できません。\nChatGPT等に送るかはご自身で判断してください。この操作は依頼仕様を端末に保存するだけです。\n';
  const files={'shared_reference.png':new Uint8Array(await reference.arrayBuffer()),'part_request.json':strToU8(JSON.stringify(spec,null,2)+'\n'),'README.txt':strToU8(text)};
  return new Promise((resolve,reject)=>zip(files,{level:0},(e,b)=>e?reject(e):resolve(new Blob([b],{type:'application/zip'}))));
}
