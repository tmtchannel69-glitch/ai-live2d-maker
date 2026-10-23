"""Opt-in contour blink preparation; observations and estimates stay separate.

The stable five-part preparer and the first detailed profile are not changed.
Lower lashes are recovered from local contour evidence, never stock artwork.
"""
from __future__ import annotations

import numpy as np
from PIL import Image,ImageDraw

from server.eye_parts import split_eye


def _trace(mask, fallback, count=25):
    import cv2
    w=mask.shape[1];xs=[];ys=[]
    for x in range(w):
        rows=np.flatnonzero(mask[:,x])
        if len(rows):xs.append(x);ys.append(float(np.median(rows)))
    if len(xs)<4:return np.interp(np.linspace(0,w-1,count),np.linspace(0,w-1,len(fallback)),fallback).tolist()
    values=np.interp(np.arange(w),xs,ys)
    # Smooth geometry only. Observed RGBA/masks are never resampled.
    values=cv2.GaussianBlur(values[None,:],(0,0),max(.6,w/160))[0]
    return np.interp(np.linspace(0,w-1,count),np.arange(w),values).tolist()


def refine_eye(foreground, original, info, side, face=None, eye_exclusions=None):
    import cv2
    x0,y0,x1,y1=info['box'];rgba=foreground[y0:y1,x0:x1].copy()
    h,w=original.shape[:2];yy,xx=np.indices((h,w));gray=cv2.cvtColor(rgba[:,:,:3],cv2.COLOR_RGB2GRAY).astype(float)
    initial=split_eye(original,info,side);core=initial['iris_domain']|initial['masks']['sclera']
    cx,cy=initial['geometry']['iris_center'];rx,ry=initial['geometry']['iris_radii']
    columns=[];bottom=[]
    for x in range(w):
        rows=np.flatnonzero(core[:,x])
        if len(rows):columns.append(x);bottom.append(float(rows.max()))
    if len(columns)<6:raise ValueError('Lower eye contour has insufficient observed support.')
    lower=np.interp(np.arange(w),columns,bottom)
    lower=cv2.GaussianBlur(lower[None,:],(0,0),1)[0]
    neutral=np.ptp(rgba[:,:,:3].astype(int),axis=2)<90
    contrast=cv2.GaussianBlur(gray,(0,0),1.6)-gray
    band=(yy>=lower[None,:]-2)&(yy<=lower[None,:]+6)&(yy>cy+ry*.28)
    band &= (xx>=min(columns)-3)&(xx<=max(columns)+3)
    seed=band&neutral&(gray<222)&(contrast>2.8)&(rgba[:,:,3]>=240)
    near=cv2.dilate(core.astype(np.uint8),np.ones((7,7),np.uint8))>0
    n,labels,stats,_=cv2.connectedComponentsWithStats(seed.astype(np.uint8));ink=np.zeros((h,w),bool)
    for i in range(1,n):
        component=labels==i
        if stats[i,4]>=2 and np.any(component&near):ink |= component
    # Include a source-supported antialias fringe, excluding bright skin and
    # the chromatic iris. Its exact source colors are retained.
    fringe=cv2.dilate(ink.astype(np.uint8),np.ones((3,3),np.uint8))>0
    ink |= fringe&band&neutral&(gray<231)&(contrast>1)&(rgba[:,:,3]>=240)
    # Capture the source antialias halo as well as ink. Leaving it in the
    # fixed base would outline an otherwise correctly closed eye in white.
    halo=cv2.dilate((original[:,:,3]>0).astype(np.uint8),np.ones((3,3),np.uint8))>0
    owned=((halo|ink)&(rgba[:,:,3]==255))|(original[:,:,3]>0)
    rgba[~owned]=0
    ink &= owned
    split=split_eye(rgba,info,side)
    m=split['masks'];upper=m['eyelash_upper'].copy()
    candidate=(rgba[:,:,3]>0)&neutral&(gray<183)&~split['iris_domain']&(yy<cy+ry*.35)
    # Connected growth catches the warm outer eye corner missed by a strict
    # neutral/absolute-dark threshold. It cannot jump to isolated hair ink.
    for _ in range(4):upper |= (cv2.dilate(upper.astype(np.uint8),np.ones((3,3),np.uint8))>0)&candidate
    ink &= ~upper
    ink |= m['eyelash_lower']&~upper
    for role in m:m[role] &= ~(upper|ink)
    m['eyelash_upper']=upper;m['eyelash_lower']=ink
    # Pale iris paint can share skin colors. A lid cannot occupy the middle
    # of the observed eyeball hull; keep such ambiguous pixels in context.
    silhouette=np.zeros((h,w),np.uint8)
    cv2.fillConvexPoly(silhouette,cv2.convexHull(cv2.findNonZero(core.astype(np.uint8))),1)
    for role in ('upper_lid','lower_lid'):
        ambiguous=m[role]&(silhouette>0);m[role] &= ~ambiguous;m['context'] |= ambiguous
    if face is not None:
        from server.inochi_quality import _skin_field
        if eye_exclusions is None:
            eye_exclusions=np.zeros(foreground.shape[:2],bool);eye_exclusions[y0:y1,x0:x1]=owned
        field,(ax,ay,bx,by),_= _skin_field(foreground[:,:,:3],eye_exclusions,info,face)
        expected=field[y0-ay:y1-ay,x0-ax:x1-ax].astype(float)
        supported=np.linalg.norm(rgba[:,:,:3].astype(float)-expected,axis=2)<20
        for role in ('upper_lid','lower_lid'):
            ambiguous=m[role]&~supported;m[role] &= ~ambiguous;m['context'] |= ambiguous
    m['context'] |= (rgba[:,:,3]>0)&~np.logical_or.reduce(list(m.values()))
    if not np.array_equal(sum(a.astype(int) for a in m.values()),(rgba[:,:,3]>0).astype(int)):
        raise ValueError('Refined eye masks must partition observed alpha exactly.')
    for role in ('eyelash_upper','eyelash_lower'):
        split['recognition'][role].update(pixels=int(m[role].sum()),status='recognized' if m[role].any() else 'missing',
            method='observed-contour-local-contrast-connected-ink',confidence=.65 if role=='eyelash_lower' else .8)
    for role in m:
        split['recognition'][role]['pixels']=int(m[role].sum())
        if not m[role].any() and split['recognition'][role]['status']=='recognized':
            split['recognition'][role].update(status='missing',confidence=0)
    split['iris_domain'] &= ~ink
    g=split['geometry'];g['upper_center_y']=_trace(upper,g['upper_center_y'])
    g['lower_center_y']=_trace(ink,lower)
    widths=[int(upper[:,x].sum()) for x in range(w) if upper[:,x].any()]
    g['source_lash_width']=float(np.median(widths));g['profile']='contour-lid-v2'
    g['ownership_added_pixels']=int((owned&~(original[:,:,3]>0)).sum())
    g['observed_skin_stays_in_base']=True
    return rgba,split


