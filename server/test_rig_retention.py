"""Corruption controls for the independent saved-model structure audit."""
import copy
import importlib.util
from pathlib import Path

import numpy as np
import pytest

spec=importlib.util.spec_from_file_location('rig_retention',Path(__file__).resolve().parents[1]/'scripts/inochi2d/check-rig-retention.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)


def fixture():
    t={'trans':[0,0,0],'rot':[0,0,0],'scale':[1,1]}
    part={'uuid':2,'name':'neck','type':'Part','transform':copy.deepcopy(t),'children':[],
        'mesh':{'verts':[0,0,2/3,0,0,1],'uvs':[0,0,1,0,0,1],'indices':[0,1,2],'origin':[0,0]},
        'masks':[{'source':2,'mode':'DodgeMask'}],'opacity':1,'mask_threshold':.96,'zsort':990,'tint':[1,1,1],'screenTint':[0,0,0]}
    param={'uuid':1001,'name':'HeadX','is_vec2':False,'min':[-1,0],'max':[1,1],'defaults':[0,0],
        'axis_points':[[0,1],[0]],'bindings':[{'node':2,'param_name':'opacity','values':[[0],[1]],'isSet':[[True],[True]],'interpolate_mode':'Linear'}]}
    return {'nodes':{'uuid':1,'name':'Root','type':'Node','transform':copy.deepcopy(t),'children':[part]},'param':[param]}


def test_float32_roundoff_and_uuid_remap_retain_the_actual_structure():
    a=fixture();b=copy.deepcopy(a);part=b['nodes']['children'][0]
    part['uuid']=20;part['masks'][0]['source']=20;b['param'][0]['bindings'][0]['node']=20
    part['mesh']['verts']=np.asarray(part['mesh']['verts'],np.float32).tolist()
    result=audit.equivalent(a,b)
    assert result['hierarchy_mesh_masks_bindings_retained']
    assert 0<result['maximum_numeric_roundtrip_delta']<1e-4
    assert result['runtime_validation'] is False


@pytest.mark.parametrize('corruption',['parent','mask','threshold','binding'])
def test_changed_parent_mask_threshold_or_binding_is_rejected(corruption):
    a=fixture();b=copy.deepcopy(a);part=b['nodes']['children'][0]
    if corruption=='parent':
        group={'uuid':3,'name':'WrongParent','type':'Node','transform':copy.deepcopy(b['nodes']['transform']),'children':[part]}
        b['nodes']['children']=[group]
    elif corruption=='mask':part['masks'][0]['mode']='Mask'
    elif corruption=='threshold':part['mask_threshold']=.5
    else:b['param'][0]['bindings'][0]['values'][1][0]=.5
    with pytest.raises(ValueError):audit.equivalent(a,b)


def physics_fixture():
    model=fixture();model['nodes']['children'].append({'uuid':3,'name':'pendulum','type':'SimplePhysics',
        'transform':copy.deepcopy(model['nodes']['transform']),'children':[],'param':1001,'model_type':'Pendulum',
        'map_mode':'AngleLength','local_only':False,'gravity':1,'length':200,'frequency':1,
        'angle_damping':.45,'length_damping':.6,'output_scale':[40,0]})
    return model


def test_physics_target_survives_parameter_uuid_remapping_and_invalid_targets_fail():
    a=physics_fixture();b=copy.deepcopy(a);b['param'][0]['uuid']=5001;b['nodes']['children'][1]['param']=5001
    assert audit.equivalent(a,b)['hierarchy_mesh_masks_bindings_retained']
    a['nodes']['children'][1]['param']=999;b['nodes']['children'][1]['param']=999
    with pytest.raises(ValueError,match='target'):audit.equivalent(a,b)


@pytest.mark.parametrize('field,value',[('param',999),('length',300),('angle_damping',.9),('model_type','SpringPendulum'),('local_only',True),('enabled',False),('lockToRoot',True)])
def test_changed_native_physics_configuration_fails_retention(field,value):
    a=physics_fixture();b=copy.deepcopy(a);b['nodes']['children'][1][field]=value
    with pytest.raises(ValueError):audit.equivalent(a,b)
