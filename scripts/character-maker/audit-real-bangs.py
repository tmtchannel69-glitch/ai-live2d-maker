"""Local, independent checks of actual supplied/cleaned PNGs and serialized rig.
No AI calls, image repainting, model edits or third-party uploads.
"""
import argparse
import hashlib
import importlib.util
import itertools
import json
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('diagnostic',ROOT/'scripts/inochi2d/render-diagnostic.py');diag=importlib.util.module_from_spec(spec);spec.loader.exec_module(diag)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()

def audit(a):
    folder=Path(a.input).resolve();out=Path(a.output).resolve()
    if out.is_relative_to(ROOT) or out.exists():raise ValueError('Use a new private report outside Git.')
    manifest=json.loads((folder/'attached/character_manifest.json').read_text());index=json.loads((folder/'attached/maker_project.json').read_text());parts={p['role']:p for p in manifest['parts']}
    prep=next(p['origin']['import_preparation'] for p in index['parts'] if p['role']=='bangs_front')
    source=folder/'source-original.png';clean=folder/'review/source_alpha_cleaned.png';fitted=folder/'attached/parts/bangs_front.png'
    original=np.array(Image.open(source).convert('RGBA'));cleaned=np.array(Image.open(clean).convert('RGBA'));tile=np.array(Image.open(fitted).convert('RGBA'));strong=original[:,:,3]>=8
    strong_changed=int(np.count_nonzero(np.any(original[strong]!=cleaned[strong],axis=1)));removed=(original[:,:,3]>0)&(cleaned[:,:,3]==0)
    if strong_changed or int(removed.sum())!=prep['cleanup']['removed_low_alpha_pixels']:raise ValueError('Alpha-only cleanup changed strong pixels or its removal count differs.')
    if sha(source)!=prep['source_sha256'] or sha(fitted)!=prep['prepared_sha256']:raise ValueError('Supplied or fitted PNG hash differs.')
    if sha(source)!=sha(folder/'review/source_original.png'):raise ValueError('Review did not retain the exact supplied PNG.')
    model,textures,_,_=diag.module.load(folder/'attached/character.inp');neutral=diag.states(model,{})
    find=lambda states,name:next(s for s in states.values() if s['node']['name']==name)
    initial=None;max_error=0.;records=[]
    for x,y,tilt,breath in itertools.product([-1,0,1],[-1,0,1],[-1,0,1],[0,.5,1]):
        values={'HeadX':x,'HeadY':y,'HeadTilt':tilt,'Breath':breath};states=diag.states(model,values);positions=[]
        for role in ['face_base','bangs_front']:
            p=parts[role];point=np.array([384-p['anchor'][0],200-p['anchor'][1],1.]);positions.append((find(states,role)['world']@point)[:2])
        error=float(np.linalg.norm(positions[0]-positions[1]));max_error=max(error,max_error);records.append({'values':values,'shared_forehead_point_divergence_pixels':error})
    if max_error>1e-7:raise ValueError('Front hair and face did not follow the same head transform.')
    # Existing 24 CPU motion renders are produced by render-inochi.py. Add one
    # real native Breath=1 render so breathing is inspected separately as well.
    frame,layers=diag.render(model,textures,(768,1024),(0,0,768,1024),{'Breath':1})
    Image.fromarray(frame).save(out.with_name(out.stem+'-breath.png'))
    record={'format':'real-bangs-source-and-rig-audit','version':1,'source_sha256':sha(source),'model_sha256':sha(folder/'attached/character.inp'),
      'source_and_review_original_identical':True,'strong_source_pixels_tested':int(strong.sum()),'strong_rgba_pixels_changed_in_cleanup':strong_changed,'low_alpha_pixels_removed':int(removed.sum()),
      'fitted_size':[tile.shape[1],tile.shape[0]],'fitted_nonzero_border_pixels':int(np.count_nonzero(tile[[0,-1],:,3])+np.count_nonzero(tile[:,[0,-1],3])),
      'transform_states':len(records),'maximum_front_hair_face_anchor_divergence_pixels':max_error,'head_follow_checks_passed':True,'independent_native_breath_rendered':True,
      'scope':'An affine attachment point and transparent-border check, not a semantic/natural-seam test.','appearance_quality_passed':False,'official_runtime_tested_by_this_script':False,'poses':records}
    out.write_text(json.dumps(record,indent=2)+'\n');print(json.dumps({k:v for k,v in record.items() if k!='poses'}))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',required=True);p.add_argument('--output',required=True);audit(p.parse_args())