def complete_skin(foreground, target, box, all_eye_masks, face):
    """Boundary-constrained skin continuation, without eye/hair color donors.

    Solves only missing eye/ink pixels. Already observed lids and surrounding
    skin remain in the base. Hidden ground truth is unavailable.
    """
    import cv2
    from server.inochi_quality import _skin_field
    reference,(ax,ay,bx,by),fit=_skin_field(foreground[:,:,:3],all_eye_masks,{'box':box},face)
    rgba=foreground[ay:by,ax:bx];rgb=rgba[:,:,:3].astype(float);r,g,b=rgb.transpose(2,0,1)
    known=(r>175)&(r-g>3)&(r-b>3)&(r-b<75)&(rgba[:,:,3]>=240)&~all_eye_masks[ay:by,ax:bx]
    quad=reference.astype(float)
    # A warm threshold alone also admits desaturated hair and some whites.
    # Use the robust skin cluster to reject these colored boundary donors.
    known &= np.linalg.norm(rgb-quad,axis=2)<18
    if known.sum()<40:raise ValueError('Observed skin support is insufficient for contour blink completion.')
    # Each starting texel cites real nearby skin; colors from the eyeball or
    # hair never enter the solve. Fixed known pixels impose the boundary.
    _,labels=cv2.distanceTransformWithLabels((~known).astype(np.uint8),cv2.DIST_L2,5,labelType=cv2.DIST_LABEL_PIXEL)
    sy,sx=np.nonzero(known);coords=np.zeros((len(sy)+1,2),int);coords[1:]=np.column_stack((sy,sx))
    donor=coords[labels];field=rgb[donor[:,:,0],donor[:,:,1]].copy()
    # Exclude strong drawn edges from the unknown skin estimate. Preserve
    # observed pixels outside target, rather than blurring the whole eye box.
    local_target=target[ay:by,ax:bx]
    solve=~known
    for _ in range(350):
        averaged=cv2.blur(field,(3,3),borderType=cv2.BORDER_REFLECT)
        field[solve]=averaged[solve]
    distance=cv2.distanceTransform(local_target.astype(np.uint8),cv2.DIST_L2,5)
    # Retain very small measured paint/JPEG variation from nearby skin. This
    # is a bounded estimate from real donors, never added random grain or
    # evidence of the hidden texture's true appearance.
    texture_support=cv2.erode(known.astype(np.uint8),np.ones((5,5),np.uint8))>0
    texture_details={'status':'insufficient-support','donor_pixels':int(texture_support.sum()),'hidden_texture_recovered':False}
    if texture_support.sum()>=40:
        weight=cv2.GaussianBlur(known.astype(float),(0,0),1.2)
        low=cv2.GaussianBlur(rgb*known[:,:,None],(0,0),1.2)/np.maximum(weight[:,:,None],1e-5)
        detail=np.clip(rgb-low,-1.25,1.25)
        _,tl=cv2.distanceTransformWithLabels((~texture_support).astype(np.uint8),cv2.DIST_L2,5,labelType=cv2.DIST_LABEL_PIXEL)
        dy,dx=np.nonzero(texture_support);tc=np.zeros((len(dy)+1,2),int);tc[1:]=np.column_stack((dy,dx))
        py,px=np.indices(known.shape);preferred_y=np.clip(py+round((box[3]-box[1])*.65),0,known.shape[0]-1)
        donors=tc[tl[preferred_y,px]];texture=detail[donors[:,:,0],donors[:,:,1]]
        blend=np.clip((distance-1)/3,0,1)
        field[local_target] += (texture*blend[:,:,None])[local_target]
        texture_details.update(status='estimated-from-visible-skin',maximum_rgb_delta=1.25,
            mean_absolute_rgb_delta=float(np.abs((texture*blend[:,:,None])[local_target]).mean()))
    # Near the border only, source pixels already consistent with the skin
    # cluster are safe to retain. Actual white-eye/ink colors never feather in.
    compatible=(np.linalg.norm(rgb-quad,axis=2)<12)&(r-g>3)&(r-b>3)&local_target
    edge_blend=np.clip(1-distance/3,0,1)*compatible
    field=field*(1-edge_blend[:,:,None])+rgb*edge_blend[:,:,None]
    result=np.zeros_like(foreground);patch=result[ay:by,ax:bx]
    patch[local_target,:3]=np.rint(np.clip(field,0,255)).astype(np.uint8)[local_target];patch[local_target,3]=255
    # Match visible skin at the nearest boundary. Original ink is deliberately
    # excluded: matching it would create a colored seam around the closed lid.
    boundary=local_target&(distance<=1.5)
    nearest=rgb[donor[:,:,0],donor[:,:,1]]
    boundary_error=float(np.mean(np.abs(field[boundary]-nearest[boundary]))) if boundary.any() else 0
    return result,{'method':'boundary-constrained-visible-skin-diffusion','sample_pixels':int(known.sum()),
        'generated_pixels':int(local_target.sum()),'nearest_skin_boundary_mae':boundary_error,
        'observed_skin_repainted':False,'texture_detail_recovered':False,'hidden_ground_truth_available':False,
        'robust_color_support':fit,'visible_texture_continuation':texture_details}


