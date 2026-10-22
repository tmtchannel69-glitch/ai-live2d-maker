"""HTTP/cancellation/resource checks; these fixtures do not assert anime quality."""
import asyncio
import io
import json
import subprocess
import sys
import types
import zipfile

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from starlette.requests import ClientDisconnect

from server.app import app
from server import inochi_api as api
from server import inochi_worker as worker


def png(width=40, height=60):
    output = io.BytesIO()
    Image.new('RGBA', (width, height), (120, 80, 200, 255)).save(output, 'PNG')
    return output.getvalue()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(api, 'configuration', lambda: (True, ''))
    with TestClient(app) as client:
        yield client
    assert not api.generation_lock.locked()


def post(client, data=None, mime='image/png'):
    return client.post('/api/inochi2d/generate', content=png() if data is None else data,
                       headers={'Content-Type': mime})


def test_status_reports_missing_configuration_and_busy(client, monkeypatch):
    monkeypatch.setattr(api, 'configuration', lambda: (False, 'モデルが未配置です。'))
    response = client.get('/api/inochi2d/status')
    assert response.json() == {'configured': False, 'busy': False, 'creatorVersion': '0.8.6',
                               'experimental': True, 'reason': 'モデルが未配置です。'}
    assert response.headers['cache-control'] == 'no-store'
    assert post(client).status_code == 503
    api.generation_lock.acquire()
    try:
        assert client.get('/api/inochi2d/status').json()['busy'] is True
        assert post(client).status_code == 503
    finally:
        api.generation_lock.release()


def test_upload_mime_empty_and_stream_size_are_bounded(client, monkeypatch):
    async def unexpected(*args):
        pytest.fail('invalid upload must not launch inference')
    monkeypatch.setattr(api, 'run_worker', unexpected)
    assert post(client, b'not an image', 'text/plain').status_code == 415
    assert post(client, b'').status_code == 400
    monkeypatch.setattr(api, 'MAX_INPUT_BYTES', 20)
    assert post(client, b'x' * 21).status_code == 413
    # The accumulated body is checked even when Content-Length is absent.
    response = client.post('/api/inochi2d/generate', content=iter([b'x' * 10, b'y' * 11]),
                           headers={'Content-Type': 'image/png'})
    assert response.status_code == 413


def test_success_returns_zip_and_removes_private_source(client, monkeypatch):
    observed = []
    async def finished(request, directory):
        observed.append(directory)
        assert (directory / 'source-image').read_bytes() == png()
        with zipfile.ZipFile(directory / 'model.zip', 'w') as archive:
            archive.writestr('model.inp', b'TRNSRTS\0fixture')
            archive.writestr('manifest.json', '{}')
        return 0
    monkeypatch.setattr(api, 'run_worker', finished)
    result = post(client)
    assert result.status_code == 200
    assert result.headers['content-type'] == 'application/zip'
    assert 'inochi2d-character.zip' in result.headers['content-disposition']
    assert result.headers['cache-control'] == 'no-store'
    assert not observed[0].exists()
    with zipfile.ZipFile(io.BytesIO(result.content)) as archive:
        assert set(archive.namelist()) == {'model.inp', 'manifest.json'}


@pytest.mark.parametrize('mode,expected', [('diagnostic', 422), ('timeout', 504), ('disconnect', 499)])
def test_failures_clean_images_release_lock_and_allow_retry(client, monkeypatch, mode, expected):
    observed = []
    async def failed(request, directory):
        observed.append(directory)
        if mode == 'timeout':
            raise TimeoutError()
        if mode == 'disconnect':
            raise ClientDisconnect()
        (directory / 'error.json').write_text(json.dumps({'status': 422, 'error': '顔を検出できません。'}))
        return 1
    monkeypatch.setattr(api, 'run_worker', failed)
    first = post(client)
    assert first.status_code == expected
    assert set(first.json()) == {'error'}
    assert not observed[0].exists()
    assert not api.generation_lock.locked()
    assert post(client).status_code == expected


