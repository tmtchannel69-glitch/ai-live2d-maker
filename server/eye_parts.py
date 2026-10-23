"""Evidence-based eye partition; uncertain pixels stay in an explicit context.

No fixed pupil/highlight graphics are substituted. Geometry estimates and
bounded completion remain marked as estimates in the shared data.
"""
from __future__ import annotations

import numpy as np

from server.character_parts import EYE_ROLES


def _component(mask, center, minimum=3, maximum_fraction=.8):
    import cv2
    count, labels, stats, centers = cv2.connectedComponentsWithStats(mask.astype(np.uint8))
    candidates = []
    for i in range(1, count):
        area = int(stats[i, 4])
        if area < minimum or area > mask.size*maximum_fraction:
            continue
        distance = np.linalg.norm((centers[i]-center)/np.array([mask.shape[1], mask.shape[0]]))
        candidates.append((area/(1+80*distance*distance), i))
    if not candidates:
        return np.zeros(mask.shape, bool)
    return labels == max(candidates)[1]


def split_eye(pixels, info, side):
    import cv2
    height, width = pixels.shape[:2]
    rgba = pixels.copy(); rgb = rgba[:, :, :3].astype(float)
    owned = rgba[:, :, 3] > 0
    yy, xx = np.indices((height, width))
    x0, y0, _, _ = info['box']; bx, by, bw, bh = info['dark_box']
    gray = cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(float)
    hsv = cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2HSV)
    center = info.get('ownership', {}).get('iris_center')
    cx, cy = (center[0]-x0, center[1]-y0) if center else (bx-x0+bw*.5, by-y0+bh*.62)
    # Search chromatic evidence near the iris, independently of its hue.
    inner = (((xx-cx)/(bw*.34))**2+((yy-cy)/(bh*.8))**2 < 1)
    seed_zone = (((xx-cx)/(bw*.19))**2+((yy-cy)/(bh*.43))**2 < 1)
    seeds = seed_zone & owned & (hsv[:,:,1] > 55) & (gray > 65) & (gray < 205)
    hue_weights = np.zeros(180, float)
    for hue, saturation in zip(hsv[:,:,0][seeds], hsv[:,:,1][seeds]):
        hue_weights[int(hue)] += int(saturation)
    # A circular hue mode avoids merging reddish lash ink with a purple iris;
    # the selected hue itself is measured, not fixed to blue/purple.
    smooth = sum(np.roll(hue_weights, i) for i in range(-5,6))
    hue = int(np.argmax(smooth))
    hue_delta = np.abs(hsv[:,:,0].astype(int)-hue); hue_delta=np.minimum(hue_delta,180-hue_delta)
    colorful = (hsv[:, :, 1] > 42) & (gray > 45) & (gray < 220) & inner & owned & (hue_delta < 18)
    # Warm skin is generally lighter and less saturated than the iris.
    candidate = _component(colorful, (cx, cy), max(3, round(bw*bh*.018)))
    iris_domain = np.zeros((height, width), np.uint8)
    if candidate.any():
        contour = cv2.convexHull(cv2.findNonZero(candidate.astype(np.uint8)))
        cv2.fillConvexPoly(iris_domain, contour, 1)
        iris_domain = cv2.dilate(iris_domain, np.ones((3, 3), np.uint8))
    iris_domain = iris_domain.astype(bool) & owned
    # Exclude pale external skin from the inferred iris hull.
    warm = (rgb[:, :, 0]-rgb[:, :, 1] > 4) & (rgb[:, :, 0]-rgb[:, :, 2] > 4) & (gray > 170)
    iris_domain &= ~warm
    if iris_domain.any():
        iy, ix = np.nonzero(iris_domain); cx, cy = float(np.mean(ix)), float(np.mean(iy))
        rx, ry = max(2, (ix.max()-ix.min()+1)/2), max(2, (iy.max()-iy.min()+1)/2)
    else:
        rx, ry = bw*.22, bh*.5
    local_contrast = gray-cv2.GaussianBlur(gray,(0,0),max(1,bw*.025))
    highlight = iris_domain & (gray >= 225) & (hsv[:, :, 1] < 55) & ((local_contrast > 12) | (gray > 247))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(highlight.astype(np.uint8))
    highlight = np.zeros(owned.shape,bool)
    for i in range(1,count):
        area=int(stats[i,4]);rw,rh=stats[i,2:4]
        if 2 <= area <= max(3,iris_domain.sum()*.12) and area/max(1,rw*rh)>.24:
            highlight |= labels==i
    # Keep multiple reflection spots, but refuse an implausibly large white
    # domain: that usually means sclera was mistaken for an iris.
    if highlight.sum() > max(2, iris_domain.sum()*.25):
        highlight[:] = False
    inner_pupil = (((xx-cx)/max(2, rx*.38))**2+((yy-cy)/max(2, ry*.55))**2 < 1)
    values = gray[iris_domain & ~highlight]
    cutoff = float(np.clip(np.percentile(values, 25), 35, 115)) if len(values) else 55
    pupil_candidate = iris_domain & inner_pupil & (gray < cutoff) & ~highlight
    pupil = _component(pupil_candidate, (cx, cy), max(2, round(bw*bh*.006)), .20)
    # A component must actually cross the inner iris, rather than only be the
    # dark upper shading. Otherwise retain it in iris and report ambiguity.
    pupil_status = 'recognized'
    if pupil.any() and abs(float(np.nonzero(pupil)[0].mean())-cy) > ry*.48:
        pupil[:] = False
    if not pupil.any():
        pupil_status = 'ambiguous'
    else:
        hull=cv2.convexHull(cv2.findNonZero(pupil.astype(np.uint8)));filled=np.zeros(owned.shape,np.uint8)
        cv2.fillConvexPoly(filled,hull,1);pupil=filled.astype(bool) & iris_domain & ~highlight
    # Upper/lower lash evidence stays outside the chromatic iris hull.
    neutral_ink = (np.ptp(rgb, axis=2) < 65) & (gray < min(145, info['threshold']+25)) & owned
    upper_zone = (yy < by-y0+bh*.48) & (xx >= bx-x0-2) & (xx <= bx-x0+bw+2)
    upper_ink = neutral_ink & upper_zone & ~iris_domain
    # Include antialiased edges by a one-pixel expansion, without claiming
    # colored iris pixels or skin as lashes.
    expanded = cv2.dilate(upper_ink.astype(np.uint8), np.ones((3,3),np.uint8)).astype(bool)
    upper_ink |= expanded & (gray < 175) & (np.ptp(rgb, axis=2) < 65) & owned & ~iris_domain
    lower_ink = neutral_ink & (yy > cy+ry*.3) & ~upper_ink & ~iris_domain
    assigned = upper_ink | lower_ink | iris_domain
    iy,ix=np.nonzero(iris_domain)
    central_y=(yy >= (iy.min() if len(iy) else cy-ry)) & (yy <= (iy.max() if len(iy) else cy+ry))
    white_seed=owned & ~assigned & central_y & (gray > 232) & (hsv[:,:,1] < 30)
    if white_seed.any():
        anchor=np.median(rgb[white_seed],axis=0)
        distance=np.linalg.norm((rgb-anchor)*np.array([.6,1,1]),axis=2)
        sclera=owned & ~assigned & central_y & (distance < 24) & (hsv[:,:,1] < 65)
    else:
        sclera=np.zeros(owned.shape,bool)
    # Only retain white components touching the iris neighborhood.
    neighborhood = cv2.dilate(iris_domain.astype(np.uint8), np.ones((9,9),np.uint8)).astype(bool)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(sclera.astype(np.uint8))
    sclera = np.zeros(owned.shape, bool)
    for i in range(1,count):
        part = labels == i
        if stats[i,4] >= 2 and np.any(part & neighborhood):
            sclera |= part
    assigned |= sclera
    upper_lid = owned & ~assigned & warm & (yy < cy)
    lower_lid = owned & ~assigned & warm & (yy >= cy)
    masks = {'upper_lid': upper_lid, 'lower_lid': lower_lid, 'eyelash_upper': upper_ink,
             'eyelash_lower': lower_ink, 'sclera': sclera, 'iris': iris_domain & ~pupil & ~highlight,
             'pupil': pupil, 'highlight': highlight}
    masks['context'] = owned & ~np.logical_or.reduce(list(masks.values()))
    counts = sum(m.astype(np.uint8) for m in masks.values())
    if not np.array_equal(counts, owned.astype(np.uint8)):
        raise ValueError('Eye partition is not exclusive or loses source pixels.')
    status = {}
    for role in EYE_ROLES:
        fraction=float(masks[role].sum()/max(1,owned.sum()))
        evidence=min(1,masks[role].sum()/max(4,bw*.25))
        confidence=float(np.clip(.45+.35*evidence-.25*max(0,fraction-.5),0,.85)) if masks[role].any() else 0
        status[role] = {'status': 'recognized' if masks[role].any() else 'missing',
            'confidence': confidence,
            'pixels': int(masks[role].sum()), 'method': 'color-shape-and-local-eye-evidence'}
    if pupil_status != 'recognized':
        status['pupil']['status'] = pupil_status
        status['pupil']['confidence'] = .2
    status['context']['confidence'] = .35
    # Measured column centers align moving source ink to the closed stroke's
    # center, rather than aligning its top edge (a source of duplicate lines).
    cols, centers, thickness = [], [], []
    for x in range(width):
        ys = np.where(upper_ink[:,x])[0]
        if len(ys):
            cols.append(x); centers.append(float(np.median(ys))); thickness.append(len(ys))
    if len(cols) < max(4,bw*.45):
        raise ValueError('Detailed upper eyelash evidence is insufficient for a blink.')
    fit = np.polyfit((np.array(cols)-width/2)/bw, centers, 3)
    knots = np.linspace(0,width-1,13)
    upper_y = np.polyval(fit, (np.clip(knots,min(cols),max(cols))-width/2)/bw)
    return {'masks': masks, 'recognition': status, 'iris_domain': iris_domain,
        'geometry': {'iris_center': [cx,cy], 'iris_radii': [float(rx),float(ry)], 'measured_iris_hue':hue, 'upper_center_y': upper_y.tolist(),
                     'source_lash_width': float(np.median(thickness)), 'side': side}}


