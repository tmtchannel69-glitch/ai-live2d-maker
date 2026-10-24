"""Check hierarchy/meshes/masks/bindings after an official save, independently.

Pairs nodes by name, permits float32 serialization roundoff, and reports no
runtime/naturalness approval. Texture equality is checked by the existing
check-creator-save.py separately. Images/models remain outside Git.
"""
import argparse
import importlib.util
import json
from pathlib import Path

import numpy as np

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('container_reader',Path(__file__).with_name('check-creator-save.py'))
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)


def equivalent(before,after):
    def index(model):
        nodes={};parents={}
        def visit(n,ancestry=()):
            if n['name'] in nodes:raise ValueError('Duplicate node name in structural audit.')
            nodes[n['name']]=n;parents[n['name']]=ancestry
            for child in n.get('children',[]):visit(child,ancestry+(n['name'],))
        visit(model['nodes'])
        return nodes,parents,{n['uuid']:name for name,n in nodes.items()}
    a,ap,ai=index(before);b,bp,bi=index(after);maximum=0.
    def numbers(x,y,label):
        nonlocal maximum
        x,y=np.asarray(x,float),np.asarray(y,float)
        if x.shape!=y.shape or not np.isfinite(x).all() or not np.isfinite(y).all():raise ValueError('Invalid numeric shape: '+label)
        difference=float(np.max(np.abs(x-y))) if x.size else 0.
        if difference>1e-4:raise ValueError('Saved numeric value differs: '+label)
        maximum=max(maximum,difference)
    relevant={name for name,n in a.items() if n['type'] in ('Part','SimplePhysics')}
    if relevant!={name for name,n in b.items() if n['type'] in ('Part','SimplePhysics')}:raise ValueError('Saved drawable/driver names differ.')
    ancestors=relevant|{p for name in relevant for p in ap[name]}
    for name in ancestors:
        if name not in b or ap[name]!=bp[name] or a[name]['type']!=b[name]['type']:raise ValueError('Saved parent hierarchy differs: '+name)
        for field in ('trans','rot','scale'):numbers(a[name]['transform'][field],b[name]['transform'][field],name+'/'+field)
    for name in relevant:
        x,y=a[name],b[name]
        if x['type']=='SimplePhysics':
            if x.get('enabled',True)!=y.get('enabled',True) or x.get('lockToRoot',False)!=y.get('lockToRoot',False):
                raise ValueError('Saved physics enable/anchor configuration differs.')
            for field in ('model_type','map_mode','local_only'):
                if x[field]!=y[field]:raise ValueError('Saved physics configuration differs: '+field)
            pa={p['uuid']:p['name'] for p in before['param']};pb={p['uuid']:p['name'] for p in after['param']}
            if pa.get(x['param']) is None or pb.get(y['param']) is None or pa[x['param']]!=pb[y['param']]:
                raise ValueError('Saved physics parameter target differs or is missing.')
            for field in ('gravity','length','frequency','angle_damping','length_damping','output_scale'):numbers(x[field],y[field],name+'/'+field)
            continue
        for field in ('verts','uvs','origin'):numbers(x['mesh'].get(field,[]),y['mesh'].get(field,[]),name+'/'+field)
        if x['mesh']['indices']!=y['mesh']['indices']:raise ValueError('Saved triangles differ: '+name)
        masks=lambda n,ids:sorted((ids[m['source']],m['mode']) for m in n.get('masks',[]))
        if masks(x,ai)!=masks(y,bi):raise ValueError('Saved mask sources differ: '+name)
        for field in ('mask_threshold','opacity','zsort','tint','screenTint'):numbers(x.get(field,0),y.get(field,0),name+'/'+field)
    pa={p['name']:p for p in before['param']};pb={p['name']:p for p in after['param']}
    if set(pa)!=set(pb):raise ValueError('Saved parameter names differ.')
    count=0
    for name,p in pa.items():
        q=pb[name]
        if p['is_vec2']!=q['is_vec2']:raise ValueError('Saved parameter dimension differs.')
        for field in ('min','max','defaults'):numbers(p[field],q[field],name+'/'+field)
        for i in range(2):numbers(p['axis_points'][i],q['axis_points'][i],name+'/axis')
        bindings=lambda p,ids:{(ids[v['node']],v['param_name']):v for v in p['bindings']}
        x,y=bindings(p,ai),bindings(q,bi)
        if set(x)!=set(y):raise ValueError('Saved binding targets differ: '+name)
        for key,v in x.items():
            if v['interpolate_mode']!=y[key]['interpolate_mode'] or v['isSet']!=y[key]['isSet']:raise ValueError('Saved binding interpolation/key availability differs.')
            numbers(v['values'],y[key]['values'],name+'/'+str(key));count+=1
    return {'hierarchy_mesh_masks_bindings_retained':True,'drawables_and_drivers':len(relevant),
        'parameters':len(pa),'bindings':count,'maximum_numeric_roundtrip_delta':maximum,
        'float_tolerance':1e-4,'runtime_validation':False,'appearance_quality_passed':False}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['generated','saved','output']:p.add_argument('--'+key,required=True)
    args=p.parse_args();out=Path(args.output).resolve()
    if out.is_relative_to(ROOT) or out.exists():raise ValueError('Use a new private report path.')
    result=equivalent(reader.load(Path(args.generated))[0],reader.load(Path(args.saved))[0])
    out.write_text(json.dumps(result,indent=2));print(json.dumps(result))