@pytest.mark.parametrize('mode', ['disconnect', 'timeout', 'cancel'])
def test_real_child_process_is_stopped_on_disconnect_timeout_or_cancel(monkeypatch, tmp_path, mode):
    original = asyncio.create_subprocess_exec
    processes = []
    async def child(*args, **kwargs):
        process = await original(sys.executable, '-c', 'import time;time.sleep(30)', **kwargs)
        processes.append(process)
        return process
    class Request:
        checks = 0
        async def is_disconnected(self):
            self.checks += 1
            return mode == 'disconnect' and self.checks >= 2
    monkeypatch.setattr(api.asyncio, 'create_subprocess_exec', child)
    monkeypatch.setattr(api, 'POLL_SECONDS', .01)
    if mode == 'timeout':
        monkeypatch.setattr(api, 'PROCESS_TIMEOUT_SECONDS', .02)
    async def execute():
        task = asyncio.create_task(api.run_worker(Request(), tmp_path))
        if mode == 'cancel':
            while not processes:
                await asyncio.sleep(.005)
            task.cancel()
        with pytest.raises({'disconnect': ClientDisconnect, 'timeout': TimeoutError,
                            'cancel': asyncio.CancelledError}[mode]):
            await task
    asyncio.run(execute())
    assert processes and processes[0].returncode is not None


def test_worker_rejects_broken_or_oversized_image_before_preparation(tmp_path):
    source = tmp_path / 'source'
    source.write_bytes(b'broken')
    with pytest.raises(worker.PreparationFailure) as broken:
        worker.decode_image(source)
    assert broken.value.status == 400
    source.write_bytes(png(4097, 1))
    with pytest.raises(worker.PreparationFailure) as oversized:
        worker.decode_image(source)
    assert oversized.value.status == 413


def test_direct_worker_refuses_repository_output_before_reading_image():
    with pytest.raises(worker.PreparationFailure, match='Git管理外'):
        worker.generate(api.ROOT / 'not-an-image', api.ROOT)


def test_worker_preserves_five_part_generator_and_packages_no_source(monkeypatch, tmp_path):
    fixture = tmp_path / 'fixture'
    subprocess.run(['node', 'scripts/inochi2d/create-fixture.mjs', '--output', str(fixture)],
                   cwd=api.ROOT, check=True, stdout=subprocess.DEVNULL)
    manifest = json.loads((fixture / 'manifest.json').read_text())
    prepared = {'manifest': manifest, 'pngs': {part['path']: (fixture / part['path']).read_bytes()
                                             for part in manifest['parts']},
                'diagnostics': {'syntheticTestOnly': True}}
    preparation = types.ModuleType('server.inochi_preparation')
    preparation.prepare_inochi_image = lambda image: prepared
    monkeypatch.setitem(sys.modules, 'server.inochi_preparation', preparation)
    output = tmp_path / 'output'
    output.mkdir()
    source = output / 'source-image'
    source.write_bytes(png())
    worker.generate(source, output)
    with zipfile.ZipFile(output / 'model.zip') as archive:
        assert 'source-image' not in archive.namelist()
        assert len([name for name in archive.namelist() if name.startswith('parts/')]) == 5
        assert archive.read('model.inp') == archive.read('model.inx')
        assert archive.read('model.inp').startswith(b'TRNSRTS\0')
        report = json.loads(archive.read('model-report.json'))
        assert report['officialCreatorTested'] is False
        assert report['live2dCompatible'] is False
        assert report['vtubeStudioTested'] is False
        pipeline = json.loads(archive.read('generation-report.json'))
        assert pipeline['officialCreatorTested'] is False
        assert pipeline['appearanceQualityVerified'] is False
        for part in manifest['parts']:
            assert archive.read(part['path']) == prepared['pngs'][part['path']]
