"""Local adapter/resource tests. Synthetic packaging is not Creator evidence."""
import asyncio
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from server.app import app
from server import inochi_api as api, inochi_detailed as detailed
from server.inochi_worker import PreparationFailure
from PIL import Image


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(api, 'configuration', lambda: (True, ''))
    monkeypatch.setattr(api, 'detailed_configuration', lambda: {'configured': True, 'components': [], 'automaticDownloads': False, 'externalImageRequests': False})
    with TestClient(app) as client:
        yield client
    assert not api.generation_lock.locked()


def test_mode_status_preflight_missing_and_invalid_mode_do_not_launch_workers(client, monkeypatch):
    monkeypatch.setattr(api, 'detailed_configuration', lambda: {'configured': False, 'reason': 'SAM2.1の重みが未配置です。自動取得は行いません。', 'components': []})
    async def unexpected(*args):
        pytest.fail('Not configured or invalid mode must not start inference')
    monkeypatch.setattr(api, 'run_worker', unexpected)
    state = client.get('/api/inochi2d/status?mode=detailed-head')
    assert state.json()['mode'] == 'detailed-head' and state.json()['configured'] is False
    assert state.json()['maxArchiveBytes'] == 80 * 1024 * 1024
    assert state.headers['cache-control'] == 'no-store'
    assert client.get('/api/inochi2d/status').json()['configured'] is True
    assert client.post('/api/inochi2d/generate?mode=detailed-head', content=b'not read', headers={'Content-Type': 'image/png'}).status_code == 503
    for method in [client.get, client.post]:
        assert method('/api/inochi2d/generate?mode=unknown').status_code in (400, 405)
    assert client.get('/api/inochi2d/status?mode=unknown').status_code == 400


def test_head_worker_dispatch_zip_and_temp_cleanup(client, monkeypatch):
    outputs = []
    async def finish(request, directory, mode):
        assert mode == 'detailed-head'
        outputs.append(directory)
        assert (directory / 'source-image').read_bytes() == b'fixture upload'
        with zipfile.ZipFile(directory / 'model.zip', 'w') as z:
            z.writestr('model.inp', b'TRNSRTS\0packaging fixture')
        return 0
    monkeypatch.setattr(api, 'run_worker', finish)
    response = client.post('/api/inochi2d/generate?mode=detailed-head', content=b'fixture upload', headers={'Content-Type': 'image/png'})
    assert response.status_code == 200 and 'inochi2d-head-neck-body.zip' in response.headers['content-disposition']
    assert not outputs[0].exists()


def trial_fixture(tmp_path):
    trial = tmp_path / 'trial'
    files = {'head/model.inp': b'TRNSRTS\0fixture', 'head/model.inx': b'TRNSRTS\0fixture',
             'head/model.json': b'{}', 'head/model.report.json': b'{}', 'head/model.layout.json': b'{}',
             'head/preparation-report.json': b'{}', 'head-quality/head-quality-report.json': b'{}',
             'blink-quality/quality-report.json': b'{}', 'provenance.json': b'{}',
             'common/observed/head.png': b'part fixture', 'common/unlisted-source-copy.png': b'original upload bytes',
             'neutral-reconstruction.png': b'one-piece image',
             'common/parts.json': json.dumps({'source': {'width': 16, 'height': 16}, 'parts': [{'observed': {'rgba': 'observed/head.png'}, 'completion': {}}]}).encode(),
             'trial-report.json': json.dumps({'file_generation_passed': True, 'automatic_head_diagnostic_passed': True}).encode()}
    for name, data in files.items():
        p = trial / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    blink = {'source_roi': [0, 0, 16, 16], 'frames': [{'opening': n / 9} for n in range(10)]}
    poses = ['neutral', 'shift_left', 'shift_right', 'tilt_left', 'tilt_right',
             'combined_left', 'combined_right', 'opposed_left', 'opposed_right', 'neutral_return']
    head = {'poses': [{'pose': name, 'head_x': 0, 'head_tilt': 0} for name in poses]}
    (trial / 'blink-quality/quality-report.json').write_text(json.dumps(blink))
    (trial / 'head-quality/head-quality-report.json').write_text(json.dumps(head))
    for name in [f'blink-quality/blink_{n:02d}.png' for n in range(10)] + [f'head-quality/after-{p}.png' for p in poses]:
        Image.new('RGBA', (16, 16), (30, 40, 50, 128)).save(trial / name)
    (tmp_path / 'source-image').write_bytes(b'original upload bytes')
    return trial


