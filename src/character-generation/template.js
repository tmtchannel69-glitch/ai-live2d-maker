import {FORMAT,TEMPLATE_ID,validateRecipe,validateCharacterManifest} from '../../shared/generated-character.js';

export const HAIR_COLORS={lavender:['#dfd9ef','#aca0c8','#655778'],silver:['#f2f0f7','#c7c3d8','#77718c'],brown:['#d4ab8a','#946e59','#503c40']};
export const EYE_COLORS={violet:['#c6b7ff','#8065bd','#392852'],blue:['#b1e7fc','#588cbb','#203955'],amber:['#ffe2a0','#bd863f','#503823']};
const labels={face_base:'顔の肌',ear:'耳',eye_white:'白目',iris:'虹彩・瞳孔',highlight:'瞳のハイライト',eyelid_upper:'上まぶた',eyelid_lower:'下まぶた',eyelashes:'まつげ',brow:'眉',mouth_base:'通常の口',mouth_inside:'口内（通常顔では非表示）',bangs_front:'前髪',side_hair:'横髪',back_hair:'後ろ髪',neck:'首',torso:'胴体',shoulder:'肩',dress_base:'メイド服',collar:'襟',ribbon:'リボン',sleeve:'袖',apron:'エプロン'};
// All rectangles and anchors are canvas pixels. l is the character's left,
// therefore the viewer's right. Pair geometry is reflected, never relabelled.
export function createTemplateManifest(options={}){
  const recipe=validateRecipe(options),parts=[];
  const add=(role,rect,anchor,order,parent,enabled=true,clip_to=null)=>{
    const side=role.endsWith('_l')?'l':role.endsWith('_r')?'r':null,base=side?role.slice(0,-2):role;
    parts.push({id:role,role,label:(side?(side==='l'?'本人左':'本人右')+'の':'')+labels[base],side,
      file:`parts/${role}.png`,rect:{x:rect[0],y:rect[1],width:rect[2],height:rect[3]},anchor,parent,order,enabled_in_neutral:enabled,clip_to});
  };
  const paired=(base,rect,anchor,order,parent='group_head',clip=false)=>{
    add(base+'_r',rect,anchor,order,parent==='eye'?'group_eye_r':parent,true,clip?'eye_white_r':null);
    add(base+'_l',[768-rect[0]-rect[2],rect[1],rect[2],rect[3]],[768-anchor[0],anchor[1]],order+1,parent==='eye'?'group_eye_l':parent,true,clip?'eye_white_l':null);
  };
  add('back_hair',[96,58,576,914],[384,100],0,'group_hair');
  add('torso',[190,586,388,438],[384,690],10,'group_body');
  add('neck',[306,490,156,180],[384,516],15,'group_neck');
  paired('shoulder',[146,590,164,144],[260,630],20,'group_body');
  paired('sleeve',[80,620,220,332],[240,660],30,'group_body');
  add('dress_base',[172,612,424,412],[384,665],40,'group_body');
  add('apron',[234,730,300,294],[384,745],50,'group_body');
  add('collar',[283,584,202,129],[384,626],60,'group_body');
  add('ribbon',[302,647,164,122],[384,676],70,'group_body');
  paired('ear',[208,323,46,117],[238,347],80);
  add('face_base',[224,156,320,398],[384,526],90,'group_head');
  paired('brow',[250,279,116,28],[305,296],100);
  paired('eye_white',[242,310,128,88],[306,349],110,'eye');
  paired('iris',[278,326,56,68],[306,355],120,'eye',true);
  paired('highlight',[278,326,56,68],[306,355],130,'eye',true);
  paired('eyelid_lower',[248,350,124,56],[306,374],140,'eye');
  paired('eyelid_upper',[236,300,140,58],[306,337],150,'eye');
  paired('eyelashes',[230,312,144,66],[306,337],160,'eye');
  add('mouth_inside',[358,446,52,35],[384,461],170,'group_mouth',false);
  add('mouth_base',[347,441,74,37],[384,458],180,'group_mouth');
  paired('side_hair',[133,210,142,720],[230,240],190,'group_hair');
  add('bangs_front',[196,94,376,244],[384,130],200,'group_hair');
  return validateCharacterManifest({format:FORMAT,version:1,canvas:{width:768,height:1024},
    coordinates:'canvas-pixels-top-left',sides:'character-personal-left-right',preview:'preview.png',background:recipe.background,
    generator:{id:recipe.provider,version:1,ai_generated:false,recipe},
    groups:[{id:'root',parent:null,anchor:[384,512]},{id:'group_body',parent:'root',anchor:[384,800]},
      {id:'group_neck',parent:'group_body',anchor:[384,617]},{id:'group_head',parent:'group_neck',anchor:[384,537]},
      {id:'group_eye_r',parent:'group_head',anchor:[306,349]},{id:'group_eye_l',parent:'group_head',anchor:[462,349]},
      {id:'group_mouth',parent:'group_head',anchor:[384,458]},{id:'group_hair',parent:'group_head',anchor:[384,130]}],
    parts,template:TEMPLATE_ID,scope:{pose:'front',crop:'bust',costume:'maid',expression:'neutral',person_count:1},
    rigged:false,appearance_quality_passed:false});
}

