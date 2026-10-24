"""Analyze real official screenshots for independent controls and reference RGB.

This reads evidence, never paints a replacement frame or validates a renderer
as the official runtime. Reference comparison must use equal camera/viewport.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageOps

ROOT=Path(__file__).resolve().parents[2]

def analyze(evidence,output,reference=None):
    evidence=Path(evidence).resolve();output=Path(output).resolve()
    if output.is_relative_to(ROOT) or output.exists():raise ValueError('Use a new private report file.')
    data=json.loads((evidence/'report.json').read_text());ox,oy=data['calibration']['origin'];viewport=data['calibration']['viewport']
    neutral=Image.open(evidence/'neutral.png').convert('RGB')
    def roi(b):return tuple(round(v+(ox if i%2==0 else oy)) for i,v in enumerate(b))
    eye_l=data['calibration'].get('eye_rois',{}).get('l',roi((398,310,526,398)));eye_r=data['calibration'].get('eye_rois',{}).get('r',roi((242,310,370,398)));mouth=data['calibration'].get('mouth_roi',roi((347,441,421,481)));results=[]
    for pose in data['poses']:
        name=pose['name'];frame=Image.open(evidence/(name+'.png')).convert('RGB');checks={}
        if name in ('left_closed','left_half'):checks['opposite_eye_changed_pixels']=int(np.count_nonzero(np.any(np.array(frame.crop(eye_r))!=np.array(neutral.crop(eye_r)),axis=2)))
        if name in ('right_closed','right_half'):checks['opposite_eye_changed_pixels']=int(np.count_nonzero(np.any(np.array(frame.crop(eye_l))!=np.array(neutral.crop(eye_l)),axis=2)))
        if name.startswith('mouth_'):
            checks['eyes_changed_pixels']=sum(int(np.count_nonzero(np.any(np.array(frame.crop(r))!=np.array(neutral.crop(r)),axis=2))) for r in [eye_l,eye_r])
        if name.startswith('blink_') or name in ('left_closed','right_closed','both_closed','left_half','right_half'):
            checks['mouth_changed_pixels']=int(np.count_nonzero(np.any(np.array(frame.crop(mouth))!=np.array(neutral.crop(mouth)),axis=2)))
        results.append({'pose':name,**checks})
    report={'official_screenshot_control_checks':results,'independent_eye_mouth_checks_passed':all(all(v==0 for k,v in r.items() if k!='pose') for r in results),'appearance_quality_passed':False}
    selected=['neutral','left_closed','both_closed','mouth_1','HeadTilt_1','combined_left']
    if all((evidence/(name+'.png')).is_file() for name in selected):
        sheet=Image.new('RGB',(338*3,248*2),'white');face=data['calibration'].get('face_roi',roi((215,275,553,495)));draw=ImageDraw.Draw(sheet)
        for i,name in enumerate(selected):
            x=(i%3)*338;y=(i//3)*248;tile=ImageOps.contain(Image.open(evidence/(name+'.png')).crop(face),(338,220));sheet.paste(tile,(x+(338-tile.width)//2,y+28+(220-tile.height)//2));draw.text((x+8,y+8),name,fill='black')
        sheet.save(output.with_name(output.stem+'-motions.png'))
    if reference:
        ref=Path(reference).resolve();refdata=json.loads((ref/'report.json').read_text())
        if data['calibration']['origin']!=refdata['calibration']['origin'] or viewport!=refdata['calibration']['viewport']:raise ValueError('Reference camera differs.')
        a=np.array(neutral.crop(viewport)).astype(int);b=np.array(Image.open(ref/'neutral.png').convert('RGB').crop(viewport)).astype(int);delta=np.abs(a-b)
        report['neutral_original_preview_official_runtime_comparison']={'method':'same-camera original assembled PNG rendered by official Creator vs articulated model',
          'pixels':delta.shape[0]*delta.shape[1],'changed_pixels':int(np.count_nonzero(np.any(delta,axis=2))),'rgb_above_3_pixels':int(np.count_nonzero(np.any(delta>3,axis=2))),
          'maximum_channel_difference':int(delta.max()),'mean_channel_difference':float(delta.mean()),'exact_pixel_match':bool(not delta.any())}
        sheet=Image.new('RGB',((viewport[2]-viewport[0])*2,viewport[3]-viewport[1]+28),'white')
        sheet.paste(Image.open(ref/'neutral.png').crop(viewport),(0,28));sheet.paste(neutral.crop(viewport),(viewport[2]-viewport[0],28))
        draw=ImageDraw.Draw(sheet);draw.text((8,8),'Original assembled preview / official runtime',fill='black');draw.text((viewport[2]-viewport[0]+8,8),'33-part articulated model / official runtime',fill='black')
        sheet.save(output.with_suffix('.png'))
    output.write_text(json.dumps(report,indent=2));print(json.dumps(report))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--evidence',required=True);p.add_argument('--output',required=True);p.add_argument('--reference');a=p.parse_args();analyze(a.evidence,a.output,a.reference)
