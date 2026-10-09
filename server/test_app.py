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
