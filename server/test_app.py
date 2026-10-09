import base64
import io
import json
import importlib
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient
from server.engine import ModelUnavailable
module = importlib.import_module('server.app')
client = TestClient(module.app)

def image_bytes(width=40, height=60):
    image = Image.new('RGBA', (width, height), (120, 80, 200, 123))
    output = io.BytesIO(); image.save(output, 'PNG'); return output.getvalue()

def request(prompts, data=None):
    return client.post('/api/separate', files={'image': ('test.png', data or image_bytes(), 'image/png')}, data={'prompts': json.dumps(prompts)})

def test_full_size_png_preserves_rgb_alpha_and_coordinates(monkeypatch):
    def segment(image, prompts):
        mask = np.zeros((60, 40), dtype=bool); mask[10:20, 5:15] = True
        assert prompts[0].point == (.25, .25)
        return [mask]
    monkeypatch.setattr(module.engine, 'segment', segment)
    result = request([{'id': 'hair', 'point': [.25, .25]}])
    assert result.status_code == 200
    part = result.json()['parts'][0]
    image = Image.open(io.BytesIO(base64.b64decode(part['png'])))
    assert image.size == (40, 60)
    assert image.getpixel((5,10)) == (120,80,200,123)
    assert image.getpixel((4,10))[3] == 0

def test_prompt_validation():
    invalid = [[], [{'id':'unknown','point':[.5,.5]}], [{'id':'hair','point':[2,.5]}],
        [{'id':'hair','box':[.5,.5,.4,.8]}], [{'id':'hair','point':[.5,.5],'box':[0,0,1,1]}],
        [{'id':'hair','point':[.5,.5]}, {'id':'hair','point':[.2,.2]}], [{'id':'hair','point':[float('nan'),.5]}]]
    for value in invalid: assert request(value).status_code == 422

def test_image_validation():
    valid = [{'id':'face','box':[.1,.1,.9,.9]}]
    assert request(valid, b'broken').status_code == 400
    assert request(valid, image_bytes(4097, 1)).status_code == 413
    assert request(valid, b'x' * (10 * 1024 * 1024 + 1)).status_code == 413

def test_model_unavailable_and_busy(monkeypatch):
    def unavailable(*args): raise ModelUnavailable('モデルが未配置')
    monkeypatch.setattr(module.engine, 'segment', unavailable)
    valid = [{'id':'face','point':[.5,.5]}]
    assert request(valid).status_code == 503
    module.lock.acquire()
    try: assert request(valid).status_code == 503
    finally: module.lock.release()

def test_failure_releases_lock_and_can_retry(monkeypatch):
    def failure(*args): raise RuntimeError('internal')
    monkeypatch.setattr(module.engine, 'segment', failure)
    valid = [{'id':'body','box':[0,0,1,1]}]
    assert request(valid).status_code == 500
    monkeypatch.setattr(module.engine, 'segment', lambda image, prompts: [np.ones((60,40), dtype=bool)])
    assert request(valid).status_code == 200

def test_transparent_only_region_is_not_reported_as_success(monkeypatch):
    monkeypatch.setattr(module.engine, 'segment', lambda image, prompts: [np.ones((60,40), dtype=bool)])
    image = Image.new('RGBA', (40,60), (0,0,0,0)); stream=io.BytesIO(); image.save(stream,'PNG')
    response=request([{'id':'hair','point':[.5,.5]}],stream.getvalue())
    assert response.status_code == 422
    assert '透明' in response.json()['detail']

def test_multiple_points_and_box_reach_engine_unchanged(monkeypatch):
    def inspect(image, prompts):
        prompt = prompts[0]
        assert [(p.x,p.y,p.label) for p in prompt.all_points] == [(0.25,0.3,1),(0.8,0.7,0)]
        assert prompt.box == (0,0,1,1)
        return [np.ones((60,40),dtype=bool)]
    monkeypatch.setattr(module.engine,'segment',inspect)
    result=request([{'id':'hair','points':[{'x':.25,'y':.3,'label':1},{'x':.8,'y':.7,'label':0}],'box':[0,0,1,1]}])
    assert result.status_code == 200

def test_multiple_point_limits_and_negative_only_validation():
    positive={'x':.5,'y':.5,'label':1}
    invalid=[
        {'id':'hair','points':[]},
        {'id':'hair','points':[positive]*33},
        {'id':'hair','points':[{'x':.5,'y':.5,'label':0}]},
        {'id':'hair','points':[{'x':1.01,'y':.5,'label':1}]},
        {'id':'hair','points':[{'x':float('nan'),'y':.5,'label':1}]},
        {'id':'hair','points':[{'x':.5,'y':.5,'label':2}]},
        {'id':'hair','points':[{'x':.5,'y':.5,'label':True}]},
        {'id':'hair','points':[positive],'point':[.5,.5]},
    ]
    for prompt in invalid: assert request([prompt]).status_code==422

def test_maximum_points_and_box_with_exclusions_are_valid(monkeypatch):
    monkeypatch.setattr(module.engine,'segment',lambda image,prompts:[np.ones((60,40),dtype=bool)])
    assert request([{'id':'hair','points':[{'x':.5,'y':.5,'label':1}]*32}]).status_code==200
    assert request([{'id':'hair','points':[{'x':.5,'y':.5,'label':0}],'box':[0,0,1,1]}]).status_code==200

def test_engine_passes_scaled_coordinates_and_labels_to_predictor(monkeypatch,tmp_path):
    import server.engine as engine_module
    checkpoint=tmp_path/'checkpoint';checkpoint.write_text('fake fixture')
    monkeypatch.setattr(engine_module,'CHECKPOINT',checkpoint)
    captured=[]
    class Predictor:
        def set_image(self,image): assert image.shape==(60,40,3)
        def predict(self,**kwargs):
            captured.append(kwargs)
            return np.ones((1,60,40),dtype=bool),np.array([1.0]),None
    engine=engine_module.SamEngine();engine.predictor=Predictor()
    prompts=[module.Prompt(id='hair',points=[{'x':.25,'y':.3,'label':1},{'x':1,'y':1,'label':0}],box=[0,0,1,1]),
             module.Prompt(id='face',point=[.5,.5])]
    image=Image.new('RGBA',(40,60))
    engine.segment(image,prompts)
    np.testing.assert_array_equal(captured[0]['point_coords'],[[10,18],[39,59]])
    np.testing.assert_array_equal(captured[0]['point_labels'],[1,0])
    np.testing.assert_array_equal(captured[0]['box'],[0,0,40,60])
    np.testing.assert_array_equal(captured[1]['point_coords'],[[20,30]])
    np.testing.assert_array_equal(captured[1]['point_labels'],[1])
