import {zip,strToU8} from 'fflate';
import {validateCharacterManifest,createRigMetadata,createInochiIntermediate} from '../../shared/generated-character.js';

export async function createCharacterArchive(character){
  const m=validateCharacterManifest(character.manifest);
  if(!(character.assets instanceof Map)||character.assets.size!==m.parts.length||m.parts.some(p=>!(character.assets.get(p.role) instanceof Blob))||!(character.preview instanceof Blob))throw new Error('保存するパーツと完成画像が不足しています。');
  const files={};let total=0;
  const put=(name,bytes)=>{total+=bytes.length;if(total>16*1024*1024)throw new Error('保存サイズが上限を超えています。');files[name]=[bytes,{mtime:new Date('2000-01-01T00:00:00Z')}];};
  const json=(name,value)=>put(name,strToU8(JSON.stringify(value,null,2)+'\n'));
  for(const p of m.parts)put(p.file,new Uint8Array(await character.assets.get(p.role).arrayBuffer()));
  put('preview.png',new Uint8Array(await character.preview.arrayBuffer()));
  json('character_manifest.json',m);json('rig_metadata.json',createRigMetadata(m));json('inochi_intermediate.json',createInochiIntermediate(m));json('generation_recipe.json',m.generator.recipe);
  put('README.txt',strToU8(`AI Live2D Maker: パーツから生成したキャラクター\n\n生成方式: ${m.generator.id==='dummy'?'配置確認用の図形':'端末内のテンプレート描画'}。AI自由生成ではありません。\nparts/ の33PNGは完成画像を切り分けず、独立して描いています。左右は本人基準（l＝画面右）。\n座標は768×1024キャンバスの左上基準ピクセル。order昇順で配置。anchorも同じ座標系です。\n虹彩/反射はclip_toの白目alphaで合成時にクリップ。口内PNGは通常顔では非表示です。\npreview.pngは背景設定を含み、パーツPNGは常に透過です。\nrig_metadata.jsonは静止mesh/支点/親子です。動作キーや物理は未実装。\ninochi_intermediate.jsonは接続候補のデータで、実INP/INXやCubism/VTube Studioモデルではありません。\n\n再生成: 同じコード版のキャラ生成モードで色/背景/方式を選び直すか、\n開発サーバー起動後、node scripts/character-generation/export.mjs --recipe generation_recipe.json --output NEW_PRIVATE_DIRECTORY\n画像の描画結果はブラウザの実装により多少異なる場合があります。\n\nこのZIPは従来の「作業ファイルを開く」とは別形式です。生成画像をGitHubへアップロードしないでください。\n`));
  return new Promise((resolve,reject)=>zip(files,{level:0},(error,data)=>error?reject(error):resolve(new Blob([data],{type:'application/zip'}))));
}