def test_packaging_only_declared_generated_files_never_source_or_reconstruction(tmp_path):
    trial = trial_fixture(tmp_path)
    detailed.package_trial(trial, tmp_path)
    with zipfile.ZipFile(tmp_path / 'model.zip') as z:
        assert z.testzip() is None
        assert not any('source-copy' in n or n == 'source-image' or 'reconstruction' in n for n in z.namelist())
        assert 'common/observed/head.png' in z.namelist()
        assert all(z.read(n) != b'original upload bytes' for n in z.namelist())
        report = json.loads(z.read('generation-report.json'))
        assert report['officialCreatorTested'] is False and report['appearanceQualityVerified'] is False
        assert report['scope'] == 'independent-head-motion-with-fixed-body'
        assert report['containsUploadedOriginalFile'] is False
        assert report['version'] == 2 and report['containsPreparationReconstruction'] is False
        assert report['containsModelRenderedComparisons'] is True
        review = json.loads(z.read('review/review.json'))
        assert [v['id'] for v in review['views']] == ['head', 'blink']
        assert all(len(v['frames']) == 10 for v in review['views'])
        assert review['official_creator_tested'] is False and review['appearance_quality_passed'] is False
        assert z.read('model.inp') == (trial / 'head/model.inp').read_bytes()
        assert len([n for n in z.namelist() if n.startswith('review/') and n.endswith('.png')]) == 20


def test_review_rejects_missing_or_unexpected_pose_instead_of_substituting(tmp_path):
    trial = trial_fixture(tmp_path)
    report = trial / 'head-quality/head-quality-report.json'
    data = json.loads(report.read_text())
    data['poses'][0]['pose'] = '../../source-image'
    report.write_text(json.dumps(data))
    with pytest.raises(PreparationFailure, match='比較状態'):
        detailed.package_trial(trial, tmp_path)
    assert not (tmp_path / 'model.zip').exists()


def test_review_thumbnail_preserves_alpha_and_never_copies_original(tmp_path):
    from server.inochi_review import create_review
    trial = trial_fixture(tmp_path)
    for path in (trial / 'head-quality').glob('*.png'):
        Image.new('RGBA', (960, 1280), (20, 40, 60, 128)).save(path)
    graph = json.loads((trial / 'common/parts.json').read_text())
    entries = create_review(trial, tmp_path, graph)
    assert len(entries) == 21
    with Image.open(entries['review/head-00.png']) as image:
        assert image.size == (480, 640) and image.getextrema()[3] == (128, 128)


@pytest.mark.parametrize('limit', ['bytes', 'files', 'symlink'])
def test_archive_limits_and_symlinks_reject_before_zip_write(tmp_path, monkeypatch, limit):
    trial = trial_fixture(tmp_path)
    if limit == 'bytes': monkeypatch.setattr(detailed, 'MAX_ARCHIVE_BYTES', 1)
    elif limit == 'files': monkeypatch.setattr(detailed, 'MAX_ARCHIVE_FILES', 1)
    else:
        p = trial / 'common/observed/head.png'
        p.unlink()
        p.symlink_to(tmp_path / 'source-image')
    with pytest.raises(PreparationFailure): detailed.package_trial(trial, tmp_path)
    assert not (tmp_path / 'model.zip').exists()


def test_actual_worker_module_reports_missing_sam_as_503_without_loading_or_download(tmp_path):
    source = tmp_path / 'source-image'
    source.write_bytes(b'not decoded while configuration is missing')
    result = subprocess.run([sys.executable, '-m', 'server.inochi_worker', str(source), str(tmp_path), 'detailed-head'],
                            cwd=api.ROOT, env={**os.environ, 'SAM2_CHECKPOINT': str(tmp_path / 'missing-weight.pt')}, capture_output=True, timeout=15)
    assert result.returncode == 1
    assert json.loads((tmp_path / 'error.json').read_text())['status'] == 503
    assert not (tmp_path / 'trial').exists() and not (tmp_path / 'model.zip').exists()