def continuous_closed_contour(estimated):
    """Make one tapered stroke from the input-derived estimate, not two fans.

    Only inferred artwork changes. Source lashes remain untouched. A single
    polygon avoids the detached wing triangle in the first closed estimate.
    """
    alpha=estimated[:,:,3].astype(float)/255;h,w=alpha.shape
    cols=np.flatnonzero((alpha>.15).any(axis=0))
    if len(cols)<6:raise ValueError('Source-derived closed contour is insufficient.')
    if not np.any(alpha>.4):raise ValueError('Source-derived closed contour contrast is insufficient.')
    centers=np.array([(np.arange(h)*alpha[:,x]).sum()/alpha[:,x].sum() for x in cols])
    fit=np.polyfit((cols-w/2)/w,centers,3)
    xs=np.linspace(cols.min(),cols.max(),max(80,8*len(cols)));u=(xs-xs.min())/(xs.max()-xs.min())
    ys=np.polyval(fit,(xs-w/2)/w)
    measured=float(np.percentile(alpha[:,cols].sum(axis=0),70))
    widths=max(.8,measured)*np.sin(np.pi*u)**.5
    polygon=list(zip(xs,ys-widths/2))+list(zip(xs[::-1],(ys+widths/2)[::-1]))
    scale=min(8,max(1,int(np.sqrt(16*1024*1024/(w*h)))))
    mask=Image.new('L',(w*scale,h*scale));ImageDraw.Draw(mask).polygon([(round(x*scale),round(y*scale)) for x,y in polygon],fill=255)
    out=np.zeros_like(estimated);out[:,:,3]=np.array(mask.resize((w,h),Image.Resampling.LANCZOS))
    ink=np.median(estimated[alpha>.4,:3],axis=0);out[out[:,:,3]>0,:3]=np.rint(ink).astype(np.uint8)
    trace=np.polyval(fit,(np.clip(np.linspace(0,w-1,25),cols.min(),cols.max())-w/2)/w)
    return out,trace.tolist(),float(widths.max())
