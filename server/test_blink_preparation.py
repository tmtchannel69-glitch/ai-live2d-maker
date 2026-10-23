"""Known drawn observations/withheld skin controls, not a naturalness verdict."""
import numpy as np
import pytest
from PIL import Image,ImageDraw

from server.blink_preparation import refine_eye,continuous_closed_contour,complete_skin
from server.test_character_parts import eye
from server.parts_quality import inspect_frame


def test_warm_lower_lash_is_observed_and_never_repaints_source_or_iris():
    pixels,info=eye();image=Image.fromarray(pixels)
    ImageDraw.Draw(image).line((86,66,99,61),fill=(185,135,145,255),width=2)
    pixels=np.array(image);before=pixels.copy();refined,split=refine_eye(pixels,pixels,info,'l')
    assert split['masks']['eyelash_lower'][64,92]
    assert split['masks']['pupil'][51,60] and split['masks']['highlight'][34,51]
    np.testing.assert_array_equal(refined,pixels);np.testing.assert_array_equal(pixels,before)
    np.testing.assert_array_equal(sum(m.astype(int) for m in split['masks'].values()),np.ones(pixels.shape[:2],int))


def test_new_source_ownership_retains_omitted_lower_line_and_antialias_halo():
    pixels,info=eye();original=pixels.copy();original[66:70,80:102]=0
    refined,split=refine_eye(pixels,original,info,'r')
    owned=refined[:,:,3]>0
    assert split['geometry']['ownership_added_pixels']>0
    np.testing.assert_array_equal(refined[owned],pixels[owned])
    assert not np.any(refined[~owned])


def test_refined_halo_does_not_turn_translucent_foreground_into_opaque_skin():
    pixels,info=eye();original=pixels.copy();original[:3]=0;pixels[:3,:,3]=128
    original[64:72,83:104]=0;pixels[66:68,88:99]=[70,50,70,250]
    refined,_=refine_eye(pixels,original,info,'l')
    assert not refined[:3].any()
    assert not refined[66:68,88:99].any()


def test_single_inferred_contour_removes_detached_wing_without_touching_input():
    image=Image.new('RGBA',(110,80));draw=ImageDraw.Draw(image)
    draw.line([(10,39),(35,44),(65,44),(100,37)],fill=(60,40,45,255),width=3)
    draw.line((89,34,103,29),fill=(60,40,45,255),width=2)
    before=np.array(image);closed,trace,width=continuous_closed_contour(before)
    np.testing.assert_array_equal(np.array(image),before)
    assert len(trace)==25 and np.isfinite(trace).all() and width>0
    for x in range(closed.shape[1]):
        ys=np.flatnonzero(closed[:,x,3]>46)
        assert not len(ys) or np.max(np.diff(ys),initial=0)<=2
    assert not np.any(closed[closed[:,:,3]==0])


def test_missing_closed_art_is_explicit_failure():
    with pytest.raises(ValueError,match='insufficient'):
        continuous_closed_contour(np.zeros((70,90,4),np.uint8))


def test_skin_continuation_excludes_iris_hair_and_preserves_observed_pixels():
    y,x=np.indices((200,220));source=np.zeros((200,220,4),np.uint8)
    source[:,:,:3]=np.stack([250+x*.01,220+x*.02,212+y*.02],axis=2).astype(np.uint8);source[:,:,3]=255
    target=np.zeros(source.shape[:2],bool);target[65:110,65:145]=True
    source[target,:3]=[90,80,170];source[40:60,40:160,:3]=[180,165,190]
    before=source.copy();out,report=complete_skin(source,target,[60,60,150,120],target,[20,10,170,175])
    np.testing.assert_array_equal(source,before)
    assert np.all(out[target,0]>245) and np.all(out[target,1]>215)
    assert np.all(out[target,3]==255) and not np.any(out[~target])
    assert report['observed_skin_repainted'] is False
    assert report['visible_texture_continuation']['hidden_texture_recovered'] is False


def test_unsupported_skin_is_rejected_instead_of_using_stock_paint():
    source=np.full((200,220,4),[70,100,160,255],np.uint8);target=np.zeros(source.shape[:2],bool);target[65:110,65:145]=True
    with pytest.raises(ValueError):complete_skin(source,target,[60,60,150,120],target,[20,10,170,175])


def test_washed_lash_coverage_is_visible_even_over_an_opaque_skin_background():
    frame=np.full((30,70,4),[240,210,200,255],np.uint8);mask=np.ones((30,70),bool)
    window=np.zeros_like(mask);window[:,12:58]=True
    for alpha,weak in [(.75,46),(1,0)]:
        lash=np.zeros(mask.shape);lash[13:17,8:62]=alpha
        result=inspect_frame(frame,opening=.5,expected_opaque=mask,lash_alpha=lash,lash_window=window)
        assert result['transparent_hole_pixels']==0
        assert result['lash_core_coverage']['weak_columns']==weak
