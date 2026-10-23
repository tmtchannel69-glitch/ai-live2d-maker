"""Original drawn geometry tests; not a real-image/Creator appearance verdict."""
import copy

import numpy as np
import pytest
from PIL import Image,ImageDraw

from server.eye_parts import split_eye,complete_ocular
from server.character_parts import add_part,new_graph,reconstruct_observed,validate_graph
from server.hair_parts import bounded_texture_padding,strand_candidates,unsupported_thin_contrast
from server.parts_quality import inspect_frame,inspect_skin
from server.character_preparation import prepare_character_parts


def eye(color=(80,70,180),pupil=True,highlight=True):
    image=Image.new('RGBA',(120,90),(245,210,190,255));d=ImageDraw.Draw(image)
    d.ellipse((10,24,110,71),fill=(253,249,248,255))
    d.ellipse((40,26,79,70),fill=(*color,255))
    if pupil:d.ellipse((55,37,65,61),fill=(24,23,40,255))
    if highlight:
        d.ellipse((48,31,55,38),fill=(255,255,255,255));d.ellipse((67,43,70,46),fill=(253,253,255,255))
    d.arc((8,21,112,72),185,355,fill=(40,25,34,255),width=5)
    d.line((86,66,96,62),fill=(55,40,48,255),width=2)
    info={'box':[0,0,120,90],'dark_box':[10,20,100,49],'threshold':110,
          'ownership':{'iris_center':[59,48]}}
    return np.array(image),info


@pytest.mark.parametrize('color',[(80,70,180),(65,130,70),(125,90,50),(180,60,70)])
def test_measured_iris_hues_and_actual_source_features_remain_distinct(color):
    pixels,info=eye(color);split=split_eye(pixels,info,'l');m=split['masks']
    assert m['pupil'][51,60]
    assert m['highlight'][34,51]
    assert m['iris'][51,47]
    assert m['sclera'][46,25]
    assert m['upper_lid'][12,35] and m['lower_lid'][80,35]
    np.testing.assert_array_equal(sum(a.astype(int) for a in m.values()),np.ones(pixels.shape[:2],int))
    assert split['recognition']['pupil']['status']=='recognized'


def test_missing_pupil_and_highlight_are_not_replaced_by_dummy_art():
    pixels,info=eye(pupil=False,highlight=False);split=split_eye(pixels,info,'r')
    assert not split['masks']['pupil'].any()
    assert split['recognition']['pupil']['status']=='ambiguous'
    assert not split['masks']['highlight'].any()


def test_hidden_white_and_iris_are_separate_from_observed_source():
    pixels,info=eye();original=pixels.copy();split=split_eye(pixels,info,'l');completed=complete_ocular(pixels,split)
    np.testing.assert_array_equal(pixels,original)
    for role,item in completed.items():
        assert item['mask'].any()
        assert not np.any(item['mask']&split['masks'][role])
        assert np.all(item['rgba'][~item['mask']]==0)
    # Flattening visible owners still gives the source, independently of the
    # inferred images. Completion must not hide a missing visible part.
    flat=np.zeros_like(pixels)
    for mask in split['masks'].values():flat[mask]=pixels[mask]
    np.testing.assert_array_equal(flat,pixels)


def test_common_masks_coordinates_alpha_and_cycle_rejection():
    graph=new_graph(80,80);assets={};pixels=np.zeros((20,24,4),np.uint8);pixels[3:14,4:19]=[150,95,60,128]
    mask=pixels[:,:,3]>0
    add_part(graph,assets,part_id='test_part',role='iris',pixels=pixels,mask=mask,box=[10,12,24,20],parent='head',order=4)
    assert validate_graph(graph,assets)
    out,owners=reconstruct_observed(graph,assets)
    np.testing.assert_array_equal(out[12:32,10:34],pixels)
    assert out[15,14,3]==128 and int(owners.max())==1
    bad=copy.deepcopy(graph);bad['groups'][1]['parent']='test_part'
    with pytest.raises(ValueError,match='cyclic'):validate_graph(bad,assets)
    bad=copy.deepcopy(graph);bad['parts'][0]['observed']['pixels']+=1
    with pytest.raises(ValueError,match='count'):validate_graph(bad,assets)


def test_missing_common_part_has_no_transparent_dummy_files():
    graph=new_graph(80,80);assets={}
    add_part(graph,assets,part_id='no_highlight',role='highlight',pixels=np.zeros((12,12,4),np.uint8),
        mask=np.zeros((12,12),bool),box=[10,10,12,12],parent='eye_l',order=5)
    assert graph['parts'][0]['recognition']['status']=='missing'
    assert graph['parts'][0]['observed']['rgba'] is None and not assets


