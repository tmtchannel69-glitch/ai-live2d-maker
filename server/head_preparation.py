"""Opt-in semantic head/neck/body extension of the verified common parts.

No image-specific coordinates, manual prompts or external inference. The SAM
face candidate and measured jaw ink support the neck cut; unsupported input is
rejected rather than silently reverting to a whole-foreground head. Observed
RGBA and inferred underlaps retain separate provenance.
"""
from __future__ import annotations

import copy
from types import SimpleNamespace

import cv2
import numpy as np

from server.character_parts import add_part, decode_asset, reconstruct_observed, validate_graph
from server.hair_parts import bounded_texture_padding


def automatic_face(image, face):
    from server.engine import SamEngine
    x, y, fw, fh = face
    w, h = image.size
    prompt = SimpleNamespace(id='face-neck', box=[x/w, y/h, (x+fw)/w, (y+fh)/h],
        all_points=[SimpleNamespace(x=(x+u*fw)/w, y=(y+v*fh)/h, label=1)
                    for u, v in ((.5, .6), (.35, .55), (.65, .55))])
    return SamEngine().segment(image, [prompt])[0]


def measured_jaw(rgba, face_mask, face):
    """Fit the actual lower-jaw ink ridge, not a face-box horizontal crop."""
    x, y, fw, fh = face
    h, w = face_mask.shape
    lo, hi = max(4, round(y+fh*.70)), min(h-4, round(y+fh*.87))
    left, right = max(0, round(x+fw*.32)), min(w, round(x+fw*.68))
    if hi-lo < 8 or right-left < 12:
        raise ValueError('Visible jaw/neck evidence is too small for independent rigging.')
    rgb = rgba[:, :, :3].astype(float)
    gray = rgb.mean(axis=2)
    ridge = (gray[lo-3:hi-3]+gray[lo+3:hi+3])/2-gray[lo:hi]
    skin = ((rgb[lo:hi, :, 0]-rgb[lo:hi, :, 1]>5)
            & (rgb[lo:hi, :, 0]>95) & face_mask[lo:hi])
    score = np.where(skin, ridge, -1e6)
    xs = np.arange(left, right)
    ys = lo+score[:, left:right].argmax(axis=0)
    initial_support = score[ys-lo, xs] > 8
    normalized = (xs-(x+fw*.5))/fw
    candidates=[]
    # Rounded and pointed anime jaws need different bases. Prefer the model
    # supported by more measured columns, rather than rejecting the chin tip
    # as an outlier of a parabola fitted to a V-shaped contour.
    for basis in ('quadratic','absolute-linear'):
        design=np.column_stack((normalized**2 if basis=='quadratic' else np.abs(normalized),
                                normalized,np.ones(len(xs))))
        support=initial_support.copy()
        for _ in range(4):
            if support.sum()<max(12,len(xs)*.55):break
            coefficients=np.linalg.lstsq(design[support],ys[support],rcond=None)[0]
            residual=np.abs(design@coefficients-ys)
            support &= residual<max(2.,fh*.006)
        if support.sum()>=max(12,len(xs)*.55):
            error=float(np.sqrt(np.mean(residual[support]**2)))
            candidates.append((int(support.sum()),-error,basis,coefficients,support,error))
    if not candidates:
        raise ValueError('No continuous, source-supported jaw outline; no dummy neck was generated.')
    _,_,basis,coefficients,support,error=max(candidates,key=lambda c:c[:2])
    center_y = float(coefficients[-1])
    if error > 3 or not y+fh*.70 < center_y < y+fh*.87:
        raise ValueError('Ambiguous jaw outline; independent neck preparation stopped.')
    return {'coefficients_normalized_x': coefficients.tolist(), 'basis':basis,'center_x': x+fw*.5,
        'x_scale': fw, 'center_y': center_y, 'supported_columns': int(support.sum()),
        'tested_columns': len(xs), 'fit_rmse_pixels': error,
        'method': 'SAM-face-and-continuous-observed-jaw-ink-ridge'}


def jaw_y(jaw, xs):
    z=(xs-jaw['center_x'])/jaw['x_scale'];a,b,c=jaw['coefficients_normalized_x']
    return a*(np.abs(z) if jaw.get('basis')=='absolute-linear' else z*z)+b*z+c


