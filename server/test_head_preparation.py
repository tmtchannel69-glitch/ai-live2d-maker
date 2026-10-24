"""Source-ownership/neck-evidence regressions on original drawn test geometry."""
import copy

import numpy as np
import pytest
from PIL import Image, ImageDraw

from server.character_parts import add_part,new_graph,reconstruct_observed,decode_asset,png
from server.head_preparation import measured_jaw,extend_head_structure


def fixture():
    image=Image.new('RGBA',(240,300),(245,210,190,255));draw=ImageDraw.Draw(image)
    face=[40,40,160,160]
    points=[(x,round(174-320*((x-120)/160)**2)) for x in range(68,173)]
    draw.line(points,fill=(125,80,70,255),width=3)
    pixels=np.array(image);pixels[280,20]=[90,75,130,128]
    image=Image.fromarray(pixels)
    mask=np.zeros((300,240),bool);mask[65:174,68:173]=True;mask[150:222,92:149]=True
    graph=new_graph(240,300);assets={}
    add_part(graph,assets,part_id='foreground_base',role='foreground_remainder',pixels=pixels,
        mask=pixels[:,:,3]>0,box=[0,0,240,300],parent='root',order=0)
    prepared={'graph':graph,'assets':assets,'foreground':pixels,'five':{'diagnostics':{'face_box_xywh':face}}}
    return image,prepared,mask


def test_measured_jaw_follows_visible_ink_and_rejects_missing_contour():
    image,p,mask=fixture();jaw=measured_jaw(p['foreground'],mask,[40,40,160,160])
    assert abs(jaw['center_y']-174)<3
    assert jaw['supported_columns']>45 and jaw['fit_rmse_pixels']<2
    blank=np.full(p['foreground'].shape,[245,210,190,255],np.uint8)
    with pytest.raises(ValueError,match='jaw'):measured_jaw(blank,mask,[40,40,160,160])


def test_head_neck_body_extension_retains_exact_source_rgba_without_mutating_input():
    image,p,mask=fixture();before=copy.deepcopy(p)
    result=extend_head_structure(image,p,face_mask=mask)
    out,owners=reconstruct_observed(result['graph'],result['assets'])
    np.testing.assert_array_equal(out,p['foreground']);assert owners.max()==1
    assert out[280,20,3]==128
    assert p['graph']==before['graph'] and p['assets']==before['assets']
    parts={a['id']:a for a in result['graph']['parts']}
    assert all(parts[r]['observed']['pixels']>0 for r in ['head_surface','neck','body'])
    assert next(g for g in result['graph']['groups'] if g['id']=='head')['parent']=='neck_group'
    assert result['head_report']['appearance_quality_passed'] is False


def test_underlaps_are_separate_and_do_not_cover_partial_source_alpha():
    image,p,mask=fixture();result=extend_head_structure(image,p,face_mask=mask)
    for part in result['graph']['parts']:
        if not part['completion']['rgba']:continue
        a=decode_asset(result['assets'],part['completion']['rgba']);x,y,w,h=part['source_box_xywh']
        observed=decode_asset(result['assets'],part['observed']['rgba'])
        assert not np.any((observed[:,:,3]>0)&(a[:,:,3]>0))
        assert np.all(p['foreground'][y:y+h,x:x+w,3][a[:,:,3]>0]>=240)
        assert part['completion']['enabled_in_neutral'] is False


def test_absent_neck_is_rejected_without_dummy_part():
    image,p,mask=fixture();mask[175:]=False
    p['foreground'][175:]=[240,240,250,255]
    p['assets']['observed/foreground_base.png']=png(p['foreground'])
    image=Image.fromarray(p['foreground'])
    with pytest.raises(ValueError,match='neck'):extend_head_structure(image,p,face_mask=mask)
    assert [a['id'] for a in p['graph']['parts']]==['foreground_base']
