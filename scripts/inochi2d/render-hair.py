"""Serialized static-key hair diagnostic; native physics needs official runtime.

Checks source reconstruction, interior holes, a measured fixed-body region and
every independent strand at both extremes. Saves real frames and difference
maps, not an appearance approval. No network or manual rigging coordinates.
"""
import argparse
import importlib.util
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('hair_renderer',Path(__file__).with_name('render-diagnostic.py'))
renderer=importlib.util.module_from_spec(spec);spec.loader.exec_module(renderer)


def flatten(n):return [n]+[v for child in n.get('children',[]) for v in flatten(child)]


def run(args):
    output=Path(args.output).resolve()
    if output.is_relative_to(ROOT) or output.exists():raise ValueError('Use a new private diagnostic directory.')
    output.mkdir(parents=True)
    model,textures,_,_=renderer.module.load(Path(args.model));base,base_textures,_,_=renderer.module.load(Path(args.baseline))
    if any(n['type']=='SimplePhysics' for n in flatten(model['nodes'])):
        raise ValueError('Use static-key model here; independent CPU diagnostics do not execute official physics.')
    graph=json.loads(Path(args.common).read_text());source=(graph['source']['width'],graph['source']['height']);roi=(0,0,*source)
    parameters=[p['name'] for p in model['param'] if p['name'].startswith('HairSway')]
    if not parameters:raise ValueError('No independent strand controls.')
    torso=graph['motions']['independent_head']['fixed_torso_roi'];x0,y0,x1,y1=torso
    baseline={};neutral,_=renderer.render(model,textures,source,roi,{})
    poses=[('neutral',{})]
    for name in parameters:poses += [(name+'_left',{name:-1}),(name+'_right',{name:1})]
    poses += [('all_left',{p:-1 for p in parameters}),('all_right',{p:1 for p in parameters}),
              ('head_left_hair_right',{'HeadX':-1,'HeadTilt':-1,**{p:1 for p in parameters}}),
              ('head_right_hair_left',{'HeadX':1,'HeadTilt':1,**{p:-1 for p in parameters}}),
              ('closed_hair_left',{'EyeOpenL':0,'EyeOpenR':0,**{p:-1 for p in parameters}}),('neutral_return',{})]
    records=[];sheet=Image.new('RGB',(5*250,((len(poses)+4)//5)*350),'#c7c7c7');draw=ImageDraw.Draw(sheet)
    for i,(label,values) in enumerate(poses):
        # Eyes/head are compared at the same state; visible silhouette movement
        # is not confused with an internal hair cut opening a hole.
        base_values={k:v for k,v in values.items() if not k.startswith('HairSway')};key=tuple(sorted(base_values.items()))
        if key not in baseline:baseline[key]=renderer.render(base,base_textures,source,roi,base_values)[0]
        reference=baseline[key];expected=cv2.erode((reference[:,:,3]>=250).astype(np.uint8),np.ones((7,7),np.uint8)).astype(bool)
        frame,_=renderer.render(model,textures,source,roi,values)
        Image.fromarray(frame).save(output/(label+'.png'))
        changed=np.any(frame!=reference,axis=2)
        record={'pose':label,'values':values,'interior_tested_pixels':int(expected.sum()),
            'interior_hole_candidates':int((expected&(frame[:,:,3]<240)).sum()),
            'fixed_torso_changed_pixels':int(np.any(frame[y0:y1,x0:x1]!=neutral[y0:y1,x0:x1],axis=2).sum()),
            'changed_pixels_from_same_head_eye_state':int(changed.sum())}
        if label=='neutral':
            record['neutral_max_channel_delta']=int(np.abs(frame.astype(int)-reference.astype(int)).max())
        records.append(record)
        thumb=Image.fromarray(frame);thumb.thumbnail((240,300));x,y=i%5*250,i//5*350
        draw.text((x+4,y+5),label,fill='black');sheet.paste(thumb,(x+4,y+30),thumb)
        # Contrast map reports the location of measured changes; no source
        # artwork is replaced and a bright map is not a naturalness judgement.
        difference=np.zeros(frame.shape,np.uint8);difference[changed]=[235,40,170,255]
        Image.fromarray(difference).save(output/(label+'-difference.png'))
    sheet.save(output/'hair-states-contact.png')
    neutral_record=records[0]
    result={'format':'ai-live2d-maker-static-strand-cpu-diagnostic','strand_controls':parameters,'poses':records,
        'neutral_changed_pixels':neutral_record['changed_pixels_from_same_head_eye_state'],
        'maximum_hole_candidates':max(p['interior_hole_candidates'] for p in records),
        'maximum_torso_change':max(p['fixed_torso_changed_pixels'] for p in records),
        'official_runtime':False,'physics_executed':False,'appearance_quality_passed':False}
    (output/'hair-quality-report.json').write_text(json.dumps(result,indent=2))
    if result['neutral_changed_pixels'] or result['maximum_hole_candidates'] or result['maximum_torso_change']:
        raise ValueError('Hair diagnostics found neutral differences, interior holes or moving torso; inspect private frames.')
    if any(p['changed_pixels_from_same_head_eye_state']==0 for p in records if p['pose'].startswith('HairSway')):
        raise ValueError('A strand control had no visible effect; do not count parameter presence as rigging success.')
    print(json.dumps(result))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['model','baseline','common','output']:p.add_argument('--'+key,required=True)
    run(p.parse_args())
