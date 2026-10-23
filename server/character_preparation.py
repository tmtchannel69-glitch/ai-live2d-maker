"""One image -> common editable parts; output engines are separate adapters."""
from __future__ import annotations

import copy
import time

import numpy as np
from PIL import Image, ImageOps

from server.character_parts import (EYE_ROLES, add_part, new_graph, reconstruct_observed,
                                    validate_graph)
from server.eye_parts import split_eye, complete_ocular
from server.inochi_quality import prepare_quality_image, extend_blink_parts, _canvas, _skin_field


def prepare_character_parts(image, include_hair=True):
    started=time.monotonic()
    image=ImageOps.exif_transpose(image).convert('RGBA');width,height=image.size
    if width*height>4_000_000:
        raise ValueError('詳細分割の試作は400万画素以下にしてください。通常の5役割処理とは別の上限です。')
    five=prepare_quality_image(image)
    return detail_from_prepared(image,five,include_hair,started)


def detail_from_prepared(image, five, include_hair=True, started=None):
    """Reusable boundary: tests/cache may supply prepared pixels, never points."""
    import cv2
    started=started if started is not None else time.monotonic()
    width,height=image.size;source=np.array(image.convert('RGBA'))
    graph=new_graph(width,height);assets={};diag=copy.deepcopy(five['diagnostics'])
    legacy=extend_blink_parts(five);face=diag['face_box_xywh'];eyes=diag['eye_regions']
    base=_canvas(five,'face_base');reference=Image.fromarray(base)
    eye_sources={side:_canvas(five,'eye_white_'+side) for side in ('l','r')}
    mask=np.logical_or.reduce([a[:,:,3]>0 for a in eye_sources.values()])
    for a in eye_sources.values():reference=Image.alpha_composite(reference,Image.fromarray(a))
    foreground=np.array(reference);remainder=foreground[:,:,3]>0;remainder &= ~mask
    face_completion=np.zeros_like(foreground);face_completion[mask]=base[mask]
    eye_diagnostics={}
    for side in ('l','r'):
        info=eyes[side];x0,y0,x1,y1=info['box'];box=[x0,y0,x1-x0,y1-y0]
        rgba=eye_sources[side][y0:y1,x0:x1].copy();split=split_eye(rgba,info,side)
        completed=complete_ocular(rgba,split)
        for index,role in enumerate(EYE_ROLES):
            evidence=split['recognition'][role];completion=completed.get(role)
            part=add_part(graph,assets,part_id=f'eye_{side}_{role}',role=role,side=side,
                pixels=rgba,mask=split['masks'][role],box=box,parent=f'eye_{side}',order=40+index,
                confidence=evidence['confidence'],method=evidence['method'],status=evidence['status'],
                completion=completion['rgba'] if completion else None,completion_mask=completion['mask'] if completion else None,
                motion={'kind':'upper-lash' if role=='eyelash_upper' else 'lower-lash' if role=='eyelash_lower' else 'aperture',
                        'maximum_gaze_pixels':max(1,round(info['dark_box'][2]*.025)), 'validated':False})
            if completion:part['completion']['method']=completion['status']
        # Closed artwork has no observed pixels. Keep its provenance separate
        # instead of labelling an inferred line as an extracted source part.
        closed=_canvas(five,'eye_closed_'+side)[y0:y1,x0:x1]
        add_part(graph,assets,part_id=f'eye_{side}_closed',role='closed_eyelash',side=side,
            pixels=np.zeros_like(rgba),mask=np.zeros(rgba.shape[:2],bool),box=box,parent=f'eye_{side}',order=60,
            status='estimated-only',confidence=.5,method='source-derived-tapered-closed-contour',
            completion=closed,completion_mask=closed[:,:,3]>0,
            motion={'kind':'closed-lash','validated':False})
        geometry=split['geometry'];geometry['closed_center_y']=legacy['manifest']['quality']['blink'][side]['closed_y']
        geometry['closed_lash_width']=diag['closed_eyes'][side]['maximum_width_pixels']
        geometry['box_xywh']=box
        graph.setdefault('motions',{}).setdefault('blink',{})[side]=geometry
        eye_diagnostics[side]=split['recognition']
    # The same source-supported local skin estimate is stored as a separate
    # layer. Inferred skin is never silently relabelled as observed face paint.
    add_part(graph,assets,part_id='eye_skin_underpaint',role='skin_completion',pixels=np.zeros_like(foreground),
        mask=np.zeros((height,width),bool),box=[0,0,width,height],parent='head',order=5,
        status='estimated-only',confidence=.55,method='robust-visible-skin-quadratic-with-boundary-blend',
        completion=face_completion,completion_mask=mask,
        motion={'kind':'skin-under-eyelids','validated':False})
    hair_report={'status':'not-requested','depth_verified':False}
    if include_hair:
        from server.hair_parts import automatic_hair, strand_candidates, bounded_texture_padding
        from server.engine import ModelUnavailable
        try:
            hair=automatic_hair(image,face)&remainder
            strands,hair_report=strand_candidates(source[:,:,:3],hair,face)
            for index,candidate in enumerate(strands):
                owned=candidate['mask']&remainder
                if not owned.any():continue
                padding,generated,detail=bounded_texture_padding(foreground,owned,foreground,face)
                union=owned|generated;ys,xs=np.nonzero(union)
                ax,ay,bx,by=int(xs.min()),int(ys.min()),int(xs.max())+1,int(ys.max())+1
                part=add_part(graph,assets,part_id=f'hair_strand_{index:02d}',role='hair_strand',
                    pixels=foreground[ay:by,ax:bx],mask=owned[ay:by,ax:bx],box=[ax,ay,bx-ax,by-ay],
                    parent='hair_'+candidate['region'],order=30+index,status='candidate',confidence=candidate['confidence'],
                    method=hair_report['method'],completion=padding[ay:by,ax:bx],completion_mask=generated[ay:by,ax:bx],
                    motion={'kind':'strand-sway-candidate','root_xy':candidate['root_xy'],
                            'maximum_exposure_pixels':detail.get('maximum_distance_pixels',0),'validated':False})
                part['hair_region']=candidate['region'];part['depth_verified']=False
                part['completion'].update(detail);remainder &= ~owned
            # A narrow, source-supported skin strip behind the visible fringe
            # supports small exposure only; no full hidden forehead is guessed.
            yy,xx=np.indices((height,width));fx,fy,fw,fh=face
            core=(((xx-(fx+fw*.5))/(fw*.43))**2+((yy-(fy+fh*.5))/(fh*.55))**2 < 1)
            rgb=foreground[:,:,:3].astype(int)
            skin_source=core & ~hair & ~mask & (foreground[:,:,3]>=240) & (rgb[:,:,0]-rgb[:,:,1]>5) & (rgb[:,:,0]-rgb[:,:,2]>5) & (rgb.mean(axis=2)>170)
            skin_padding,skin_target,skin_detail=bounded_texture_padding(foreground,skin_source,foreground,face,pixels=3)
            skin_target &= hair & core
            skin_padding[~skin_target]=0
            if skin_target.any():
                ys,xs=np.nonzero(skin_target);ax,ay,bx,by=int(xs.min()),int(ys.min()),int(xs.max())+1,int(ys.max())+1
                p=add_part(graph,assets,part_id='face_skin_behind_fringe',role='skin_completion',
                    pixels=np.zeros((by-ay,bx-ax,4),np.uint8),mask=np.zeros((by-ay,bx-ax),bool),
                    box=[ax,ay,bx-ax,by-ay],parent='head',order=4,status='estimated-only',confidence=.4,
                    method='bounded-visible-skin-continuation-behind-hair',
                    completion=skin_padding[ay:by,ax:bx],completion_mask=skin_target[ay:by,ax:bx],
                    motion={'kind':'fringe-exposure-underpaint','maximum_exposure_pixels':3,'validated':False})
                p['completion']['maximum_distance_pixels']=3
            # Unassigned watershed boundaries remain observed and retain RGB.
            hair_report['assigned_source_pixels']=sum(p['observed']['pixels'] for p in graph['parts'] if p['role']=='hair_strand')
            hair_report['coarse_region_pixels']=int((hair & remainder).sum())
            hair_report['original_hair_pixels']=int(hair.sum())
            hair_report['strand_source_coverage']=hair_report['assigned_source_pixels']/max(1,int(hair.sum()))
            # Keep the unseparated mass as coarse region candidates rather
            # than pretending all source contours were independent strands.
            rest=hair & remainder
            back=rest & (yy>fy+fh*.45) & ((xx<fx+fw*.12)|(xx>fx+fw*.88))
            for region,region_mask in [('back',back),('side_r',rest&~back&(xx<fx+fw*.32)),
                ('side_l',rest&~back&(xx>fx+fw*.68)),('front',rest&~back&(xx>=fx+fw*.32)&(xx<=fx+fw*.68))]:
                if not region_mask.any():continue
                ys,xs=np.nonzero(region_mask);ax,ay,bx,by=int(xs.min()),int(ys.min()),int(xs.max())+1,int(ys.max())+1
                p=add_part(graph,assets,part_id='hair_region_'+region,role='hair_region',
                    pixels=foreground[ay:by,ax:bx],mask=region_mask[ay:by,ax:bx],box=[ax,ay,bx-ax,by-ay],
                    parent='hair_'+region,order=20,status='ambiguous',confidence=.3,
                    method='coarse-SAM-remainder-location-not-proven-depth',
                    motion={'kind':'unseparated-hair-mass','validated':False})
                p['hair_region']=region;p['depth_verified']=False
                p['possible_regions']=['back','side_l','side_r'] if region=='back' else [region,'back']
                remainder &= ~region_mask
            hair_report['depth_assignment_is_ambiguous']=True
        except (ModelUnavailable,ValueError) as error:
            hair_report={'status':'failed','reason':str(error),'depth_verified':False}
    add_part(graph,assets,part_id='foreground_base',role='foreground_remainder',pixels=foreground,mask=remainder,
        box=[0,0,width,height],parent='root',order=0,confidence=1,method='remaining-observed-source-ownership',
        motion={'kind':'foreground-not-semantically-separated','validated':False})
    # Actual covered owners, not guessed depth ordering, explain each hidden
    # texture. No claim that a 2-D picture proves front/back hair anatomy.
    owners=np.full((height,width),-1,np.int16)
    for i,p in enumerate(graph['parts']):
        if not p['observed']['rgba']:continue
        from server.character_parts import decode_asset
        a=decode_asset(assets,p['observed']['rgba']);x,y,w,h=p['source_box_xywh']
        owners[y:y+h,x:x+w][a[:,:,3]>0]=i
    for p in graph['parts']:
        if not p['completion']['rgba']:continue
        a=decode_asset(assets,p['completion']['rgba']);x,y,w,h=p['source_box_xywh']
        indices=set(owners[y:y+h,x:x+w][a[:,:,3]>0].tolist());indices.discard(-1)
        p['occluded_by']=[graph['parts'][i]['id'] for i in sorted(indices) if graph['parts'][i]['id']!=p['id']]
    q=legacy['manifest']['quality'];graph['motions']['head']={'pivot':q['headPivot'],'neck_blend':q['neckBlend'],
        'method':'continuous-neck-weighted-mesh','independent_semantic_head_layers':False}
    validate_graph(graph,assets);reconstructed,owners=reconstruct_observed(graph,assets)
    if not np.array_equal(reconstructed,foreground):
        raise ValueError('Common source parts do not reconstruct the original extracted foreground.')
    report={'automatic':True,'manual_points_or_rigging':False,'external_image_requests':False,
        'source_size':[width,height],'eyes':eye_diagnostics,'hair':hair_report,
        'observed_reconstruction_rgba_exact':True,'overlapping_source_owners':int((owners>1).sum()),
        'source_rgb_changed_visible_pixels':int(np.any(reconstructed[:,:,:3][owners>0]!=source[:,:,:3][owners>0],axis=1).sum()),
        'missing_or_ambiguous_roles':[p['id'] for p in graph['parts'] if p['recognition']['status'] in ('missing','ambiguous')],
        'completion_is_local_estimate':True,'appearance_quality_passed':False,
        'elapsed_seconds':round(time.monotonic()-started,3)}
    graph['diagnostics']=report
    return {'graph':graph,'assets':assets,'five':five,'foreground':foreground,'report':report}
