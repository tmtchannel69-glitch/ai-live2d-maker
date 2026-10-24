"""Independent CPU comparison of actual serialized head/neck/body bindings.

Not official SDK evidence and not a naturalness score. Saves only to a new
private directory. The fixed torso and interior neck bridge are inspected.
"""
import argparse
import importlib.util
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('rig_renderer',Path(__file__).with_name('render-diagnostic.py'))
renderer=importlib.util.module_from_spec(spec);spec.loader.exec_module(renderer)
POSES=[('neutral',0,0),('shift_left',-1,0),('shift_right',1,0),('tilt_left',0,-1),
       ('tilt_right',0,1),('combined_left',-1,-1),('combined_right',1,1),
       ('opposed_left',-1,1),('opposed_right',1,-1),('neutral_return',0,0)]


def run(args):
    output=Path(args.output).resolve()
    if output.is_relative_to(ROOT) or output.exists():raise ValueError('Use a new private comparison directory.')
    output.mkdir(parents=True)
    graph=json.loads(Path(args.common).read_text());size=(graph['source']['width'],graph['source']['height'])
    q=graph['motions']['independent_head'];jaw=q['jaw'];fw=jaw['x_scale'];cx=jaw['center_x'];cy=jaw['center_y'];collar=q['collar_y']
    roi=(0,0,*size)
    seam=(round(cx-fw*.075),round(cy-8),round(cx+fw*.075),round(collar+3))
    torso=tuple(q['fixed_torso_roi'])
    if torso[3]<=torso[1]:raise ValueError('Visible torso region is too small for a fixed-body audit.')
    loaded={name:renderer.module.load(Path(path))[:2] for name,path in [('before',args.baseline),('after',args.model)]}
    records=[];neutrals={};sheet=Image.new('RGB',(5*390,2*280),'#c7c7c7');draw=ImageDraw.Draw(sheet)
    for column,(label,head,tilt) in enumerate(POSES):
        frames={}
        for version,(model,textures) in loaded.items():
            image,layers=renderer.render(model,textures,size,roi,{'HeadX':head,'HeadTilt':tilt})
            if column==0:neutrals[version]=image
            Image.fromarray(image).save(output/f'{version}-{label}.png');frames[version]=image
            thumb=Image.fromarray(image);thumb.thumbnail((190,240))
            x=(column%5)*390+(0 if version=='before' else 195);y=(column//5)*280
            draw.text((x+4,y+5),version+' '+label,fill='black');sheet.paste(thumb,(x+4,y+25),thumb)
        current=frames['after'];neutral=neutrals['after'];x0,y0,x1,y1=seam;a=current[y0:y1,x0:x1,3]
        expected=neutral[y0:y1,x0:x1,3]>=250
        if int(expected.sum())<100:raise ValueError('Neck audit has insufficient near-opaque source tissue.')
        x0,y0,x1,y1=torso
        record={'pose':label,'head_x':head,'head_tilt':tilt,
            'neck_bridge_tested_pixels':int(expected.sum()),
            'neck_bridge_transparent_pixels':int((expected&(a<240)).sum()),
            'fixed_torso_changed_pixels':int(np.any(current[y0:y1,x0:x1]!=neutral[y0:y1,x0:x1],axis=2).sum()),
            'changed_pixels':int(np.any(current!=neutral,axis=2).sum())}
        records.append(record)
    sheet.save(output/'head-before-after.png')
    # Native-sized neck detail exposes seams hidden by whole-character thumbs.
    bounds=(round(cx-fw*.16),round(cy-35),round(cx+fw*.16),round(collar+25))
    detail=Image.new('RGB',(5*340,2*190),'#c7c7c7');dd=ImageDraw.Draw(detail)
    for i,name in enumerate(['neutral','shift_left','shift_right','tilt_left','tilt_right']):
        for j,version in enumerate(['before','after']):
            im=Image.open(output/f'{version}-{name}.png').crop(bounds)
            im.thumbnail((330,155));bg=Image.new('RGBA',im.size,'#42aa77');bg.alpha_composite(im)
            detail.paste(bg.convert('RGB'),(i*340+4,j*190+27));dd.text((i*340+4,j*190+5),version+' '+name,fill='black')
    detail.save(output/'neck-before-after.png')
    neutral=np.abs(neutrals['before'].astype(int)-neutrals['after'].astype(int))
    report={'format':'ai-live2d-maker-independent-head-cpu-diagnostic','source_size':size,
        'neutral_before_after_changed_pixels':int(np.any(neutral,axis=2).sum()),'neutral_max_channel_delta':int(neutral.max()),
        'neck_bridge_roi':seam,'fixed_torso_roi':torso,'poses':records,
        'official_runtime_evidence':False,'appearance_quality_passed':False}
    (output/'head-quality-report.json').write_text(json.dumps(report,indent=2))
    if any(r['neck_bridge_transparent_pixels'] or r['fixed_torso_changed_pixels'] for r in records):
        raise ValueError('Independent head diagnostic found an interior hole or moving torso; inspect private evidence.')
    print(json.dumps(report))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['model','baseline','common','output']:p.add_argument('--'+key,required=True)
    run(p.parse_args())
