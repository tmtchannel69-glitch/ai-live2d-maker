"""Opt-in, bounded app adapter for the existing independent-head CLI.

No downloads, manual prompts, external image APIs or changes to the five-part
generator. The output contains generated layers, never the uploaded image.
"""
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import zipfile

from server.inochi_worker import PreparationFailure, decode_image
from server.inochi_review import create_review

ROOT = Path(__file__).resolve().parents[1]
MODE = 'detailed-head'
MAX_ARCHIVE_BYTES = 80 * 1024 * 1024
MAX_ARCHIVE_FILES = 256
CLI_TIMEOUT_SECONDS = 540


def check_configuration():
    """Presence only: no inference, hashing of large weights or downloads."""
    from server.inochi_preparation import check_configuration as five_configuration
    from server.engine import CHECKPOINT
    base = five_configuration()
    checks = [
        {'id': 'five-part', 'label': '顔検出・背景除去の準備', 'ready': bool(base['configured'])},
        {'id': 'sam-weight', 'label': 'SAM2.1 Tinyのモデル重み', 'ready': CHECKPOINT.is_file() and CHECKPOINT.stat().st_size > 0},
        {'id': 'node', 'label': 'Node.js', 'ready': bool(shutil.which('node'))},
    ]
    for package, label in [('torch', 'PyTorch'), ('torchvision', 'torchvision'), ('sam2', 'SAM2'), ('scipy', 'SciPy')]:
        checks.append({'id': package, 'label': label, 'ready': importlib.util.find_spec(package) is not None})
    for name in ['scripts/parts/rig.py', 'scripts/inochi2d/head-rig.mjs', 'scripts/inochi2d/parts-adapter.mjs',
                 'scripts/inochi2d/render-head.py', 'scripts/inochi2d/render-diagnostic.py',
                 'node_modules/fast-png/package.json', 'node_modules/fflate/package.json']:
        checks.append({'id': name, 'label': name, 'ready': (ROOT / name).is_file()})
    missing = [c['label'] for c in checks if not c['ready']]
    if not base['configured']:
        missing += base.get('missing_packages', [])
        missing += [name for name, ready in base.get('models', {}).items() if not ready]
    return {'configured': not missing, 'components': checks,
            'reason': '不足している準備: ' + '、'.join(missing) + '。READMEの詳細モードの準備手順を確認してください。自動取得は行いません。' if missing else '',
            'automaticDownloads': False, 'externalImageRequests': False}


