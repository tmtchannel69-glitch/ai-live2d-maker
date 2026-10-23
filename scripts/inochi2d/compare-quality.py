"""Build a private before/after review from official Creator screenshots.

Does not render a model or certify appearance. Refuses different source hashes
and mismatched displayed eye values. The twelve common poses remain comparable
even though the new rig separates HeadX/HeadTilt and anchors the torso.
"""
import argparse
import base64
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[2]


def run(args):
    before, after, out=(Path(p).resolve() for p in (args.before,args.after,args.output))
    if out.is_relative_to(ROOT) or out.exists():
        raise ValueError('Use a new private output directory.')
    reports=[json.loads((p/'creator-report.json').read_text()) for p in (before,after)]
    if reports[0]['source_sha256'] != reports[1]['source_sha256']:
        raise ValueError('Comparison requires exactly the same input image.')
    out.mkdir(parents=True,mode=0o700)
    names=[p['pose'] for p in reports[0]['poses'][:12]]
    cell_w,cell_h=620,350
    contact=Image.new('RGB',(4*cell_w,3*cell_h),'#303039'); draw=ImageDraw.Draw(contact)
    review=[]; comparison=[]
    torso=reports[1]['fixed_torso_roi']
    for index,name in enumerate(names):
        pair=[]; poses=[]
        for folder,report in zip((before,after),reports):
            pose=next(p for p in report['poses'] if p['pose']==name); poses.append(pose)
            frame=Image.open(folder/(name+'.png')).convert('RGB')
            crop=frame.crop(report['face_roi']);crop.thumbnail((300,300))
            pair.append(crop)
        for key in ('EyeOpenL','EyeOpenR'):
            if abs(poses[0]['displayed'][key]-poses[1]['displayed'][key])>.005:
                raise ValueError('Eye states differ; do not silently compare different openings.')
        x,y=index%4*cell_w,index//4*cell_h
        draw.text((x+8,y+6),name,fill='white')
        for j,im in enumerate(pair):
            draw.text((x+8+j*310,y+22),'BEFORE' if j==0 else 'AFTER',fill='white')
            contact.paste(im,(x+8+j*310,y+42))
        panel=Image.new('RGB',(620,350),'#303039');pd=ImageDraw.Draw(panel)
        for j,im in enumerate(pair):
            pd.text((j*310+8,6),'BEFORE' if j==0 else 'AFTER',fill='white');panel.paste(im,(j*310+8,35))
        buffer=io.BytesIO();panel.save(buffer,'PNG')
        review.append({'name':name,'image':'data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode(),
                       'before':poses[0]['displayed'],'after':poses[1]['displayed']})
        old_neutral=np.array(Image.open(before/'neutral.png').crop(torso))
        old_pose=np.array(Image.open(before/(name+'.png')).crop(torso))
        comparison.append({'pose':name,'baseline_fixed_torso_changed_pixels':int(np.any(old_neutral!=old_pose,axis=2).sum()),
            'after_fixed_torso_changed_pixels':poses[1]['fixed_torso_changed_pixels'],
            'before_displayed':poses[0]['displayed'],'after_displayed':poses[1]['displayed']})
    contact.save(out/'12-state-before-after.png')
    # Full size eye details expose seams and lash shape hidden by thumbnails.
    eyes=Image.new('RGB',(800,600),'#303039');ed=ImageDraw.Draw(eyes)
    for i,(folder,report) in enumerate(zip((before,after),reports)):
        left,right=report['eye_rois']['r'],report['eye_rois']['l']
        bounds=(left[0]-8,min(left[1],right[1])-18,right[2]+8,max(left[3],right[3])+18)
        for j,pose in enumerate(['both_closed','both_half']):
            im=Image.open(folder/(pose+'.png')).crop(bounds);im.thumbnail((390,250))
            ed.text((i*400+8,j*300+8),('BEFORE' if i==0 else 'AFTER')+' '+pose,fill='white')
            eyes.paste(im,(i*400+8,j*300+42))
    eyes.save(out/'closed-half-before-after.png')
    transition=[]
    for p in reports[1]['poses']:
        if p['pose'].startswith('blink_'):
            im=Image.open(after/(p['pose']+'.png')).crop(reports[1]['face_roi']);im.thumbnail((300,300))
            transition.append((p,im))
    if transition:
        sheet=Image.new('RGB',(5*310,2*340),'#303039');sd=ImageDraw.Draw(sheet)
        for i,(p,im) in enumerate(transition):
            x,y=i%5*310,i//5*340
            sd.text((x+5,y+5),f"EyeOpen: {p['displayed']['EyeOpenL']:.2f}",fill='white');sheet.paste(im,(x+5,y+30))
        sheet.save(out/'10-blink-states.png')
    paired_transitions=[]
    if args.include_transitions:
        # Same actual displayed values and native scale are mandatory. The
        # widened GUI audit can now record ten distinct openings on both rigs.
        sheet=Image.new('RGB',(1560,5*220),'#303039');sd=ImageDraw.Draw(sheet)
        for i,(after_pose,_) in enumerate(transition):
            name=after_pose['pose'];before_pose=next(p for p in reports[0]['poses'] if p['pose']==name)
            for key in ('EyeOpenL','EyeOpenR'):
                if abs(before_pose['displayed'][key]-after_pose['displayed'][key])>.005:
                    raise ValueError('Displayed transition openings differ between the two official sessions.')
            panel=Image.new('RGB',(780,220),'#303039');pd=ImageDraw.Draw(panel)
            for j,(folder,report,pose) in enumerate(zip((before,after),reports,(before_pose,after_pose))):
                left,right=report['eye_rois']['r'],report['eye_rois']['l']
                bounds=(left[0]-8,min(left[1],right[1])-18,right[2]+8,max(left[3],right[3])+18)
                im=Image.open(folder/(name+'.png')).crop(bounds);im.thumbnail((380,180))
                pd.text((j*390+5,5),('BEFORE' if j==0 else 'AFTER')+f" open={pose['displayed']['EyeOpenL']:.2f}",fill='white');panel.paste(im,(j*390+5,30))
            sheet.paste(panel,((i%2)*780,(i//2)*220))
            buffer=io.BytesIO();panel.save(buffer,'PNG')
            review.append({'name':name,'image':'data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode(),
                'before':before_pose['displayed'],'after':after_pose['displayed']})
            paired_transitions.append({'pose':name,'before_displayed':before_pose['displayed'],'after_displayed':after_pose['displayed']})
        sheet.save(out/'10-opening-before-after.png')
    data=json.dumps(review,ensure_ascii=True).replace('<','\\u003c')
    motion_note=('頭の移動・傾きは前後とも同じ首の変形方式と動作量です。' if args.same_head_template else
                 '胴体を固定し、頭の移動と傾きを分けました。')
    html='''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Inochi2D 改善前後の比較</title><style>body{background:#20202a;color:#fff;font:16px system-ui;margin:0 auto;max-width:850px;padding:16px}select,button{font:inherit;min-height:48px;margin:4px}select{min-width:0;max-width:100%}img{width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px system-ui}nav{display:flex;flex-wrap:wrap;gap:4px}</style>
<h1>改善前後の比較</h1><p>公式Creator 0.8.6で撮影した12状態です。左が改善前、右が改善後。画像の再生であり、モデルのリアルタイム表示ではありません。</p>
<nav><button id="prev">前へ</button><select id="pose" aria-label="比較する状態"></select><button id="next">次へ</button></nav>
<img id="frame" alt="改善前後の顔の比較"><pre id="values"></pre><p>閉眼の境界と細部は改善途中です。__MOTION_NOTE__完成品質の合格判定ではありません。</p>
<script>const frames=__DATA__,select=document.getElementById('pose');frames.forEach((f,i)=>select.add(new Option(f.name,i)));
function show(){const f=frames[select.selectedIndex];document.getElementById('frame').src=f.image;document.getElementById('values').textContent='撮影時の値\\n改善前 '+JSON.stringify(f.before)+'\\n改善後 '+JSON.stringify(f.after);}
select.onchange=show;document.getElementById('prev').onclick=()=>{select.selectedIndex=(select.selectedIndex+frames.length-1)%frames.length;show()};document.getElementById('next').onclick=()=>{select.selectedIndex=(select.selectedIndex+1)%frames.length;show()};show();</script></html>'''.replace('__DATA__',data).replace('__MOTION_NOTE__',motion_note).replace('撮影した12状態です。',f'撮影した{len(review)}状態です。')
    (out/'review.html').write_text(html,encoding='utf-8')
    result={'schema':1,'source_sha256':reports[0]['source_sha256'],
        'baseline_model_sha256':reports[0]['model_sha256'],'after_model_sha256':reports[1]['model_sha256'],
        'poses':comparison,'after_additional_openings':[p['displayed'] for p,_ in transition],
        'paired_transitions':paired_transitions,
        'official_screenshots':True,'appearance_quality_passed':False,
        'notes':['HeadX and HeadTilt are used together for the twelve common motion poses.',
                 ('Both models use the same neck-weighted mesh template: +/-12px and .045rad.' if args.same_head_template else
                  'The baseline whole-foreground pose uses +/-14px and .06rad; the new neck warp uses bounded +/-12px and .045rad.'),
                 'Thumbnails do not establish production quality; use full-size screenshots to inspect artifacts.']}
    (out/'comparison-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(out),'common_poses':len(names),'transition_frames':len(transition)}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('before','after','output'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--same-head-template',action='store_true',help='Both models retain the quality neck-warp template; only blink/parts changed.')
    parser.add_argument('--include-transitions',action='store_true',help='Add matched official before/after blink states to the image and offline review.')
    run(parser.parse_args())