def test_strand_padding_uses_own_pixels_and_respects_exposure_limit():
    pixels=np.full((60,70,4),[220,30,40,255],np.uint8);owned=np.zeros((60,70),bool);owned[12:49,30:38]=True
    pixels[owned]=[120,135,170,255]
    out,mask,report=bounded_texture_padding(pixels,owned,pixels,[0,0,60,60],pixels=3)
    assert mask.any() and not np.any(mask&owned)
    assert np.all(out[mask,:3]==[120,135,170])
    assert report['maximum_distance_pixels']==3
    assert not mask[:,25].any() and not mask[:,42].any()


def test_strand_candidates_use_source_boundaries_and_have_exclusive_owners():
    rgb=np.full((130,110,3),245,np.uint8);mask=np.zeros((130,110),bool);mask[5:120,12:98]=True
    rgb[mask]=[170,175,200];rgb[5:120,53:57]=[50,50,70]
    strands,report=strand_candidates(rgb,mask,[20,20,65,85])
    assert len(strands)>=2 and report['boundary_pixels']>0
    owners=sum(p['mask'].astype(int) for p in strands)
    assert owners.max()==1 and not np.any(owners[~mask])
    assert report['depth_verified'] is False


@pytest.mark.parametrize('surrounding,expected',[((220,210,225),True),((55,48,60),False)])
def test_thin_contrasting_headwear_is_ambiguous_but_black_hair_is_not_rejected(surrounding,expected):
    image=Image.new('RGB',(120,100),surrounding);draw=ImageDraw.Draw(image)
    draw.arc((5,5,115,150),185,355,fill=(55,48,60),width=3)
    pixels=np.array(image);mask=np.all(pixels==[55,48,60],axis=2)
    if not expected:
        # The same thin shape on equally dark surrounding hair has no color
        # evidence for headwear. Preserve it as a possible hair component.
        shape=Image.new('1',image.size);ImageDraw.Draw(shape).arc((5,5,115,150),185,355,fill=1,width=3);mask=np.array(shape)
    assert unsupported_thin_contrast(pixels,mask,np.ones(mask.shape,bool)) is expected


def test_old_five_parts_to_shared_data_preserves_original_and_reports_absent_art(monkeypatch):
    from server import inochi_preparation as old
    from server.test_inochi_preparation import drawn_face
    monkeypatch.setattr(old,'_detect_face',lambda _: [50,20,120,120])
    source=drawn_face();pixels=np.array(source);pixels[200,100]=[70,85,140,128];source=Image.fromarray(pixels)
    result=prepare_character_parts(source,include_hair=False)
    assert len(result['five']['manifest']['parts'])==5
    rebuilt,owners=reconstruct_observed(result['graph'],result['assets'])
    np.testing.assert_array_equal(rebuilt,pixels)
    assert owners.max()==1 and result['report']['hair']['status']=='not-requested'
    assert any(p['role']=='highlight' and p['recognition']['status']=='missing' for p in result['graph']['parts'])


def test_defect_checks_find_injected_hole_iris_and_double_lash():
    pixels=np.full((40,70,4),[245,210,190,255],np.uint8);expected=np.ones((40,70),bool)
    pixels[5:8,5:8]=0;pixels[15:18,20:24]=[70,50,160,255]
    contribution=np.zeros((40,70));contribution[15:18,20:24]=1
    lash=np.zeros((40,70));lash[21:23,10:55]=1;lash[27:29,10:55]=1
    report=inspect_frame(pixels,opening=0,expected_opaque=expected,iris_contribution=contribution,lash_alpha=lash,
        iris_hues=[125],iris_area=expected)
    assert report['transparent_hole_pixels']==9
    assert report['closed_iris_residual_pixels']==12
    assert report['possible_closed_iris_color_pixels']>=12
    assert report['double_lash_columns']==45
    assert report['appearance_quality_passed'] is False


def test_smoothing_detector_flags_lost_known_texture():
    yy,xx=np.indices((60,60));texture=((xx+yy)%2)*14
    rgb=np.stack([230+texture,195+texture,180+texture],axis=2).astype(np.uint8)
    flat=np.full(rgb.shape,[237,202,187],np.uint8);mask=np.zeros((60,60),bool);mask[8:52,8:52]=True
    report=inspect_skin(flat,rgb,mask,mask)
    assert report['possible_blur'] and report['detail_ratio']<.01
    assert report['hidden_ground_truth_available'] is False
