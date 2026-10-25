// A downloadable request, never an API call or a claim that regeneration ran.
export function bangsRegenerationRequest(project){
  const m=project.current.manifest,p=m.parts.find(p=>p.role==='bangs_front'),palette=m.blueprint?.palette,style=m.blueprint?.style,q=p.rect;
  return `AI Live2D Maker：前髪の再生成依頼（未送信）

参考1：before.png（既存の女性ベース）。参考2：source_original.png（ユーザーが用意したラベンダー色の前髪）。参考3：after.png（現在の装着結果）。

【既存ベースへ絵柄をそろえる場合】
参考2の前髪のデザインを参考1の顔・後ろ髪・横髪に合う独立パーツとして描き直してください。顔・目・眉・耳・肌・服・背景を描き込まず、前髪とこめかみの短い毛束だけを出力してください。正面向きで両目を見せ、長い巻き毛が瞳を横切らない形にしてください。目元の開口を確保し、眉は少なくとも半分程度を見せてください。
線幅は基準画像の約${style?.line_width||2}px相当、線色${palette?.ink||'#403042'}。髪の基準色${palette?.hair?.base||'#b6a4d9'}、明部${palette?.hair?.light||'#dcd3ed'}、影${palette?.hair?.dark||'#756486'}。光源は左上。細かすぎる光沢や白い縁取りを抑え、基準画像のsoft-celの塗り・輪郭にそろえてください。
後ろ髪の丸い頭頂と接続する頭のカーブを参考1に合わせ、根元の重なり部分も描いてください。線や毛先を枠で切らず、少なくとも2pxの透明余白を付けます。

出力：役割bangs_front、PNGファイル名bangs_front.png。8bit RGBAで本当の透明背景（白・グレー・市松模様を描かない）。髪の内部は原則alpha255、輪郭だけ自然な半透明。青紫や白の浮いた点・不要な背景画素を残さない。
現在の配置データ：全体768×1024px、前髪rect x=${q.x}, y=${q.y}, width=${q.width}, height=${q.height}、anchor=[${p.anchor.join(', ')}]、親=${p.parent}、前後順=${p.order}。
厳密に位置を合わせる場合は${q.width}×${q.height}pxのパーツPNG、または全体768×1024pxに配置しrect外を完全透明にしたPNGをください。生成器が位置を正確に守れない場合は無理に変形せず余白付きの高解像度PNGを作り、アプリの自動配置で再検査します。

【今回の高密度な髪の絵柄を残す場合】
前髪だけを単純な既存絵柄に落とさず、参考2を共通デザインとして後ろ髪・左右の横髪、次に顔などを別パーツで作り直す方法があります。無関係なキャラクターを各パーツで生成せず、色・線・陰影・正面のサイズと接続位置を共有します。各パーツは独立透過PNGとし、33役割の配置ガイドを使ってください。こちらは次の工程で、今回実行済みではありません。

この文章と参考画像をどのサービスへ送るかはオーナーが判断します。アプリは外部送信・AI生成・課金を行いません。他社のキャラクターや独自素材をコピーしないでください。
`;
}