export function partSvg(part,recipe){
  recipe=validateRecipe(recipe);const [light,mid,dark]=HAIR_COLORS[recipe.hair],[eyeLight,eyeMid,eyeDark]=EYE_COLORS[recipe.eyes];
  const q=part.rect,role=part.role.replace(/_[lr]$/,''),flip=part.side==='l';
  const defs=`<defs><linearGradient id="hair" x1="0" y1="0" x2="1" y2=".7"><stop stop-color="${light}"/><stop offset=".45" stop-color="${mid}"/><stop offset=".72" stop-color="${light}"/><stop offset="1" stop-color="${mid}"/></linearGradient><linearGradient id="skin" x2=".2" y2="1"><stop stop-color="#fff0e5"/><stop offset=".7" stop-color="#ffe5db"/><stop offset="1" stop-color="#efc3b7"/></linearGradient><linearGradient id="cloth" x2="1" y2="1"><stop stop-color="#474354"/><stop offset=".6" stop-color="#282735"/><stop offset="1" stop-color="#191b29"/></linearGradient><linearGradient id="white" x2=".5" y2="1"><stop stop-color="#ffffff"/><stop offset="1" stop-color="#ddd9e9"/></linearGradient><linearGradient id="eye" x2="0" y2="1"><stop stop-color="${eyeDark}"/><stop offset=".65" stop-color="${eyeMid}"/><stop offset="1" stop-color="${eyeLight}"/></linearGradient><radialGradient id="blush"><stop stop-color="#eaa7ae" stop-opacity=".5"/><stop offset="1" stop-color="#f2b5b9" stop-opacity="0"/></radialGradient></defs>`;
  let art='';
  const path=(d,fill,stroke='#574453',width=2)=>`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const line=(d,color,width=2)=>path(d,'none',color,width);
  switch(role){
    case 'back_hair':
      art=path('M384,70 C217,65 137,154 144,316 C151,506 101,635 113,851 C173,962 251,956 300,889 L468,889 C517,958 595,960 654,854 C670,674 614,492 624,316 C632,154 551,65 384,70Z','url(#hair)',dark,3)
        +line('M220,190 C150,380 226,550 162,853 M275,133 C202,355 281,577 238,914 M548,190 C618,380 542,550 606,853 M493,133 C566,355 487,577 530,914',light,5)
        +line('M194,265 C172,475 216,716 181,858 M574,265 C596,475 552,716 587,858',dark,1.8);break;
    case 'face_base':
      art=path('M240,280 C231,195 295,164 384,168 C480,165 540,211 528,322 C529,443 470,509 384,548 C300,512 236,449 239,351Z','url(#skin)','#b98f8e',2)
        +'<ellipse cx="270" cy="408" rx="36" ry="23" fill="url(#blush)"/><ellipse cx="498" cy="408" rx="36" ry="23" fill="url(#blush)"/>'
        +line('M383,399 Q379,413 385,417','#d49d98',1.8)+'<ellipse cx="386" cy="399" rx="4" ry="7" fill="#fff5ed" opacity=".8"/>';break;
    case 'ear':art='<ellipse cx="233" cy="377" rx="21" ry="49" fill="url(#skin)" stroke="#c19a96" stroke-width="2"/>'+line('M235,352 C213,355 217,393 235,401 M227,373 Q241,374 233,390','#d2a29e',3);break;
    case 'eye_white':art=path('M249,352 C273,324 333,324 363,348 C341,379 280,385 249,352Z','#fffdfb','#d7a4a9',1.3);break;
    case 'iris':art='<ellipse cx="306" cy="359" rx="25" ry="32" fill="url(#eye)" stroke="'+eyeDark+'" stroke-width="2"/><ellipse cx="306" cy="354" rx="10" ry="22" fill="'+eyeDark+'"/>'+line('M288,372 Q306,386 324,371',eyeLight,3);break;
    case 'highlight':art='<ellipse cx="294" cy="341" rx="6" ry="8" fill="white"/><circle cx="318" cy="370" r="3.5" fill="#fff9f5"/><circle cx="320" cy="346" r="2" fill="white"/>';break;
    case 'eyelid_upper':art=path('M240,345 C270,313 333,315 371,345 L365,351 C331,326 276,327 245,354Z','#f7d9d2','#c69ba0',1.3);break;
    case 'eyelid_lower':art=path('M253,359 C283,383 329,384 362,353 L364,358 C335,389 280,392 252,363Z','#f9dcd5','none')+line('M266,372 C293,385 330,380 346,370','#c998a3',1.4);break;
    case 'eyelashes':art=path('M247,352 C273,322 333,322 365,348 C336,329 277,334 251,359Z','#403042','#403042',1.5)+path('M255,347 Q241,343 234,333 Q235,346 247,354Z','#403042','#403042',1)+line('M246,350 Q235,348 232,343 M260,339 Q248,335 246,329','#403042',2.6);break;
    case 'brow':art=line('M254,298 C287,282 326,283 357,294',dark,4)+line('M265,293 Q303,282 345,291',mid,1.4);break;
    case 'mouth_base':art=line('M359,454 Q384,466 409,454','#a46b7d',2.2)+line('M375,466 Q385,468 395,465','#fff5ed',2.4);break;
    case 'mouth_inside':art='<ellipse cx="384" cy="462" rx="23" ry="14" fill="#713d54"/><path d="M366,469 Q384,458 402,469 Q384,481 366,469" fill="#d59baa"/>';break;
    case 'bangs_front':
      art=path('M211,275 C202,181 274,100 384,100 C502,104 570,187 557,281 L537,322 C524,263 506,233 477,206 C473,258 454,290 447,309 C425,294 403,257 384,210 C381,264 353,295 330,309 C329,278 303,245 286,221 C279,260 252,286 231,318Z','url(#hair)',dark,2.3)
        +line('M230,239 C241,154 309,119 356,117 M412,119 C474,119 523,162 541,234',light,8)
        +line('M381,115 C348,163 334,221 330,286 M391,116 C432,172 454,230 447,291 M287,221 Q294,166 359,120 M477,206 Q465,152 411,119',dark,1.5);break;
    case 'side_hair':
      art=path('M235,221 C205,281 211,383 197,482 C176,594 158,737 150,846 Q170,910 243,915 Q187,876 214,781 C244,652 251,514 256,428 C243,354 245,286 264,237Z','url(#hair)',dark,2)
        +line('M235,257 C223,401 231,508 207,639 C188,766 174,852 214,897',light,5)
        +line('M217,417 C218,553 181,743 175,837 Q177,871 209,892',dark,1.5);break;
    case 'neck':art=path('M330,505 L438,505 C436,555 436,586 457,612 Q386,664 311,614 C335,588 334,552 330,505Z','url(#skin)','#b58e91',2)+path('M332,520 Q384,558 436,520 L435,549 Q383,584 333,550Z','#ddb5ae','none');break;
    case 'torso':art=path('M278,600 Q384,580 490,600 C547,710 556,856 556,1024 H212 C213,826 220,701 278,600Z','url(#skin)','#c09a98',2);break;
    case 'shoulder':art='<ellipse cx="228" cy="660" rx="76" ry="65" fill="url(#skin)" stroke="#c19a99" stroke-width="2"/>';break;
    case 'sleeve':art=path('M208,630 C125,627 84,703 92,787 L127,899 Q206,940 282,871 L292,748 C293,687 257,648 208,630Z','url(#cloth)','#252436',3)
      +line('M156,664 C119,723 148,796 151,847 M228,666 C262,726 246,790 237,838','#666073',2)
      +path('M123,873 Q145,859 161,887 Q181,865 200,892 Q221,866 238,885 Q261,859 280,866 L277,900 Q254,922 233,908 Q210,933 191,916 Q166,935 149,912 Q126,928 119,902Z','url(#white)','#c0b9cf',1.8);break;
    case 'dress_base':art=path('M276,618 C340,643 428,643 492,618 C541,668 565,836 590,1024 H178 C196,850 229,656 276,618Z','url(#cloth)','#252436',3)
      +line('M276,670 Q248,829 239,997 M492,670 Q520,829 529,997','#655d73',2.5);break;
    case 'collar':art=path('M384,631 L333,589 L287,624 L335,706 L384,654 L433,706 L481,624 L435,589Z','url(#white)','#bcb4cd',2)
      +line('M333,598 L298,625 L337,691 M435,598 L470,625 L431,691','#efecf5',4);break;
    case 'ribbon':art=path('M378,673 Q331,635 309,657 L312,711 Q339,719 379,691 L348,756 L379,744 L387,700 L404,755 L433,761 L394,689 Q438,719 458,709 L459,659 Q434,638 391,672Z',mid,dark,2)
      +path('M376,668 Q385,664 394,670 L395,695 Q384,704 375,695Z',dark,dark,2)+line('M322,664 Q343,671 365,680 M446,665 Q427,671 406,681',light,2.5);break;
    case 'apron':art=path('M269,741 Q384,762 499,741 L529,1024 H239Z','url(#white)','#c7bfd8',2)
      +path('M247,742 Q262,727 275,749 Q290,730 306,752 Q321,735 336,757 Q352,740 367,760 Q385,742 401,760 Q417,739 432,755 Q447,735 462,752 Q480,730 494,746 Q508,731 518,750 L511,776 Q384,792 257,775Z','#fffdfd','#d4ccdf',1.5)
      +line('M269,803 Q260,914 258,1010 M499,803 Q508,914 510,1010','#d5cce3',2)
      +[823,878,933].map(y=>`<circle cx="384" cy="${y}" r="6" fill="#494052"/><circle cx="382" cy="${y-2}" r="1.5" fill="#8c819b"/>`).join('');break;
    default:throw new Error('未定義のパーツです。');
  }
  if(recipe.provider==='dummy')art=`<rect x="${q.x+3}" y="${q.y+3}" width="${q.width-6}" height="${q.height-6}" rx="${Math.min(18,q.width/4,q.height/4)}" fill="${role.includes('hair')?mid:role.includes('eye')||role==='iris'?eyeMid:role==='face_base'||role==='neck'?'#ffe5db':'#aaa1cb'}" stroke="#594a73" stroke-width="2"/>`;
  else if(flip)art=`<g transform="translate(768 0) scale(-1 1)">${art}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${q.width}" height="${q.height}" viewBox="${q.x} ${q.y} ${q.width} ${q.height}">${defs}${art}</svg>`;
}
