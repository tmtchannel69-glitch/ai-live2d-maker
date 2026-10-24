"""Official Creator audit of each actual independent hair parameter.

Uses the Parameters search field to avoid guessing scroll positions. Records
the displayed parameter name/value, motion effect, neutral return and a fixed
body region. No manual rigging; generated files remain unchanged.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import time

import numpy as np
from PIL import Image,ImageDraw

from creator_ui import CreatorUI

ROOT=Path(__file__).resolve().parents[2]


def digest(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()


def run(args):
    output=Path(args.output).resolve()
    if output.is_relative_to(ROOT) or output.exists():raise ValueError('Use a new private audit directory.')
    output.mkdir(parents=True)
    layout=json.loads(Path(args.manifest).read_text());reference=json.loads(Path(args.reference).read_text())
    if digest(args.model)!=reference['model_sha256']:raise ValueError('Reference must audit this exact loaded model hash.')
    ui=CreatorUI(args.xdotool,args.display,args.model);viewport=tuple(reference['viewport_roi']);torso=tuple(reference['fixed_torso_roi'])
    ui.filter('');ui.pointer_away();time.sleep(.3);neutral=ui.snapshot();neutral.save(output/'neutral.png')
    records=[];sheet=Image.new('RGB',(3*310,len(layout['hair_rig']['strands'])*260),'#333333');draw=ImageDraw.Draw(sheet)
    for row,strand in enumerate(layout['hair_rig']['strands']):
        name=strand['parameter'];ui.filter(name)
        title_image=ui.snapshot();title=ui.text(title_image,(126,112,320,140))
        match=re.search(r'hairsway([0-9o]{2})',re.sub(r'\s','',title).lower())
        if not match or int(match[1].replace('o','0'))!=int(name[-2:]):
            title_image.save(output/(name+'-unverified-title.png'));raise ValueError('Could not verify filtered parameter title: '+repr(title))
        for column,value in enumerate([-1,0,1]):
            for attempt in range(3):
                ui.click(round(158+131*(value+1)/2),173,shift=True);ui.pointer_away();time.sleep(.2)
                image=ui.snapshot();displayed=ui.value(image,138)
                if abs(displayed-value)<.005:break
            else:raise ValueError('Hair control did not reach requested value.')
            filename=name+('-negative' if value<0 else '-positive' if value>0 else '-neutral')+'.png'
            image.save(output/filename)
            delta=np.any(np.array(image.crop(viewport))!=np.array(neutral.crop(viewport)),axis=2)
            body=int(np.any(np.array(image.crop(torso))!=np.array(neutral.crop(torso)),axis=2).sum())
            changed=int(delta.sum())
            if body:raise ValueError('Hair operation changed measured torso interior.')
            if value==0 and changed:raise ValueError('Hair control failed to return to identical neutral viewport.')
            if value!=0 and not changed:raise ValueError('Hair control had no actual official viewport effect.')
            record={'parameter':name,'title_ocr':title,'requested':value,'displayed':displayed,'viewport_changed_pixels':changed,'fixed_torso_changed_pixels':body}
            if args.compare:
                old=np.array(Image.open(Path(args.compare)/filename).crop(viewport));new=np.array(image.crop(viewport))
                record['previous_process_viewport_changed_pixels']=int(np.any(old!=new,axis=2).sum())
                if record['previous_process_viewport_changed_pixels']:raise ValueError('Saved/reloaded hair pose changed viewport.')
            records.append(record)
            im=image.crop(reference['face_roi']);im.thumbnail((300,220));x,y=column*310,row*260
            draw.text((x+5,y+5),name+f' {displayed:+.2f}',fill='white');sheet.paste(im,(x+5,y+30))
        # Leave this strand at its default before filtering the next one.
        ui.click(224,173,shift=True);ui.pointer_away();time.sleep(.15)
        if abs(ui.value(ui.snapshot(),138))>.005:raise ValueError('Could not reset strand.')
    ui.filter('');ui.pointer_away();time.sleep(.3)
    final=ui.snapshot();final.save(output/'neutral-return.png')
    if np.any(np.array(final.crop(viewport))!=np.array(neutral.crop(viewport))):raise ValueError('Full neutral return failed.')
    sheet.save(output/'official-hair-controls.png')
    report={'runtime':'official Inochi Creator 0.8.6','model_sha256':digest(args.model),'strand_count':len(layout['hair_rig']['strands']),
        'poses':records,'all_controls_had_visible_effect':True,'neutral_return_identical':True,
        'previous_process_identical':bool(args.compare),'source_reference_report':Path(args.reference).name,
        'manual_rigging':False,'appearance_quality_passed':False}
    (output/'hair-creator-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['model','manifest','reference','output','xdotool']:p.add_argument('--'+key,required=True)
    p.add_argument('--display',default=':94');p.add_argument('--compare');run(p.parse_args())
