"""Format-independent defect candidates; these do not certify naturalness."""
import numpy as np


def inspect_frame(rgba, *, opening, expected_opaque, iris_contribution=None,
                  lash_alpha=None, lash_window=None, iris_hues=(), iris_area=None):
    import cv2
    if rgba.ndim!=3 or rgba.shape[2]!=4 or expected_opaque.shape!=rgba.shape[:2]:
        raise ValueError('Quality frame/mask dimensions differ.')
    alpha=rgba[:,:,3].astype(float)/255
    holes=expected_opaque & (alpha<.985)
    rgb=rgba[:,:,:3]
    hsv=cv2.cvtColor(rgb,cv2.COLOR_RGB2HSV)
    # A color-only residual detector is deliberately a candidate, not proof:
    # the source iris may be brown/gray and must also be traced by ownership.
    if iris_contribution is not None:
        if iris_contribution.shape!=alpha.shape:raise ValueError('Iris contribution dimensions differ.')
        ghost_pixels=int((iris_contribution>.01).sum()) if opening==0 else 0
        max_iris=float(iris_contribution.max())
    else:
        ghost_pixels=0;max_iris=None
    colored_residue=0
    if opening==0 and iris_area is not None:
        possible=np.zeros(alpha.shape,bool)
        for hue in iris_hues:
            delta=np.abs(hsv[:,:,0].astype(int)-int(hue));delta=np.minimum(delta,180-delta)
            possible |= (delta<13)&(hsv[:,:,1]>80)&(hsv[:,:,2]<225)
        colored_residue=int((possible&iris_area).sum())
    two_line_columns=0;stroke_widths=[];core_coverage=None
    if lash_alpha is not None:
        if lash_alpha.shape!=alpha.shape:raise ValueError('Lash alpha dimensions differ.')
        binary=lash_alpha>.18
        if lash_window is not None:binary &= lash_window
        if lash_window is not None:
            maxima=np.max(np.where(lash_window,lash_alpha,0),axis=0)
            present=maxima>.18
            core_coverage={'weak_columns':int(((maxima<.85)&present).sum()),
                'median_column_maximum_alpha':float(np.median(maxima[present])) if present.any() else 0}
        for x in range(binary.shape[1]):
            ys=np.where(binary[:,x])[0]
            if not len(ys):continue
            splits=np.where(np.diff(ys)>2)[0]
            if len(splits):two_line_columns+=1
            stroke_widths.append(int(len(ys)))
    return {'opening':float(opening),'transparent_hole_pixels':int(holes.sum()),
        'closed_iris_residual_pixels':ghost_pixels,'maximum_iris_contribution':max_iris,
        'possible_closed_iris_color_pixels':colored_residue,
        'double_lash_columns':two_line_columns if opening<=.26 else None,
        'median_lash_stroke_pixels':float(np.median(stroke_widths)) if stroke_widths else 0,
        'lash_core_coverage':core_coverage,
        'warnings':([{'kind':'transparent-hole','pixels':int(holes.sum())}] if holes.any() else [])+
            ([{'kind':'iris-residual','pixels':ghost_pixels}] if ghost_pixels else [])+
            ([{'kind':'possible-iris-color-residual','pixels':colored_residue}] if colored_residue else [])+
            ([{'kind':'possible-double-lash','columns':two_line_columns}] if opening<=.26 and two_line_columns>3 else []),
        'appearance_quality_passed':False}


def inspect_skin(estimated_rgb, reference_rgb, generated_mask, reference_mask):
    import cv2
    if not generated_mask.any() or np.count_nonzero(reference_mask)<12:
        return {'status':'insufficient-reference','appearance_quality_passed':False}
    a=cv2.cvtColor(estimated_rgb,cv2.COLOR_RGB2GRAY).astype(float)
    b=cv2.cvtColor(reference_rgb,cv2.COLOR_RGB2GRAY).astype(float)
    # Compare local detail on the same scale. The real hidden skin is unknown,
    # so smoothness can only be flagged for review, never scored as accurate.
    la=cv2.Laplacian(a,cv2.CV_64F);lb=cv2.Laplacian(b,cv2.CV_64F)
    generated=float(np.var(la[generated_mask]));reference=float(np.var(lb[reference_mask]))
    ratio=generated/max(reference,.05)
    return {'status':'measured','generated_laplacian_variance':generated,'reference_laplacian_variance':reference,
        'detail_ratio':ratio,'possible_blur':bool(reference>1 and ratio<.20),
        'hidden_ground_truth_available':False,'appearance_quality_passed':False}
