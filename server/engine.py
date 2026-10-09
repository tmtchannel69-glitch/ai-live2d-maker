"""CPU SAM 2.1 adapter. No automatic downloads and no external image requests."""
import os
from scripts.download_sam import digest, SHA256
from pathlib import Path
import numpy as np

CHECKPOINT = Path(os.environ.get('SAM2_CHECKPOINT', '.models/sam2.1_hiera_tiny.pt'))

class ModelUnavailable(RuntimeError):
    pass

class SamEngine:
    def __init__(self):
        self.predictor = None

    def segment(self, image, prompts):
        if not CHECKPOINT.is_file():
            raise ModelUnavailable('SAM のモデルが未配置です。管理者が公式モデルを導入してから再実行してください。')
        import torch
        if self.predictor is None:
            if digest(CHECKPOINT) != SHA256:
                raise ModelUnavailable('モデルの検証に失敗しました。公式モデルを確認してください。')
            from sam2.build_sam import build_sam2
            from sam2.sam2_image_predictor import SAM2ImagePredictor
            torch.set_num_threads(min(4, os.cpu_count() or 1))
            self.predictor = SAM2ImagePredictor(build_sam2(
                'configs/sam2.1/sam2.1_hiera_t.yaml', str(CHECKPOINT), device='cpu',
            ))
        width, height = image.size
        with torch.inference_mode():
            self.predictor.set_image(np.array(image.convert('RGB'), copy=True))
            outputs = []
            for prompt in prompts:
                points = prompt.all_points
                box = prompt.box
                masks, scores, _ = self.predictor.predict(
                    point_coords=np.array([[min(width - 1, p.x * width), min(height - 1, p.y * height)] for p in points]) if points else None,
                    point_labels=np.array([p.label for p in points]) if points else None,
                    box=np.array([box[0] * width, box[1] * height, box[2] * width, box[3] * height]) if box else None,
                    multimask_output=True,
                )
                mask = masks[int(np.argmax(scores))].astype(bool)
                if not mask.any():
                    raise ValueError('対象が見つかりません。点や枠を変更してください。')
                outputs.append(mask)
            return outputs
