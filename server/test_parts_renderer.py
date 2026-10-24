"""Known pixels for the independent diagnostic rasterizer, not official SDK."""
import copy
import importlib.util
from pathlib import Path

import numpy as np

spec=importlib.util.spec_from_file_location('diagnostic_renderer',Path(__file__).resolve().parents[1]/'scripts/inochi2d/render-diagnostic.py')
renderer=importlib.util.module_from_spec(spec);spec.loader.exec_module(renderer)


def fixture():
    t={'trans':[0,0,0],'rot':[0,0,0],'scale':[1,1]}
    mesh={'verts':[-10,-10,10,-10,-10,10,10,10],'uvs':[0,0,1,0,0,1,1,1],'indices':[0,1,2,1,3,2]}
    part={'uuid':2,'name':'paint','type':'Part','enabled':True,'zsort':0,'transform':copy.deepcopy(t),
          'mesh':mesh,'textures':[0],'opacity':1,'blend_mode':'Normal','masks':[],'children':[]}
    root={'uuid':1,'name':'root','type':'Node','transform':copy.deepcopy(t),'children':[part]}
    y,x=np.indices((20,20));texture=np.zeros((20,20,4),np.uint8)
    texture[:,:,:3]=np.stack([x*10,y*10,(x+y)*5],axis=2);texture[:,:,3]=255
    return {'nodes':root,'param':[]},[texture]


def test_native_uvs_and_triangle_seams_reconstruct_known_source_exactly():
    model,textures=fixture();rgba,_=renderer.render(model,textures,(20,20),(0,0,20,20),{})
    np.testing.assert_array_equal(rgba,textures[0])


def test_invisible_mask_node_still_clips_the_actual_paint():
    model,textures=fixture();mask=copy.deepcopy(model['nodes']['children'][0]);mask.update(uuid=3,name='aperture',opacity=0,textures=[1])
    mask['mesh']['verts']=[-10,-10,0,-10,-10,10,0,10]
    model['nodes']['children'].append(mask);model['nodes']['children'][0]['masks']=[{'source':3,'mode':'Mask'}]
    textures.append(np.full((1,1,4),255,np.uint8))
    rgba,_=renderer.render(model,textures,(20,20),(0,0,20,20),{})
    np.testing.assert_array_equal(rgba[:,:10],textures[0][:,:10]);assert not rgba[:,10:].any()


def test_actual_raw_zero_opacity_and_partial_alpha_are_applied():
    model,textures=fixture();textures[0][:]=[80,50,30,128]
    rgba,_=renderer.render(model,textures,(20,20),(0,0,20,20),{})
    assert np.all(rgba[:,:,3]==128);assert np.all(rgba[:,:,:3]==[159,100,60])
    model['param']=[{'name':'EyeOpenL','min':[0,0],'max':[1,1],'defaults':[1,0],'axis_points':[[0,1],[0]],
        'bindings':[{'node':2,'param_name':'opacity','values':[[0],[1]]}]}]
    rgba,layers=renderer.render(model,textures,(20,20),(0,0,20,20),{'EyeOpenL':0})
    assert not rgba.any() and not layers


def test_inverse_mask_keeps_alpha254_neutral_and_reveals_underpaint_only_after_motion():
    model,textures=fixture();textures[0][:]=[100,80,60,254]
    before,_=renderer.render(model,textures,(20,20),(0,0,20,20),{})
    under=copy.deepcopy(model['nodes']['children'][0]);under.update(uuid=3,name='underpaint',zsort=1,textures=[1],
        masks=[{'source':2,'mode':'DodgeMask'}])
    model['nodes']['children'].append(under);textures.append(np.full((20,20,4),[180,160,140,255],np.uint8))
    model['param']=[{'name':'HeadX','min':[-1,0],'max':[1,1],'defaults':[0,0],'axis_points':[[0,.5,1],[0]],
        'bindings':[{'node':2,'param_name':'transform.t.x','values':[[-3],[0],[3]]}]}]
    neutral,_=renderer.render(model,textures,(20,20),(0,0,20,20),{})
    np.testing.assert_array_equal(neutral,before)
    moved,_=renderer.render(model,textures,(20,20),(0,0,20,20),{'HeadX':1})
    assert np.all(moved[:,:3]==[180,160,140,255])
    assert np.all(moved[:,3:,3]==254)


def test_serialized_mask_threshold_is_respected_in_diagnostic():
    model,textures=fixture();mask=copy.deepcopy(model['nodes']['children'][0])
    mask.update(uuid=3,name='coverage',opacity=0,textures=[1],mask_threshold=.75)
    model['nodes']['children'].append(mask)
    model['nodes']['children'][0]['masks']=[{'source':3,'mode':'Mask'}]
    textures.append(np.full((1,1,4),[120,120,120,128],np.uint8))
    rgba,_=renderer.render(model,textures,(20,20),(0,0,20,20),{})
    assert not rgba.any()
    mask['mask_threshold']=.25
    rgba,_=renderer.render(model,textures,(20,20),(0,0,20,20),{})
    np.testing.assert_array_equal(rgba,textures[0])
