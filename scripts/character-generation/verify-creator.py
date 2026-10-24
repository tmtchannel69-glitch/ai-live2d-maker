"""Official 0.8.6 GUI audit of the generated 33-part rig, not a renderer.

Fixed saved layout: 1280x960, Parameters panel x=115..356. Ordinary setup/
donation notice must already be closed. Every control value is OCR checked.
No artwork, mesh or rig keys are edited. Files stay in a new private folder.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

import cv2
import numpy as np
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/inochi2d'))
from creator_ui import CreatorUI

NAMES=['EyeOpenL','EyeOpenR','MouthOpen','HeadX','HeadY','HeadTilt']
TOPS=dict(zip(NAMES,[138,229,320,411,502,593]))
ROWS=dict(zip(NAMES,[173,265,356,447,538,629]))
DEFAULTS=dict(zip(NAMES,[1,1,0,0,0,0]))
VIEWPORT=(358,88,1170,900)
POSES=[('neutral',{}),('left_closed',{'EyeOpenL':0}),('right_closed',{'EyeOpenR':0}),
       ('both_closed',{'EyeOpenL':0,'EyeOpenR':0}),('left_half',{'EyeOpenL':.5}),('right_half',{'EyeOpenR':.5})]
POSES += [(f'blink_{v:g}',{'EyeOpenL':v,'EyeOpenR':v}) for v in [.025,.075,.15,.25,.5,.75]]
POSES += [(f'mouth_{v:g}',{'MouthOpen':v}) for v in [.075,.15,.25,.5,1]]
POSES += [(f'{name}_{v}',{name:v}) for name in ['HeadX','HeadY','HeadTilt'] for v in [-1,1]]
POSES += [('combined_left',{'EyeOpenL':0,'MouthOpen':1,'HeadX':-1,'HeadY':1,'HeadTilt':-1}),
          ('combined_right',{'EyeOpenR':0,'MouthOpen':.5,'HeadX':1,'HeadY':-1,'HeadTilt':1}),('neutral_return',{})]

def audit(args):
    output=Path(args.output).resolve();source=Path(args.input).resolve()
    if output.is_relative_to(ROOT) or output.exists():raise ValueError('Use a new private evidence folder.')
    if source.is_relative_to(ROOT):raise ValueError('Generated models must be outside Git.')
    ui=CreatorUI(args.xdotool,args.display,args.model,args.input_delay_scale)
    preview=Image.open(source/'preview.png').convert('RGB')
    output.mkdir(mode=0o700);last=None

    def read(image):return {name:ui.value(image,TOPS[name]) for name in NAMES}
    def apply(wanted):
        nonlocal last
        for name,value in wanted.items():
            if last is not None and last[name]==value:continue
            t=(value+1)/2 if name.startswith('Head') else value
            ui.click(round(158+131*t),ROWS[name],shift=True)
        ui.pointer_away();time.sleep(.3*args.input_delay_scale)
        shot=ui.snapshot();actual=read(shot)
        if any(abs(actual[n]-wanted[n])>.006 for n in NAMES):
            shot.save(output/'failed-control.png')
            raise ValueError('Displayed values do not match requested pose: '+repr((wanted,actual)))
        last=wanted.copy();return shot,actual

    # Click the fit->100% button only if this process is still at initial fit.
    # For an already-native view, this region contains just position text.
    ui.click(457,923);time.sleep(.5)
    neutral,_=apply(DEFAULTS)
    box=(250,315,364,395);template=np.array(preview.crop(box))
    match=cv2.matchTemplate(cv2.cvtColor(np.array(neutral.crop(VIEWPORT)),cv2.COLOR_RGB2GRAY),cv2.cvtColor(template,cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED)
    _,score,_,loc=cv2.minMaxLoc(match)
    if score<.98:neutral.save(output/'failed-calibration.png');raise ValueError('Native-size template calibration failed: '+str(score))
    origin=(VIEWPORT[0]+loc[0]-box[0],VIEWPORT[1]+loc[1]-box[1])
    roi=lambda b:tuple(round(v+origin[i%2]) for i,v in enumerate(b))
    body=roi((342,805,426,850));neck=roi((360,550,408,585));face=roi((215,275,553,495))
    for b in [body,neck,face]:
        if b[0]<VIEWPORT[0] or b[1]<VIEWPORT[1] or b[2]>VIEWPORT[2] or b[3]>VIEWPORT[3]:raise ValueError('Required ROI is clipped at native view.')
    records=[];thumbs=[]
    for name,overrides in ([('neutral',{})] if args.neutral_only else POSES):
        wanted={**DEFAULTS,**overrides};shot,actual=apply(wanted);shot.save(output/(name+'.png'))
        delta=np.abs(np.array(shot.crop(VIEWPORT)).astype(int)-np.array(neutral.crop(VIEWPORT)).astype(int))
        body_delta=np.any(np.array(shot.crop(body))!=np.array(neutral.crop(body)),axis=2)
        record={'name':name,'requested':wanted,'displayed':actual,'changed_viewport_pixels':int(np.count_nonzero(np.any(delta,axis=2))),
                'fixed_torso_tested_pixels':body_delta.size,'fixed_torso_changed_pixels':int(np.count_nonzero(body_delta))}
        if args.compare:
            prior=Image.open(Path(args.compare)/(name+'.png')).convert('RGB')
            record['saved_reload_viewport_changed_pixels']=int(np.count_nonzero(np.any(np.array(prior.crop(VIEWPORT))!=np.array(shot.crop(VIEWPORT)),axis=2)))
            if record['saved_reload_viewport_changed_pixels']:raise ValueError('Saved/reloaded viewport differs: '+name)
        records.append(record)
        thumb=Image.new('RGB',(338,248),'#f4f0f8');thumb.paste(shot.crop(face),(0,28));ImageDraw.Draw(thumb).text((8,8),name,fill='#302a42');thumbs.append(thumb)
    sheet=Image.new('RGB',(338*5,248*((len(thumbs)+4)//5)),'white')
    for i,thumb in enumerate(thumbs):sheet.paste(thumb,((i%5)*338,(i//5)*248))
    sheet.save(output/'official-motion-comparison.png')
    # Full viewport equality checks include the face, not the changing controls.
    # Identical generated/saved poses are mandatory; naturalness is separate.
    if any(r['fixed_torso_changed_pixels'] for r in records):raise ValueError('Fixed torso ROI moved.')
    if any(r['changed_viewport_pixels']==0 for r in records if r['name'] not in ('neutral','neutral_return')):raise ValueError('An exercised pose produced no model change.')
    if records[-1]['changed_viewport_pixels']:raise ValueError('Neutral return differs from original.')
    report={'official_creator_version':'0.8.6','model':str(Path(args.model).resolve()),'model_sha256':hashlib.sha256(Path(args.model).read_bytes()).hexdigest(),
            'calibration':{'method':'native-size eye template','score':score,'origin':origin,'viewport':VIEWPORT,'torso_roi':body,'neck_roi':neck},
            'poses':records,'control_values_verified':True,'saved_reload_compared':bool(args.compare),'appearance_quality_passed':False}
    (output/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for k in ['input','model','output','xdotool']:p.add_argument('--'+k,required=True)
    p.add_argument('--display',default=':94');p.add_argument('--input-delay-scale',type=float,default=2.5);p.add_argument('--compare');p.add_argument('--neutral-only',action='store_true');audit(p.parse_args())