def extend_head_structure(image, prepared, *, face_mask=None):
    """Independent opt-in extension. Cached masks are a test seam only."""
    if prepared.get('report',{}).get('hair',{}).get('status')=='failed':
        raise ValueError('Automatic hair preparation failed; a partially stationary hairstyle is not an independent-head success.')
    result = copy.deepcopy(prepared)
    graph, assets = result['graph'], result['assets']
    foreground = prepared['foreground']
    h, w = foreground.shape[:2]
    face = prepared['five']['diagnostics']['face_box_xywh']
    face_mask = automatic_face(image, face) if face_mask is None else np.asarray(face_mask, bool)
    if face_mask.shape != (h, w):
        raise ValueError('Automatic face mask does not match source coordinates.')
    jaw = measured_jaw(foreground, face_mask, face)
    yy, xx = np.indices((h, w)); seam = jaw_y(jaw, xx)
    base = next(p for p in graph['parts'] if p['id']=='foreground_base')
    x, y, bw, bh = base['source_box_xywh']
    owned = np.zeros((h, w), bool)
    owned[y:y+bh, x:x+bw] = decode_asset(assets, base['observed']['rgba'])[:, :, 3]>0
    rgb=foreground[:,:,:3].astype(int)
    warm=(rgb[:,:,0]-rgb[:,:,1]>8)&(rgb[:,:,0]-rgb[:,:,2]>12)&(rgb[:,:,0]>110)&(rgb[:,:,1]>70)
    corridor=(yy>seam+2)&(yy<face[1]+face[3]*.98)&(np.abs(xx-jaw['center_x'])<=face[2]*.17)
    # SAM may omit isolated shadow/highlight texels inside otherwise continuous
    # neck skin. Leaving those as static body/head paint creates moving holes.
    # Add only observed, locally skin-supported texels and close small gaps.
    neck_seed=(face_mask|warm)&owned&corridor
    neck=cv2.morphologyEx(neck_seed.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((3,3),np.uint8)).astype(bool)&owned&corridor
    if neck.sum()<max(30, face[2]*face[3]*.003):
        raise ValueError('Insufficient visible neck; independent neck rigging is unsupported for this image.')
    collar_y = int(np.percentile(np.nonzero(neck)[0], 99))+1
    if collar_y-jaw['center_y'] < max(8, face[3]*.04):
        raise ValueError('Visible neck is too short to anchor the collar.')
    neck_columns=np.nonzero(neck.any(axis=0))[0]
    bottom=np.array([np.nonzero(neck[:,col])[0].max()+1 for col in neck_columns],float)
    bottom=np.median(np.lib.stride_tricks.sliding_window_view(np.pad(bottom,2,mode='edge'),5),axis=1)
    collar_x=np.linspace(neck_columns.min(),neck_columns.max(),25)
    collar_curve={'x':collar_x.tolist(),'y':np.interp(collar_x,neck_columns,bottom).tolist(),
        'method':'measured-visible-neck-lower-contour','fixed_border_pixels':3}
    # Outside the visible neck corridor the jaw fit must not be extrapolated
    # through cheeks/headwear and assign their lower outlines to the torso.
    head = owned & ~neck & (yy<=jaw['center_y']+3)
    body = owned & ~head & ~neck
    if min(head.sum(), body.sum()) < 50:
        raise ValueError('Head/body observations are missing; no semantic success was reported.')
    graph['parts'].remove(base)
    for path in (base['observed']['rgba'], base['observed']['mask']):
        assets.pop(path, None)
    graph['groups'] += [{'id':'body_group', 'parent':'root'}, {'id':'neck_group', 'parent':'body_group'}]
    next(g for g in graph['groups'] if g['id']=='head')['parent']='neck_group'
    # Store underlaps separately. The exporter must inverse-mask them by the
    # current observed occluders so even alpha254 interiors remain unchanged
    # in neutral; near-opaque does not mean permission to alter source alpha.
    radius = max(3, min(32, round(face[2]*.055)))
    rows = []
    for role, mask, parent, order in [('head_surface',head,'head',20),
                                      ('neck',neck,'neck_group',10), ('body',body,'body_group',0)]:
        padding, generated, evidence = bounded_texture_padding(
            foreground, mask, foreground, face, pixels=radius)
        generated &= (foreground[:, :, 3]>=250) & ~mask
        if role=='neck':
            generated &= (head|body)&(yy<collar_y+2)&(np.abs(xx-jaw['center_x'])<face[2]*.20)
        elif role=='body':
            # Hidden clothing is estimated only immediately beneath moving
            # foreground, never relabelled as observed wardrobe anatomy.
            generated &= ~head
        else:
            generated[:] = False
        padding[~generated]=0
        union=mask|generated; ys,xs=np.nonzero(union)
        ax,ay,bx,by=int(xs.min()),int(ys.min()),int(xs.max())+1,int(ys.max())+1
        part=add_part(graph,assets,part_id=role,role=role,pixels=foreground[ay:by,ax:bx],
            mask=mask[ay:by,ax:bx],box=[ax,ay,bx-ax,by-ay],parent=parent,order=order,
            method=jaw['method'],confidence=.65,status='candidate',
            completion=padding[ay:by,ax:bx],completion_mask=generated[ay:by,ax:bx],
            motion={'kind':'fixed-torso' if role=='body' else 'neck-bridge' if role=='neck' else 'rigid-head',
                    'validated':False})
        part['completion'].update(evidence)
        part['completion']['generated_pixels']=int(generated.sum())
        part['completion']['status']='estimated' if generated.any() else 'not-generated'
        part['completion']['exposure_policy']='inverse-mask-current-observed-occluders; hidden-in-neutral'
        rows.append({'role':role,'observed_pixels':int(mask.sum()),'estimated_underlap_pixels':int(generated.sum())})
    # Existing source parts, including eye lid skin, now follow the head.
    for p in graph['parts']:
        if p['role'] not in ('neck','body') and p['parent']=='root':p['parent']='head'
    # Pick a measured body interior, clear of the maximum moving-head envelope.
    # Comparing a rectangle crossed by moving hair would test hair occlusion,
    # not whether the underlying body remains fixed.
    distance=cv2.distanceTransform(body.astype(np.uint8),cv2.DIST_L2,5)
    travel=min(12,w*.014);margin=int(np.ceil(travel+.045*face[3]*1.3))+2
    eligible=(yy>=collar_y+margin)&(yy<min(h,collar_y+face[3]*.36))&(np.abs(xx-jaw['center_x'])<face[2]*.12)
    scores=np.where(eligible,distance,-1)
    ty,tx=np.unravel_index(int(scores.argmax()),scores.shape)
    half=min(20,int(distance[ty,tx])-margin-1)
    if half<5:raise ValueError('No sufficiently clear torso interior for an independent fixed-body audit.')
    torso_roi=[int(tx-half),int(ty-half),int(tx+half+1),int(ty+half+1)]
    graph.setdefault('motions',{})['independent_head']={'profile':'head-neck-body-v1','jaw':jaw,
        'collar_y':collar_y,'collar_curve':collar_curve,'head_pivot_xy':[jaw['center_x'],jaw['center_y']],
        'maximum_translation_pixels':travel,'maximum_tilt_radians':.045,'fixed_torso_roi':torso_roi,
        'hidden_anatomy_recovered':False,'appearance_quality_passed':False,
        'face_angles_xy_rigged':False,'front_back_hair_depth_verified':False}
    # Rebuild occlusion provenance after replacing the old foreground owner.
    owner=np.full((h,w),-1,np.int16)
    for i,p in enumerate(graph['parts']):
        if p['observed']['rgba']:
            a=decode_asset(assets,p['observed']['rgba']);x,y,bw,bh=p['source_box_xywh']
            owner[y:y+bh,x:x+bw][a[:,:,3]>0]=i
    for p in graph['parts']:
        if p['completion']['rgba']:
            a=decode_asset(assets,p['completion']['rgba']);x,y,bw,bh=p['source_box_xywh']
            ids=set(owner[y:y+bh,x:x+bw][a[:,:,3]>0]);ids.discard(-1)
            p['occluded_by']=[graph['parts'][i]['id'] for i in sorted(ids) if graph['parts'][i]['id']!=p['id']]
    validate_graph(graph,assets)
    reconstructed,owners=reconstruct_observed(graph,assets)
    if not np.array_equal(reconstructed,foreground):
        raise ValueError('Head extension changed observed RGBA; generation stopped.')
    result['head_report']={'profile':'head-neck-body-v1','automatic':True,'manual_prompts':False,
        'parts':rows,'jaw':jaw,'collar_y':collar_y,'observed_reconstruction_rgba_exact':True,
        'overlapping_source_owners':int((owners>1).sum()),'hidden_anatomy_recovered':False,
        'appearance_quality_passed':False}
    return result
