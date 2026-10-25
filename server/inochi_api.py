"""Bounded, local-only one-image Inochi2D generation.

Image work runs in a disposable process group: cancelling a browser request also
stops inference/export, and every temporary image is removed afterwards.
"""
import asyncio
import json
import os
from pathlib import Path
import shutil
import signal
import sys
import tempfile
import threading
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from starlette.requests import ClientDisconnect

router = APIRouter(prefix='/api/inochi2d')
ROOT = Path(__file__).resolve().parents[1]
MAX_INPUT_BYTES = 10 * 1024 * 1024
MAX_ARCHIVE_BYTES = 80 * 1024 * 1024
PROCESS_TIMEOUT_SECONDS = 150
DETAILED_TIMEOUT_SECONDS = 600
MAX_WORKDIR_BYTES = 256 * 1024 * 1024
MAX_WORKDIR_FILES = 512
POLL_SECONDS = .15
generation_lock = threading.Lock()


class OutputLimitExceeded(RuntimeError):
    pass


def selected_mode(request):
    mode = request.query_params.get('mode', 'five')
    return mode if mode in ('five', 'detailed-head') else None


def detailed_configuration():
    try:
        from server.inochi_detailed import check_configuration
        return check_configuration()
    except (ImportError, OSError, ValueError):
        return {'configured': False, 'components': [],
                'reason': '詳細モードのPython依存を準備してください。モデルの自動取得は行いません。',
                'automaticDownloads': False, 'externalImageRequests': False}


def configuration():
    """No image inference or network downloads are performed by status checks."""
    try:
        from server.inochi_preparation import check_configuration
        prepared = check_configuration()
        ready = prepared if isinstance(prepared, bool) else prepared.get('configured', False)
        reason = '' if ready else (prepared.get('reason', '') if isinstance(prepared, dict) else '')
    except (ImportError, OSError):
        ready, reason = False, '画像の自動準備モジュール・依存ライブラリを準備してください。'
    if not shutil.which('node') or not (ROOT / 'scripts/inochi2d/generate.mjs').is_file():
        ready, reason = False, 'Node.jsとInochi2D生成スクリプトを準備してください。'
    return bool(ready), reason


def failure(status, message):
    return JSONResponse({'error': message}, status_code=status, headers={'Cache-Control': 'no-store'})


@router.get('/status')
async def status(request: Request):
    mode = selected_mode(request)
    if mode is None:
        return failure(400, '対応していない生成モードです。')
    if mode == 'detailed-head':
        result = await asyncio.to_thread(detailed_configuration)
        return JSONResponse({**result, 'mode': mode, 'busy': generation_lock.locked(),
                             'creatorVersion': '0.8.6', 'experimental': True,
                             'scope': 'head-motion-fixed-body', 'maxArchiveBytes': MAX_ARCHIVE_BYTES,
                             'timeoutSeconds': DETAILED_TIMEOUT_SECONDS}, headers={'Cache-Control': 'no-store'})
    ready, reason = await asyncio.to_thread(configuration)
    result = {'configured': ready, 'busy': generation_lock.locked(),
              'creatorVersion': '0.8.6', 'experimental': True}
    if reason:
        result['reason'] = reason
    return JSONResponse(result, headers={'Cache-Control': 'no-store'})


async def stop_process(process):
    if process.returncode is not None and os.name != 'posix':
        return
    try:
        if os.name == 'posix':
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
        await asyncio.wait_for(process.wait(), .7)
    except ProcessLookupError:
        pass
    except asyncio.TimeoutError:
        try:
            if os.name == 'posix':
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        except ProcessLookupError:
            pass
        await process.wait()
    finally:
        # Also clean descendants after the parent has already exited.
        if os.name == 'posix':
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def check_workdir(directory):
    total = count = 0
    for path in directory.rglob('*'):
        if path.is_symlink():
            raise OutputLimitExceeded()
        if path.is_file():
            count += 1
            try:
                total += path.stat().st_size
            except FileNotFoundError:
                continue
            if count > MAX_WORKDIR_FILES or total > MAX_WORKDIR_BYTES:
                raise OutputLimitExceeded()


