"""Private local process used by inochi_api; never downloads a model or artwork."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import warnings
import zipfile

from PIL import Image, ImageOps, UnidentifiedImageError

ROOT = Path(__file__).resolve().parents[1]
ROLES = {'face_base', 'eye_white_l', 'eye_white_r', 'eye_closed_l', 'eye_closed_r'}
MAX_ARCHIVE_BYTES = 80 * 1024 * 1024


class PreparationFailure(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def decode_image(path):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(path) as source:
                if source.format not in {'PNG', 'JPEG', 'WEBP'}:
                    raise PreparationFailure(415, 'PNG・JPG・WebPを使用してください。')
                if max(source.size) > 4096 or source.width * source.height > 16_000_000:
                    raise PreparationFailure(413, '各辺4096 px以下・1600万画素以下にしてください。')
                return ImageOps.exif_transpose(source).convert('RGBA')
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise PreparationFailure(400, '画像を読み込めませんでした。')


def save_preparation(prepared, directory):
    manifest, pngs = prepared['manifest'], prepared['pngs']
    parts = manifest['parts']
    if len(parts) != 5 or {part['role'] for part in parts} != ROLES:
        raise ValueError('自動準備の5役割が揃っていません。')
    (directory / 'parts').mkdir()
    for part in parts:
        path = f"parts/{part['role']}.png"
        if part.get('path') != path or path not in pngs:
            raise ValueError('自動準備したパーツのパスが正しくありません。')
        data = pngs[path]
        if not isinstance(data, bytes) or not 0 < len(data) <= 8 * 1024 * 1024:
            raise ValueError('自動準備したパーツのサイズが正しくありません。')
        (directory / path).write_bytes(data)
    (directory / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    (directory / 'preparation-report.json').write_text(json.dumps(prepared.get('diagnostics', {}), ensure_ascii=False, indent=2), encoding='utf-8')


def generate(source_path, directory):
    # Also protect direct CLI use: never write prepared images inside the
    # repository before the unchanged Node exporter checks its output path.
    directory = Path(directory).resolve()
    if directory.is_relative_to(ROOT.resolve()) or not directory.is_dir():
        raise PreparationFailure(422, '画像とモデルの出力先には、Git管理外の既存の一時フォルダーを指定してください。')
    from server.inochi_preparation import prepare_inochi_image
    image = decode_image(source_path)
    try:
        prepared = prepare_inochi_image(image)
    finally:
        image.close()
    save_preparation(prepared, directory)
    result = subprocess.run([shutil.which('node') or 'node', str(ROOT / 'scripts/inochi2d/generate.mjs'),
                             str(directory / 'manifest.json'), str(directory / 'model')],
                            cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=40)
    if result.returncode:
        raise PreparationFailure(422, '自動準備した素材からモデルを作れませんでした。画像の大きさや構図を確認してください。')
    pipeline_report = {
        'format': 'ai-live2d-maker-inochi2d-image-pipeline', 'version': 1,
        'automaticPreparation': True, 'manualPointsOrRigging': False,
        'roles': [part['role'] for part in prepared['manifest']['parts']],
        'generator': 'scripts/inochi2d/generate.mjs (unchanged five-part exporter)',
        'creatorVersion': '0.8.6', 'officialCreatorTested': False,
        'appearanceQualityVerified': False, 'live2dCompatible': False,
        'vtubeStudioTested': False, 'containsUploadedOriginalFile': False,
        'notes': ['model-report.json describes only the unchanged PNG-to-model generator; '
                  'the preceding automatic image preparation is described in preparation-report.json.',
                  'The five-part template combines translation and planar tilt in HeadX.',
                  'Creator operation and visual quality must be checked separately for each model.']}
    (directory / 'generation-report.json').write_text(json.dumps(pipeline_report, ensure_ascii=False, indent=2), encoding='utf-8')
    instructions = ('# Inochi2D experimental character model\n\n'
                    'Open model.inp or model.inx in Inochi Creator 0.8.6.\n'
                    'EyeOpenL/R: 0 closed, 1 open (character left/right). HeadX: -1 to 1.\n'
                    'This export uses the original five-part generator. HeadX combines planar movement and tilt.\n'
                    'No independent HeadTilt, facial turn, mouth animation or physics is provided by this minimal export.\n'
                    'Source artwork is prepared by local image processing; generated skin/closed eyelids are estimates.\n'
                    'Generation does not certify appearance, natural motion or Creator operation for this image.\n'
                    'This is Inochi2D, not Live2D Cubism/MOC3. VTube Studio compatibility is not verified.\n'
                    'The source artwork and derived PNGs retain their own rights; no material license is granted here.\n'
                    'The original uploaded image is omitted. This model ZIP is not an app work/recovery ZIP.\n')
    (directory / 'README.txt').write_text(instructions, encoding='utf-8')
    filenames = ['model.inp', 'model.inx', 'model.json', 'model-report.json', 'generation-report.json', 'manifest.json',
                 'preparation-report.json', 'README.txt'] + [part['path'] for part in prepared['manifest']['parts']]
    if sum((directory / name).stat().st_size for name in filenames) > MAX_ARCHIVE_BYTES:
        raise PreparationFailure(413, '生成したモデルが大きすぎます。小さい画像で再実行してください。')
    with zipfile.ZipFile(directory / 'model.zip', 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=5) as archive:
        for name in filenames:
            archive.write(directory / name, name)
    if (directory / 'model.zip').stat().st_size > MAX_ARCHIVE_BYTES:
        raise PreparationFailure(413, '生成したモデルZIPが大きすぎます。')


def main():
    source, output = Path(sys.argv[1]), Path(sys.argv[2])
    try:
        generate(source, output)
    except PreparationFailure as error:
        message, status = str(error), error.status
    except ValueError as error:
        message, status = str(error), 422
    except Exception as error:
        # ModelUnavailable may be provided by either the preparation module or SAM.
        if type(error).__name__ == 'ModelUnavailable':
            message, status = str(error), 503
        else:
            message, status = '画像の自動準備に失敗しました。サーバーの設定を確認してください。', 500
    else:
        return 0
    (output / 'error.json').write_text(json.dumps({'error': message[:2000], 'status': status}, ensure_ascii=False), encoding='utf-8')
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
