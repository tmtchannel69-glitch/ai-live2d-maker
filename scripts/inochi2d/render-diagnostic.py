"""Small ROI renderer for this generated Normal/stencil subset, not official SDK.

Reads the actual container and evaluates its serialized bindings. Independent
pixel rasterization is used for defect candidates; official Creator remains
the acceptance test. No network requests, GPU or source-code evaluation.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

import cv2
import numpy as np
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from server.parts_quality import inspect_frame
loader=importlib.util.spec_from_file_location('saved_inspector',Path(__file__).with_name('check-creator-save.py'))
module=importlib.util.module_from_spec(loader);loader.loader.exec_module(module)


def interpolate(param, binding, raw):
    axis=np.array(param['axis_points'][0]);t=(raw-param['min'][0])/(param['max'][0]-param['min'][0])
    t=float(np.clip(t,axis[0],axis[-1]));i=int(np.clip(np.searchsorted(axis,t),1,len(axis)-1));u=(t-axis[i-1])/(axis[i]-axis[i-1])
    a=np.array(binding['values'][i-1][0],float);b=np.array(binding['values'][i][0],float)
    return a+(b-a)*u


def states(model, values):
    result={}
    def visit(n,parent=None):
        result[n['uuid']]={'node':n,'parent':parent,'trans':np.array(n['transform']['trans'][:2],float),
            'angle':n['transform']['rot'][2],'scale':np.array(n['transform']['scale'][:2],float),'opacity':n.get('opacity',1),
            'deform':np.zeros((len(n.get('mesh',{}).get('verts',[]))//2,2),float)}
        for c in n.get('children',[]):visit(c,n['uuid'])
    visit(model['nodes'])
    for p in model['param']:
        raw=values.get(p['name'],p['defaults'][0])
        for b in p['bindings']:
            s=result[b['node']];v=interpolate(p,b,raw);field=b['param_name']
            if field=='opacity':s['opacity']*=float(v)
            elif field=='deform':s['deform']+=v
            elif field.startswith('transform.t.'):s['trans']['xy'.index(field[-1])]+=float(v)
            elif field=='transform.r.z':s['angle']+=float(v)
            elif field.startswith('transform.s.'):s['scale']['xy'.index(field[-1])]*=float(v)
            else:raise ValueError('Unsupported diagnostic binding: '+field)
    def world(s):
        if 'world' in s:return s['world']
        c=np.cos(s['angle']);n=np.sin(s['angle']);sx,sy=s['scale'];tx,ty=s['trans']
        m=np.array([[c*sx,-n*sy,tx],[n*sx,c*sy,ty],[0,0,1.]])
        s['world']=(world(result[s['parent']])@m) if s['parent'] else m
        return s['world']
    for s in result.values():world(s)
    return result


def raster(state, texture, source_size, roi):
    node=state['node'];mesh=node['mesh'];w,h=roi[2]-roi[0],roi[3]-roi[1]
    out=np.zeros((h,w,4),np.float32)
    vertices=np.array(mesh['verts'],float).reshape(-1,2)+state['deform']
    verts=np.column_stack((vertices,np.ones(len(vertices))))@state['world'].T
    verts=verts[:,:2]+np.array(source_size)/2-np.array(roi[:2])-.5
    uv=np.array(mesh['uvs'],float).reshape(-1,2)*np.array([texture.shape[1],texture.shape[0]])-.5
    for ids in np.array(mesh['indices']).reshape(-1,3):
        dest=verts[ids];lo=np.maximum(0,np.floor(dest.min(axis=0)).astype(int));hi=np.minimum([w-1,h-1],np.ceil(dest.max(axis=0)).astype(int))
        if np.any(hi<lo):continue
        a,b,c=dest;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den)<1e-9:continue
        yy,xx=np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
        v0=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
        v1=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;v2=1-v0-v1
        inside=(v0>=-1e-7)&(v1>=-1e-7)&(v2>=-1e-7)
        if not inside.any():continue
        coords=v0[:,:,None]*uv[ids[0]]+v1[:,:,None]*uv[ids[1]]+v2[:,:,None]*uv[ids[2]]
        sampled=cv2.remap(texture,coords[:,:,0].astype(np.float32),coords[:,:,1].astype(np.float32),cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
        tile=out[lo[1]:hi[1]+1,lo[0]:hi[0]+1];tile[inside]=sampled[inside]/255
    return out


def render(model,textures,source_size,roi,values):
    evaluated=states(model,values);cache={}
    def raw(s):
        if s['node']['uuid'] not in cache:cache[s['node']['uuid']]=raster(s,textures[s['node']['textures'][0]],source_size,roi)
        return cache[s['node']['uuid']]
    out=np.zeros((roi[3]-roi[1],roi[2]-roi[0],4),np.float32);layers={}
    parts=sorted([s for s in evaluated.values() if s['node']['type']=='Part' and s['node'].get('enabled',True)],key=lambda s:-s['node']['zsort'])
    for s in parts:
        if s['opacity']<=0:continue
        node=s['node']
        if node.get('blend_mode','Normal')!='Normal':raise ValueError('Unsupported diagnostic blend mode.')
        rgba=raw(s).copy()*s['opacity']
        masks=node.get('masks',[])
        if masks:
            normal=[m for m in masks if m['mode']=='Mask'];clip=np.zeros(out.shape[:2],bool) if normal else np.ones(out.shape[:2],bool)
            for m in masks:
                mask=raw(evaluated[m['source']])[:,:,3]>=.5
                if m['mode']=='Mask':clip|=mask
                else:clip &= ~mask
            rgba[~clip]=0
        layers[node['name']]=rgba
        out[:,:,:3]=rgba[:,:,:3]+out[:,:,:3]*(1-rgba[:,:,3:4]);out[:,:,3]=rgba[:,:,3]+out[:,:,3]*(1-rgba[:,:,3])
    straight=np.zeros(out.shape,np.uint8);visible=out[:,:,3]>0
    straight[visible,:3]=np.rint(np.clip(out[visible,:3]/out[visible,3,None]*255,0,255)).astype(np.uint8)
    straight[:,:,3]=np.rint(np.clip(out[:,:,3]*255,0,255)).astype(np.uint8)
    return straight,layers


def audit(model_path,common_path,output):
    output=Path(output).resolve()
    if output.is_relative_to(ROOT) or output.exists():raise ValueError('Use a new private diagnostic directory.')
    output.mkdir(parents=True)
    model,textures,_,_=module.load(Path(model_path));graph=json.loads(Path(common_path).read_text());source=(graph['source']['width'],graph['source']['height'])
    boxes=[graph['motions']['blink'][s]['box_xywh'] for s in ('l','r')]
    roi=[max(0,min(b[0] for b in boxes)-8),max(0,min(b[1] for b in boxes)-12),min(source[0],max(b[0]+b[2] for b in boxes)+8),min(source[1],max(b[1]+b[3] for b in boxes)+12)]
    expected=np.zeros((roi[3]-roi[1],roi[2]-roi[0]),bool)
    iris_area=np.zeros(expected.shape,bool);core_window=np.zeros(expected.shape,bool)
    hues=[]
    for p in graph['parts']:
        if p['side'] and p['observed']['mask']:
            x,y,w,h=p['source_box_xywh'];mask=np.array(Image.open(Path(common_path).parent/p['observed']['mask']))>0
            expected[y-roi[1]:y-roi[1]+h,x-roi[0]:x-roi[0]+w] |= mask
            if p['role'] in ('iris','pupil','highlight'):
                iris_area[y-roi[1]:y-roi[1]+h,x-roi[0]:x-roi[0]+w] |= mask
    yy,xx=np.indices(expected.shape)
    for side in ('l','r'):
        g=graph['motions']['blink'][side];hues.append(g['measured_iris_hue']);x,y,_,_=g['box_xywh'];cx,cy=g['iris_center'];rx,ry=g['iris_radii']
        core_window |= (np.abs(xx-(x+cx-roi[0]))<rx*.8)
    records=[];frames=[]
    for opening in [0,.025,.05,.075,.1,.15,.25,.5,.75,1]:
        rgba,layers=render(model,textures,source,roi,{'EyeOpenL':opening,'EyeOpenR':opening})
        lash=np.zeros(expected.shape,np.float32)
        for name,a in layers.items():
            if 'lash' in name or 'closed' in name:lash=1-(1-lash)*(1-a[:,:,3])
        # Eye-white contribution includes the stationary iris in both trial
        # models. At raw zero it must be exactly absent.
        contribution=np.maximum(layers.get('eye_white_l',np.zeros(rgba.shape))[:,:,3],layers.get('eye_white_r',np.zeros(rgba.shape))[:,:,3])
        record=inspect_frame(rgba,opening=opening,expected_opaque=expected,iris_contribution=contribution,
            lash_alpha=lash,iris_hues=hues,iris_area=iris_area)
        core=inspect_frame(rgba,opening=opening,expected_opaque=expected,lash_alpha=lash,lash_window=core_window)
        record['central_iris_double_lash_columns']=core['double_lash_columns']
        record['central_lash_core_coverage']=core['lash_core_coverage']
        if core['lash_core_coverage']['weak_columns']>3 and .25<opening<.9:
            record['warnings'].append({'kind':'possible-washed-lash-core','columns':core['lash_core_coverage']['weak_columns']})
        records.append(record);im=Image.fromarray(rgba);im.save(output/f'blink_{len(records)-1:02d}.png');frames.append(im)
    contact=Image.new('RGB',(5*(roi[2]-roi[0]),2*(roi[3]-roi[1]+25)),'#ddd');draw=ImageDraw.Draw(contact)
    for i,(im,r) in enumerate(zip(frames,records)):
        x=i%5*im.width;y=i//5*(im.height+25);draw.text((x+5,y+3),str(r['opening']),fill='black');contact.paste(im,(x,y+25),im)
    contact.save(output/'blink-contact.png')
    report={'source':'independent ROI renderer of actual serialized model','official_runtime':False,'source_roi':roi,'frames':records,
        'appearance_quality_passed':False,'notes':['Candidate metrics do not certify appearance. The eye-white mask bounds iris contribution; it does not identify individual RGB pixels as iris.']}
    (output/'quality-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('model','common','output'):parser.add_argument('--'+name,required=True)
    a=parser.parse_args();audit(a.model,a.common,a.output)