def package_trial(trial, directory):
    """Explicit generated-file allowlist, bounded before ZIP compression."""
    graph = json.loads((trial / 'common/parts.json').read_text(encoding='utf-8'))
    report = json.loads((trial / 'trial-report.json').read_text(encoding='utf-8'))
    if not report.get('file_generation_passed') or not report.get('automatic_head_diagnostic_passed'):
        raise PreparationFailure(422, '頭・首・胴体モデルの自動検査が完了していません。')
    entries = {
        'model.inp': trial / 'head/model.inp', 'model.inx': trial / 'head/model.inx',
        'model.json': trial / 'head/model.json', 'model-report.json': trial / 'head/model.report.json',
        'model.layout.json': trial / 'head/model.layout.json', 'common/parts.json': trial / 'common/parts.json',
        'preparation-report.json': trial / 'head/preparation-report.json',
        'head-quality-report.json': trial / 'head-quality/head-quality-report.json',
        'blink-quality-report.json': trial / 'blink-quality/quality-report.json',
        'trial-report.json': trial / 'trial-report.json', 'provenance.json': trial / 'provenance.json',
    }
    # Only assets referenced by the final graph, not stale files, diagnostics,
    # the source JPEG, a reconstructed one-piece image or CLI comparisons.
    for part in graph['parts']:
        for plane in ('observed', 'completion'):
            for field in ('rgba', 'mask'):
                name = part.get(plane, {}).get(field)
                if not name:
                    continue
                path = PurePosixPath(name)
                if path.is_absolute() or '..' in path.parts or str(path) != name or path.suffix != '.png' or '\\' in name:
                    raise PreparationFailure(422, '生成パーツの保存先が正しくありません。')
                entries['common/' + name] = trial / 'common' / name
    entries.update(create_review(trial, directory, graph))
    pipeline = {'format': 'ai-live2d-maker-detailed-head-app-pipeline', 'version': 2, 'mode': MODE,
                'scope': 'independent-head-motion-with-fixed-body', 'automaticPreparation': True,
                'manualPointsOrRigging': False, 'parts': len(graph['parts']), 'creatorVersion': '0.8.6',
                'officialCreatorTested': False, 'appearanceQualityVerified': False,
                'live2dCompatible': False, 'vtubeStudioTested': False,
                'containsUploadedOriginalFile': False, 'containsPreparationReconstruction': False,
                'containsModelRenderedComparisons': True, 'reviewManifest': 'review/review.json',
                'externalImageRequests': False, 'automaticDownloads': False,
                'generator': 'scripts/parts/rig.py --stage head (existing CLI)',
                'limitations': ['Head motion only; the body is fixed. Not full-body rigging.',
                                'Hidden anatomy, hair depth and natural motion are unverified estimates.']}
    (directory / 'generation-report.json').write_text(json.dumps(pipeline, ensure_ascii=False, indent=2), encoding='utf-8')
    (directory / 'README.txt').write_text(
        'Inochi2D independent head/neck/body experiment\n\n'
        'Open model.inp or model.inx in Inochi Creator 0.8.6.\n'
        'EyeOpenL/R: blink. HeadX: small planar translation. HeadTilt: small Z tilt.\n'
        'The body stays fixed. No full-body rigging, 3D face turn, mouth motion or hair physics.\n'
        'Hidden surfaces and hair order are estimates; natural appearance is not certified.\n'
        'Generation and CPU checks do not certify this model in the official Creator.\n'
        'This is Inochi2D legacy 0.8.6, not Live2D Cubism/MOC3 or VTube Studio.\n'
        'The original upload and one-piece reconstruction are excluded.\n'
        'review/ contains bounded model-rendered comparisons from the existing CPU diagnostics.\n'
        'These are discrete images, not an official Creator or browser runtime.\n'
        'Reopen this ZIP using the model ZIP review button in the app; no image upload is needed.\n'
        'Generated layers and their masks remain in common/. This is not an app recovery ZIP.\n', encoding='utf-8')
    entries.update({'generation-report.json': directory / 'generation-report.json', 'README.txt': directory / 'README.txt'})
    total = 0
    if len(entries) > MAX_ARCHIVE_FILES:
        raise PreparationFailure(413, '生成ファイル数が上限を超えています。')
    for path in entries.values():
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(directory.resolve()):
            raise PreparationFailure(422, '生成ファイルが不足しているか保存先が正しくありません。')
        total += path.stat().st_size
        if total > MAX_ARCHIVE_BYTES:
            raise PreparationFailure(413, '展開後のモデル一式が80 MBを超えています。小さい画像で再実行してください。')
    archive = directory / 'model.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=5) as output:
        for name, path in entries.items():
            output.write(path, name)
    if not 0 < archive.stat().st_size <= MAX_ARCHIVE_BYTES:
        archive.unlink(missing_ok=True)
        raise PreparationFailure(413, 'モデルZIPが80 MBを超えています。')


def generate(source, directory):
    directory = Path(directory).resolve()
    if directory.is_relative_to(ROOT) or not directory.is_dir():
        raise PreparationFailure(422, '画像とモデルの出力先にはGit管理外の一時フォルダーを指定してください。')
    readiness = check_configuration()
    if not readiness['configured']:
        raise PreparationFailure(503, readiness['reason'])
    with decode_image(source):
        pass
    trial, errors = directory / 'trial', directory / 'detailed-error.json'
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/parts/rig.py'), '--source', str(source),
                             '--output', str(trial), '--stage', 'head', '--error-report', str(errors)],
                            cwd=ROOT, timeout=CLI_TIMEOUT_SECONDS,
                            env={**os.environ, 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1'})
    if result.returncode:
        if errors.is_file() and errors.stat().st_size <= 8192:
            data = json.loads(errors.read_text(encoding='utf-8'))
            if data.get('status') in (400, 413, 415, 422, 503, 504) and isinstance(data.get('error'), str):
                message = data['error'][:2000]
                if data['status'] == 422 and message.isascii():
                    message = 'この画像から頭・首・胴体を安全に分けられませんでした。顔と首がはっきり見える正面画像で試すか、従来の5パーツを選んでください。'
                raise PreparationFailure(data['status'], message)
        raise PreparationFailure(500, '頭・首・胴体の自動処理に失敗しました。ローカルサーバーのログを確認してください。')
    package_trial(trial, directory)