def complete_ocular(pixels, split):
    """Separate underpainting for small gaze/exposure, never overwrite source."""
    import cv2
    masks = split['masks']; iris = split['iris_domain']; rgb=pixels[:,:,:3].astype(float)
    yy, xx = np.indices(iris.shape); result={}
    for role, target, samples in [('sclera',iris,masks['sclera']),
        ('iris',masks['pupil'] | masks['highlight'],masks['iris'])]:
        out=np.zeros(pixels.shape,np.uint8)
        if samples.sum() < max(8,iris.sum()*.04) or not target.any():
            result[role]={'rgba':out,'mask':np.zeros(iris.shape,bool),'status':'insufficient-visible-evidence'}
            continue
        if role=='sclera':
            # A vertical color/lighting gradient measured from both white-eye
            # sides retains upper-lid shadow better than a flat white patch.
            sy=yy[samples]/max(1,iris.shape[0]);design=np.stack([np.ones_like(sy),sy],axis=1)
            coeff=np.linalg.lstsq(design,rgb[samples],rcond=None)[0]
            field=coeff[0]+yy[:,:,None]/max(1,iris.shape[0])*coeff[1]
            low,high=np.percentile(rgb[samples],[3,97],axis=0);field=np.clip(field,low-3,high+3)
        else:
            # Local texture continuation under a small pupil/reflection,
            # bounded by the already-observed iris domain.
            region=rgb.astype(np.uint8).copy();mask=target.astype(np.uint8)*255
            region[~iris]=np.median(rgb[samples],axis=0).astype(np.uint8)
            field=cv2.inpaint(region,mask,2,cv2.INPAINT_TELEA)
        out[target,:3]=np.rint(np.clip(field,0,255)).astype(np.uint8)[target]
        out[target,3]=255
        result[role]={'rgba':out,'mask':target.copy(),'status':'estimated-from-visible-local-color'}
    return result
