"""Local automatic hair/strand candidates; depth is explicitly uncertain.

SAM prompts are derived from detected face geometry. Watershed uses measured
image edges, not equal-width strips. Narrow hidden-root/overlap padding uses
only the strand's own nearest visible texture, never another strand's paint.
"""
from types import SimpleNamespace

import numpy as np


def automatic_hair(image, face):
    from server.engine import SamEngine
    x,y,fw,fh=face;w,h=image.size
    def pt(a,b,label=1):
        return SimpleNamespace(x=float(np.clip(a/w,0,1)),y=float(np.clip(b/h,0,1)),label=label)
    def prompt(name,box,points):
        return SimpleNamespace(id=name,box=[float(np.clip(v,0,1)) for v in
            (box[0]/w,box[1]/h,box[2]/w,box[3]/h)],all_points=points)
    prompts=[prompt('hair',(x-.35*fw,y-.5*fh,x+1.35*fw,y+1.4*fh),
        [pt(x+.48*fw,y-.05*fh),pt(x+.07*fw,y+.5*fh),pt(x+.93*fw,y+.5*fh),
         pt(x+.5*fw,y+.7*fh,0),pt(x+.5*fw,y+1.4*fh,0)])]
    return SamEngine().segment(image,prompts)[0]


def unsupported_thin_contrast(rgb, mask, hair_mask):
    """A contrasting thin arc needs review; SAM hair may include headwear.

    Color alone never rejects dark hair. This only defers sparse components
    with a large difference from the surrounding hair, without deleting paint.
    """
    ys,xs=np.nonzero(mask)
    if not len(ys):return False
    fill=len(ys)/((xs.max()-xs.min()+1)*(ys.max()-ys.min()+1))
    color=np.median(rgb[mask].astype(float),axis=0)
    reference=np.median(rgb[hair_mask].astype(float),axis=0)
    return bool(fill<.18 and np.linalg.norm(color-reference)>100)


def strand_candidates(rgb, hair_mask, face, maximum=10):
    import cv2
    x,y,fw,fh=face
    gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
    edges=cv2.Canny(gray,45,110)
    # Reject fine paint texture as a separator. Keep long connected contours.
    n,labels,stats,_=cv2.connectedComponentsWithStats((edges>0).astype(np.uint8))
    barriers=np.zeros(hair_mask.shape,np.uint8)
    for i in range(1,n):
        if stats[i,4]>fw*.10 and stats[i,3]>fh*.12:
            barriers[labels==i]=1
    interior=hair_mask & ~cv2.dilate(barriers,np.ones((3,3),np.uint8)).astype(bool)
    n,labels,stats,_=cv2.connectedComponentsWithStats(interior.astype(np.uint8))
    candidates=[]
    for i in range(1,n):
        bx,by,bw,bh,area=stats[i]
        if area>fw*fh*.006 and bh>fh*.16 and bw>fw*.025:
            candidates.append((int(area),i))
    candidates=sorted(candidates,reverse=True)[:maximum]
    if not candidates:
        return [],{'status':'no-source-supported-strand-boundaries','depth_verified':False}
    markers=np.zeros(hair_mask.shape,np.int32);markers[~hair_mask]=1
    for index,(_,label) in enumerate(candidates,2):
        seed=cv2.erode((labels==label).astype(np.uint8),np.ones((3,3),np.uint8))>0
        if not seed.any():seed=labels==label
        markers[seed]=index
    watershed=cv2.watershed(rgb.copy(),markers)
    strands=[];ambiguous=[]
    for index,(_,label) in enumerate(candidates,2):
        mask=(watershed==index)&hair_mask
        if mask.sum()<fw*fh*.006:continue
        ys,xs=np.nonzero(mask);cx,cy=float(xs.mean()),float(ys.mean())
        if unsupported_thin_contrast(rgb,mask,hair_mask):
            ambiguous.append({'source_box_xywh':[int(xs.min()),int(ys.min()),int(xs.max()-xs.min()+1),int(ys.max()-ys.min()+1)],
                'pixels':int(mask.sum()),'status':'ambiguous',
                'reason':'thin-contrasting-component-may-be-headwear-or-different-hair',
                'source_retained_in_coarse_remainder':True})
            continue
        # Regions are inferred from location; a flat image does not establish
        # the hidden front/back order. Expose that uncertainty in the data.
        if cy<y+fh*.32 and x+fw*.15<cx<x+fw*.85:
            region='front'
        elif cx<x+fw*.32 or cx>x+fw*.68:
            region='side_r' if cx<x+fw*.5 else 'side_l'
        else:
            region='back'
        root_y=int(np.percentile(ys,3));root_x=float(np.median(xs[ys<=root_y+max(2,round(fh*.025))]))
        strands.append({'mask':mask,'region':region,'root_xy':[root_x,float(root_y)],
            'confidence':.5,'status':'candidate','source_area':int(mask.sum())})
    return strands,{'status':'candidates','method':'automatic-SAM-and-source-contour-watershed',
        'depth_verified':False,'front_back_inferred':True,'strand_count':len(strands),
        'ambiguous_components':ambiguous,
        'boundary_pixels':int((barriers.astype(bool)&hair_mask).sum())}


def bounded_texture_padding(rgba, visible, foreground, face, pixels=None):
    """A source-supported narrow underlap/root extension, not hidden anatomy."""
    import cv2
    radius=int(pixels if pixels is not None else np.clip(round(face[2]*.009),2,6))
    if not visible.any():
        return np.zeros(rgba.shape,np.uint8),np.zeros(visible.shape,bool),{'status':'missing-source'}
    # Pixel labels identify the actual nearest visible strand texel. The
    # extrapolation cannot borrow paint from the overlapping foreground.
    distance,labels=cv2.distanceTransformWithLabels((~visible).astype(np.uint8),cv2.DIST_L2,5,labelType=cv2.DIST_LABEL_PIXEL)
    ys,xs=np.nonzero(visible);coordinates=np.zeros((len(ys)+1,2),np.int32)
    coordinates[1:]=np.column_stack((ys,xs))
    target=(distance>0)&(distance<=radius)&(foreground[:,:,3]>=240)
    # Do not extend a root into arbitrary background or create a fake large
    # hidden sheet. Every generated texel cites nearby visible evidence.
    out=np.zeros(rgba.shape,np.uint8)
    nearest=coordinates[labels[target]]
    out[target,:3]=rgba[nearest[:,0],nearest[:,1],:3];out[target,3]=255
    return out,target,{'status':'bounded-estimate' if target.any() else 'not-needed',
        'method':'own-visible-texture-nearest-continuation','maximum_distance_pixels':radius,
        'generated_pixels':int(target.sum()),'depth_verified':False,'anatomy_recovered':False}