def test_working_directory_has_total_size_and_file_count_limits(tmp_path, monkeypatch):
    (tmp_path / 'large').write_bytes(b'x' * 50)
    monkeypatch.setattr(api, 'MAX_WORKDIR_BYTES', 49)
    with pytest.raises(api.OutputLimitExceeded): api.check_workdir(tmp_path)
    monkeypatch.setattr(api, 'MAX_WORKDIR_BYTES', 100)
    monkeypatch.setattr(api, 'MAX_WORKDIR_FILES', 0)
    with pytest.raises(api.OutputLimitExceeded): api.check_workdir(tmp_path)


def test_cli_errors_are_user_readable_and_preserve_the_original_input(tmp_path, monkeypatch):
    source = tmp_path / 'source-image'
    source.write_bytes(b'private input fixture')
    monkeypatch.setattr(detailed, 'check_configuration', lambda: {'configured': True})
    monkeypatch.setattr(detailed, 'decode_image', lambda _: Image.new('RGBA', (40, 60)))
    def fail(args, **kwargs):
        assert '--stage' in args and args[args.index('--stage') + 1] == 'head'
        assert kwargs['env']['HF_HUB_OFFLINE'] == '1'
        Path(args[args.index('--error-report') + 1]).write_text(json.dumps({'status': 422, 'error': 'No continuous jaw outline'}))
        return SimpleNamespace(returncode=1)
    monkeypatch.setattr(detailed.subprocess, 'run', fail)
    with pytest.raises(PreparationFailure, match='顔と首') as error:
        detailed.generate(source, tmp_path)
    assert error.value.status == 422
    assert source.read_bytes() == b'private input fixture'


def test_subprocess_timeouts_keep_the_504_status_through_worker_and_api(client, tmp_path, monkeypatch):
    from server import inochi_worker as worker
    def expired(*args): raise subprocess.TimeoutExpired('local-cli', 540)
    monkeypatch.setattr(worker, 'generate', expired)
    monkeypatch.setattr(sys, 'argv', ['worker', str(tmp_path / 'source-image'), str(tmp_path)])
    assert worker.main() == 1
    error = json.loads((tmp_path / 'error.json').read_text())
    assert error['status'] == 504
    async def finished(request, directory, mode):
        (directory / 'error.json').write_text(json.dumps(error))
        return 1
    monkeypatch.setattr(api, 'run_worker', finished)
    response = client.post('/api/inochi2d/generate?mode=detailed-head', content=b'fixture', headers={'Content-Type': 'image/png'})
    assert response.status_code == 504 and '制限時間' in response.json()['error']


@pytest.mark.skipif(os.name != 'posix', reason='Private Unix process-group cleanup')
def test_finished_parent_cannot_leave_a_child_ignoring_term(monkeypatch, tmp_path):
    create = asyncio.create_subprocess_exec
    script = ("import os,signal,time; pid=os.fork(); "
              "signal.signal(signal.SIGTERM,signal.SIG_IGN) if pid==0 else None; "
              f"open({str(tmp_path / 'child.pid')!r},'w').write(str(os.getpid())) if pid==0 else None; "
              "time.sleep(30 if pid==0 else .2)")
    async def child(*args, **kwargs): return await create(sys.executable, '-c', script, **kwargs)
    class Request:
        async def is_disconnected(self): return False
    monkeypatch.setattr(api.asyncio, 'create_subprocess_exec', child)
    monkeypatch.setattr(api, 'POLL_SECONDS', .02)
    assert asyncio.run(api.run_worker(Request(), tmp_path)) == 0
    pid = int((tmp_path / 'child.pid').read_text())
    import time
    for _ in range(50):
        path = Path(f'/proc/{pid}/stat')
        if not path.exists() or path.read_text().split()[2] == 'Z': break
        time.sleep(.01)
    else: pytest.fail('The worker left a running child process')