async def run_worker(request, directory, mode='five'):
    """Returns process exit code; log content remains private and bounded on disk."""
    process = wait_task = None
    with (directory / 'worker.log').open('wb') as log:
        try:
            process = await asyncio.create_subprocess_exec(
                sys.executable, '-m', 'server.inochi_worker',
                str(directory / 'source-image'), str(directory), *([mode] if mode != 'five' else []),
                cwd=ROOT, stdout=log, stderr=log, start_new_session=os.name == 'posix')
            wait_task = asyncio.create_task(process.wait())
            started = time.monotonic()
            while process.returncode is None:
                if await request.is_disconnected():
                    raise ClientDisconnect()
                if time.monotonic() - started > (DETAILED_TIMEOUT_SECONDS if mode == 'detailed-head' else PROCESS_TIMEOUT_SECONDS):
                    raise TimeoutError()
                check_workdir(directory)
                if (directory / 'worker.log').stat().st_size > 2 * 1024 * 1024:
                    raise RuntimeError('worker log limit')
                try:
                    await asyncio.wait_for(asyncio.shield(wait_task), POLL_SECONDS)
                except asyncio.TimeoutError:
                    pass
            return process.returncode
        finally:
            if process is not None:
                await stop_process(process)
            if wait_task is not None and not wait_task.done():
                wait_task.cancel()


@router.post('/generate')
async def generate(request: Request):
    mode = selected_mode(request)
    if mode is None:
        return failure(400, '対応していない生成モードです。')
    mime = request.headers.get('content-type', '').split(';')[0].strip().lower()
    if mime not in {'image/png', 'image/jpeg', 'image/webp'}:
        return failure(415, 'PNG・JPG・WebPの画像を送信してください。')
    try:
        size = int(request.headers.get('content-length', '0'))
    except ValueError:
        return failure(400, '画像のサイズが正しくありません。')
    if size < 0 or size > MAX_INPUT_BYTES:
        return failure(413, '画像は10 MB以下にしてください。')
    if not generation_lock.acquire(blocking=False):
        return failure(503, '別のモデルを生成中です。少し待って再実行してください。')
    try:
        if mode == 'detailed-head':
            preparation = await asyncio.to_thread(detailed_configuration)
            ready, reason = preparation['configured'], preparation.get('reason', '')
        else:
            ready, reason = await asyncio.to_thread(configuration)
        if not ready:
            return failure(503, reason or '自動生成サーバーの準備ができていません。')
        with tempfile.TemporaryDirectory(prefix='ai-live2d-inochi-') as temporary:
            directory = Path(temporary)
            received = 0
            with (directory / 'source-image').open('wb') as image:
                async for chunk in request.stream():
                    received += len(chunk)
                    if received > MAX_INPUT_BYTES:
                        return failure(413, '画像は10 MB以下にしてください。')
                    image.write(chunk)
            if received == 0:
                return failure(400, '画像を選択してください。')
            code = await run_worker(request, directory, mode) if mode == 'detailed-head' else await run_worker(request, directory)
            if code != 0:
                error_path = directory / 'error.json'
                if error_path.is_file() and error_path.stat().st_size <= 8192:
                    try:
                        error = json.loads(error_path.read_text(encoding='utf-8'))
                        if error.get('status') in {400, 413, 415, 422, 503, 504} and isinstance(error.get('error'), str):
                            return failure(error['status'], error['error'][:2000])
                    except (ValueError, OSError):
                        pass
                return failure(500, 'モデル生成に失敗しました。サーバーの設定を確認して再実行してください。')
            archive = directory / 'model.zip'
            if not archive.is_file() or not 0 < archive.stat().st_size <= MAX_ARCHIVE_BYTES:
                return failure(413, '生成したモデルのサイズが上限を超えています。')
            data = await asyncio.to_thread(archive.read_bytes)
            if not 0 < len(data) <= MAX_ARCHIVE_BYTES:
                return failure(413, '生成したモデルのサイズが上限を超えています。')
            name = 'inochi2d-head-neck-body.zip' if mode == 'detailed-head' else 'inochi2d-character.zip'
            return Response(data, media_type='application/zip', headers={
                'Content-Disposition': f'attachment; filename="{name}"',
                'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
    except ClientDisconnect:
        return failure(499, '画像の送信またはモデル生成を中止しました。')
    except TimeoutError:
        return failure(504, 'モデル生成が制限時間を超えました。小さな正面画像で再実行してください。')
    except OutputLimitExceeded:
        return failure(413, '処理中のファイル数またはサイズが上限を超えました。小さい画像で再実行してください。')
    except asyncio.CancelledError:
        raise
    except Exception:
        return failure(500, 'モデル生成に失敗しました。サーバーを確認して再実行してください。')
    finally:
        generation_lock.release()
