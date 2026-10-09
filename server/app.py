"""Local prototype, not a public deployment. Images are not retained; multipart parsing may use temporary files."""
import base64
import io
import json
import threading
import warnings
from PIL import Image, ImageOps, UnidentifiedImageError
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from typing import Literal
from server.engine import SamEngine, CHECKPOINT, ModelUnavailable

app = FastAPI(title='AI Live2D Maker local prototype')
engine = SamEngine()
lock = threading.Lock()
PARTS = {'hair', 'face', 'body', 'eyes'}

class MaskPoint(BaseModel):
    model_config = ConfigDict(extra='forbid')
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    label: Literal[0, 1]

    @field_validator('label', mode='before')
    @classmethod
    def strict_label(cls, value):
        if type(value) is not int:
            raise ValueError('点の種類は整数の 0 または 1 にしてください。')
        return value


class Prompt(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str
    # Preserve legacy one-point/one-box clients.
    point: tuple[float, float] | None = None
    points: list[MaskPoint] | None = Field(default=None, min_length=1, max_length=32)
    box: tuple[float, float, float, float] | None = None

    @model_validator(mode='after')
    def validate_prompt(self):
        if self.id not in PARTS:
            raise ValueError('不明なパーツです。')
        if self.point is not None:
            if self.points is not None or self.box is not None:
                raise ValueError('旧式の点指定を他の指定と混ぜないでください。')
            if not all(0 <= value <= 1 for value in self.point):
                raise ValueError('座標は 0 から 1 の範囲で指定してください。')
        if self.box is not None:
            if not all(0 <= value <= 1 for value in self.box):
                raise ValueError('座標は 0 から 1 の範囲で指定してください。')
            if self.box[0] >= self.box[2] or self.box[1] >= self.box[3]:
                raise ValueError('枠には幅と高さが必要です。')
        if self.point is None and self.box is None and not any(p.label == 1 for p in self.points or []):
            raise ValueError('残す点または枠を指定してください。')
        return self

    @property
    def all_points(self):
        if self.point is not None:
            return [MaskPoint(x=self.point[0], y=self.point[1], label=1)]
        return self.points or []

@app.get('/api/health')
def health():
    return {'mode': 'sam2.1-cpu', 'checkpoint_present': CHECKPOINT.is_file(),
            'model_loaded': engine.predictor is not None, 'public_deployment': False,
            'multiple_points': True, 'max_points_per_part': 32}

@app.post('/api/separate')
def separate(image: UploadFile = File(...), prompts: str = Form(...)):
    if len(prompts) > 32768:
        raise HTTPException(422, '指定データが大きすぎます。')
    try:
        raw = json.loads(prompts)
        if not isinstance(raw, list) or not 1 <= len(raw) <= 4:
            raise ValueError()
        parsed = [Prompt.model_validate(value) for value in raw]
        if len({prompt.id for prompt in parsed}) != len(parsed):
            raise ValueError()
    except (ValueError, TypeError, ValidationError):
        raise HTTPException(422, '各パーツに正しい残す点または枠を指定してください（点は最大 32 個）。')
    data = image.file.read(10 * 1024 * 1024 + 1)
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, '画像は 10 MB 以下にしてください。')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if source.format not in {'PNG', 'JPEG', 'WEBP'}:
                    raise HTTPException(415, 'PNG・JPG・WebP を使用してください。')
                if max(source.size) > 4096 or source.width * source.height > 16_000_000:
                    raise HTTPException(413, '各辺 4096 px 以下・1600 万画素以下にしてください。')
                decoded = ImageOps.exif_transpose(source).convert('RGBA')
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(400, '画像を読み込めませんでした。')
    if not lock.acquire(blocking=False):
        decoded.close()
        raise HTTPException(503, '別の処理を実行中です。少し待って再実行してください。')
    try:
        masks = engine.segment(decoded, parsed)
        if len(masks) != len(parsed):
            raise ValueError('分離結果の数が一致しません。')
        import numpy as np
        results = []
        original = np.asarray(decoded)
        for prompt, mask in zip(parsed, masks):
            if mask.shape != (decoded.height, decoded.width):
                raise ValueError('分離結果のサイズが一致しません。')
            pixels = original.copy()
            pixels[:, :, 3] = np.where(mask, pixels[:, :, 3], 0)
            if not pixels[:, :, 3].any():
                raise ValueError('透明な領域だけが選ばれました。点や枠を変更してください。')
            stream = io.BytesIO()
            Image.fromarray(pixels).save(stream, format='PNG')
            results.append({'id': prompt.id, 'name': prompt.id + '.png',
                            'png': base64.b64encode(stream.getvalue()).decode('ascii')})
        return {'model': 'sam2.1-hiera-tiny', 'width': decoded.width, 'height': decoded.height, 'parts': results}
    except ModelUnavailable as error:
        raise HTTPException(503, str(error))
    except ValueError as error:
        raise HTTPException(422, str(error))
    except Exception:
        raise HTTPException(500, 'AI 処理に失敗しました。サーバーの準備を確認して再実行してください。')
    finally:
        lock.release()
        decoded.close()
