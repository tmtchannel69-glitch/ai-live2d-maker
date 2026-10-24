"""Independent serialized-mesh diagnostics; official Creator is tested separately.

Reuses the existing bounded INP loader and Normal/stencil rasterizer. No model
or artwork changes. Output must be a new private directory outside Git.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import time
import numpy as np
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('diagnostic',ROOT/'scripts/inochi2d/render-diagnostic.py')
diag=importlib.util.module_from_spec(spec);spec.loader.exec_module(diag)

def audit(folder,output):
    folder=Path(folder).resolve();output=Path(output).resolve()
    if output.is_relative_to(ROOT) or output.exists():raise ValueError('Use a new private output directory.')
    model,textures,_,_=diag.module.load(folder/'character.inp')
    manifest=json.loads((folder/'character_manifest.json').read_text())
    preview=np.array(Image.open(folder/'preview.png').convert('RGBA'))
    output.mkdir(mode=0o700)
    poses=[('neutral',{}),('left_closed',{'EyeOpenL':0}),('right_closed',{'EyeOpenR':0}),('both_closed',{'EyeOpenL':0,'EyeOpenR':0})]
    for v in [.025,.075,.15,.25,.5,.75]:poses.append((f'blink_{v:g}',{'EyeOpenL':v,'EyeOpenR':v}))
    for v in [.075,.15,.25,.5,1]:poses.append((f'mouth_{v:g}',{'MouthOpen':v}))
    for name in ['HeadX','HeadY','HeadTilt']:
        for v in [-1,1]:poses.append((f'{name}_{v}',{name:v}))
    poses += [('combined_left',{'EyeOpenL':0,'MouthOpen':1,'HeadX':-1,'HeadY':1,'HeadTilt':-1}),
              ('combined_right',{'EyeOpenR':0,'MouthOpen':.5,'HeadX':1,'HeadY':-1,'HeadTilt':1}),('neutral_return',{})]
    baseline=None;records=[];started=time.monotonic();thumbs=[]
    neck_box=(360,550,408,585);eye_box=(236,310,532,406)
    if manifest['version']==2:
        g=manifest['rig_geometry'];neck_box=(round(g['head_pivot'][0]-24),round(g['neck_follow_y']+3),round(g['head_pivot'][0]+24),round(g['neck_fixed_y']-3))
        q=[p['rect'] for p in manifest['parts'] if p['parent'].startswith('group_eye')];eye_box=(min(p['x'] for p in q),min(p['y'] for p in q),max(p['x']+p['width'] for p in q),max(p['y']+p['height'] for p in q))
    eye_boxes={s:manifest['parts'][next(i for i,p in enumerate(manifest['parts']) if p['role']=='eye_white_'+s)]['rect'] for s in ['l','r']}
    for name,values in poses:
        frame,layers=diag.render(model,textures,(768,1024),(0,0,768,1024),values)
        if baseline is None:baseline=frame.copy()
        Image.fromarray(frame).save(output/(name+'.png'))
        torso=frame[805:980,342:426];neck=frame[neck_box[1]:neck_box[3],neck_box[0]:neck_box[2]]
        record={'name':name,'requested':values,'fixed_torso_changed_pixels':int(np.count_nonzero(np.any(torso!=baseline[805:980,342:426],axis=2))),
            'neck_tested_pixels':neck.shape[0]*neck.shape[1],'neck_alpha_below_250':int(np.count_nonzero(neck[:,:,3]<250)),
            'iris_contributing_pixels':{s:int(np.count_nonzero(layers.get('iris_'+s,np.zeros((1,1,4)))[:,:,3]>0)) for s in ['l','r']}}
        folded=0
        for s in diag.states(model,values).values():
            if s['node']['type']!='Part':continue
            mesh=s['node']['mesh'];v=np.array(mesh['verts']).reshape(-1,2)+s['deform'];q=v[np.array(mesh['indices']).reshape(-1,3)]
            cross=(q[:,1,0]-q[:,0,0])*(q[:,2,1]-q[:,0,1])-(q[:,1,1]-q[:,0,1])*(q[:,2,0]-q[:,0,0]);folded+=int(np.count_nonzero(cross < -1e-7))
        record['folded_mesh_triangles']=folded
        if name.startswith('mouth_'):
            record['eyes_changed_pixels']=int(np.count_nonzero(np.any(frame[eye_box[1]:eye_box[3],eye_box[0]:eye_box[2]]!=baseline[eye_box[1]:eye_box[3],eye_box[0]:eye_box[2]],axis=2)))
        if name=='left_closed':
            q=eye_boxes['r'];record['opposite_eye_changed_pixels']=int(np.count_nonzero(np.any(frame[q['y']:q['y']+q['height'],q['x']:q['x']+q['width']]!=baseline[q['y']:q['y']+q['height'],q['x']:q['x']+q['width']],axis=2)))
        if name=='right_closed':
            q=eye_boxes['l'];record['opposite_eye_changed_pixels']=int(np.count_nonzero(np.any(frame[q['y']:q['y']+q['height'],q['x']:q['x']+q['width']]!=baseline[q['y']:q['y']+q['height'],q['x']:q['x']+q['width']],axis=2)))
        records.append(record)
        thumb=Image.new('RGB',(256,282),'#f4f0f8');picture=Image.fromarray(frame).crop((204,264,564,510)).resize((256,175));thumb.paste(picture,(0,30),picture.getchannel('A'));ImageDraw.Draw(thumb).text((8,8),name,fill='#302a42');thumbs.append(thumb)
    sheet=Image.new('RGB',(256*6,282*((len(thumbs)+5)//6)),'white')
    for i,thumb in enumerate(thumbs):sheet.paste(thumb,((i%6)*256,(i//6)*282))
    sheet.save(output/'motion-comparison.png')
    # Compare over an identical white background; low-alpha RGB roundoff is
    # not counted as opaque skin/line damage. Browser and GPU filtering still
    # need their own comparison, separate from this CPU implementation.
    def matte(a):
        if manifest['background']=='lavender':return np.rint(a[:,:,:3]*(a[:,:,3:4]/255)+np.array([238,234,247])*(255-a[:,:,3:4])/255).astype(np.uint8)
        return np.rint(a[:,:,:3]*(a[:,:,3:4]/255)+255-a[:,:,3:4]).astype(np.uint8)
    delta=np.abs(matte(baseline).astype(int)-matte(preview).astype(int))
    report={'format':'generated-character-inochi-cpu-audit','version':1,'model_sha256':hashlib.sha256((folder/'character.inp').read_bytes()).hexdigest(),'preview_sha256':hashlib.sha256((folder/'preview.png').read_bytes()).hexdigest(),'states':records,'seconds':round(time.monotonic()-started,3),
        'neutral_comparison':{'background':'lavender' if manifest['background']=='lavender' else 'white','changed_pixels':int(np.count_nonzero(np.any(delta,axis=2))),'rgb_above_3_pixels':int(np.count_nonzero(np.any(delta>3,axis=2))),'maximum_channel_difference':int(delta.max()),'mean_channel_difference':float(delta.mean())},
        'neck_test_roi':neck_box,'eye_test_roi':eye_box,'native_runtime_tested_by_this_renderer':False,'appearance_quality_passed':False}
    report['geometry_checks_passed']=all(r['fixed_torso_changed_pixels']==r['neck_alpha_below_250']==r['folded_mesh_triangles']==0 and r.get('opposite_eye_changed_pixels',0)==0 and r.get('eyes_changed_pixels',0)==0 for r in records)
    (output/'report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',required=True);p.add_argument('--output',required=True);a=p.parse_args();audit(a.input,a.output)
