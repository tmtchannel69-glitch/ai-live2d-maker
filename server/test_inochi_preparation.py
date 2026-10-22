"""Adapter invariants, using original drawn shapes rather than user artwork.

Injected face detection in unit tests is deliberately not an end-to-end face
detection or real-character quality pass. A real-image/Creator report is separate.
"""
import io
import numpy as np
import pytest
from PIL import Image, ImageDraw
from server import inochi_preparation as preparation


def drawn_face(alpha=255):
    image = Image.new('RGBA', (220, 260), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((47, 24, 173, 155), fill=(245, 208, 190, alpha))
    draw.rectangle((65, 145, 155, 248), fill=(70, 85, 140, alpha))
    # Detector box [50,20,120,120], character-R at viewer-left.
    for cx in (85, 135):
        draw.ellipse((cx-14, 64, cx+14, 83), fill=(252, 250, 248, alpha))
        draw.ellipse((cx-7, 65, cx+7, 82), fill=(40, 65, 145, alpha))
        draw.ellipse((cx-3, 65, cx+3, 77), fill=(23, 25, 32, alpha))
        draw.arc((cx-15, 62, cx+15, 86), 185, 355, fill=(38, 30, 36, alpha), width=3)
    draw.arc((100, 108, 122, 117), 5, 175, fill=(110, 55, 60, alpha), width=2)
    return image


def run_drawn(monkeypatch, alpha=255):
    image = drawn_face(alpha)
    monkeypatch.setattr(preparation, '_detect_face', lambda rgb: [50, 20, 120, 120])
    return image, preparation.prepare_inochi_image(image)


def test_five_roles_source_coordinates_laterality_and_original_input(monkeypatch):
    image = drawn_face()
    original = np.array(image)
    monkeypatch.setattr(preparation, '_detect_face', lambda rgb: [50, 20, 120, 120])
    result = preparation.prepare_inochi_image(image)
    np.testing.assert_array_equal(np.array(image), original)
    manifest = result['manifest']
    assert manifest['source'] == {'width': 220, 'height': 260}
    assert [p['role'] for p in manifest['parts']] == list(preparation.ROLES)
    by_role = {p['role']: p for p in manifest['parts']}
    assert by_role['eye_white_l']['placement']['x'] > by_role['eye_white_r']['placement']['x']
    assert result['diagnostics']['manual_prompts_used'] is False
    assert result['diagnostics']['local_fill']['outside_eye_rgba_unchanged'] is True
    assert result['diagnostics']['neutral_white_composite']['max_channel_delta'] == 0
    assert result['diagnostics']['quality_status'] != 'passed'
    for part in manifest['parts']:
        output = Image.open(io.BytesIO(result['pngs'][part['path']]))
        assert output.mode == 'RGBA'
        assert output.size == (part['width'], part['height'])
        pixels = np.array(output)
        assert pixels[:, :, 3].any()
        assert not pixels[pixels[:, :, 3] == 0, :3].any()
        if part['role'].startswith('eye_white'):
            x0 = round(part['placement']['x'] * 220)
            y0 = round(part['placement']['y'] * 260)
            visible = pixels[:, :, 3] > 0
            source_crop = original[y0:y0+part['height'], x0:x0+part['width']]
            np.testing.assert_array_equal(pixels[visible], source_crop[visible])
            assert not visible[0, 0]  # Skin/hair corners belong to the base.
    # Rebuild from encoded PNGs and saved placements independently of the
    # preparer's in-memory diagnostic, including its non-rectangular masks.
    reconstructed = Image.new('RGBA', image.size)
    for role in ('face_base', 'eye_white_l', 'eye_white_r'):
        part = by_role[role]
        position = (round(part['placement']['x'] * 220), round(part['placement']['y'] * 260))
        reconstructed.alpha_composite(Image.open(io.BytesIO(result['pngs'][part['path']])), position)
    np.testing.assert_array_equal(np.array(reconstructed), original)


def test_partial_alpha_eyes_rejected_instead_of_source_over_alpha_change(monkeypatch):
    monkeypatch.setattr(preparation, '_detect_face', lambda rgb: [50, 20, 120, 120])
    image = drawn_face(250)
    original = np.array(image)
    with pytest.raises(ValueError, match='半透明'):
        preparation.prepare_inochi_image(image)
    np.testing.assert_array_equal(np.array(image), original)


def test_non_eye_partial_alpha_preserved_and_neutral_rgba_exact(monkeypatch):
    image = drawn_face()
    pixels = np.array(image); pixels[200, 100] = (70, 85, 140, 128)
    image = Image.fromarray(pixels)
    monkeypatch.setattr(preparation, '_detect_face', lambda rgb: [50, 20, 120, 120])
    result = preparation.prepare_inochi_image(image)
    part = result['manifest']['parts'][0]
    base = np.array(Image.open(io.BytesIO(result['pngs'][part['path']])))
    x0, y0 = round(part['placement']['x'] * 220), round(part['placement']['y'] * 260)
    np.testing.assert_array_equal(base[200-y0, 100-x0], [70, 85, 140, 128])
    assert result['diagnostics']['neutral_rgba_exact_to_extracted_foreground'] is True


def test_inferred_eye_alpha_restores_source_only_before_exact_composite(monkeypatch):
    monkeypatch.setattr(preparation, '_detect_face', lambda rgb: [50, 20, 120, 120])
    def inferred(source):
        result = source.copy()
        result[40:110, 60:160, 3] = 254
        return result, 'birefnet-general-lite-original-rgb'
    monkeypatch.setattr(preparation, '_foreground', inferred)
    result = preparation.prepare_inochi_image(drawn_face())
    assert result['diagnostics']['foreground_inference_eye_alpha_restored_pixels'] > 0
    assert result['diagnostics']['neutral_rgba_exact_to_extracted_foreground'] is True
    assert result['diagnostics']['neutral_white_composite']['max_channel_delta'] == 0


def test_closed_lash_is_visible_estimate_and_contains_no_blue_iris(monkeypatch):
    _, result = run_drawn(monkeypatch)
    for side in ('l', 'r'):
        pixels = np.array(Image.open(io.BytesIO(result['pngs'][f'parts/eye_closed_{side}.png'])))
        visible = pixels[pixels[:, :, 3] > 0]
        assert len(visible) >= 20
        assert int(np.max(visible[:, :3].max(axis=1) - visible[:, :3].min(axis=1))) <= 45
        assert result['diagnostics']['closed_eyes'][side]['hidden_artwork_recovered'] is False
        assert result['diagnostics']['closed_eyes'][side]['naturalness_verified'] is False


def test_closed_lash_failure_is_rejected_without_dummy_texture():
    rgb = np.full((100, 100, 3), 255, np.uint8)
    info = {'box': [10, 10, 50, 40], 'dark_box': [15, 15, 25, 12], 'threshold': 140}
    with pytest.raises(ValueError, match='閉じた目'):
        preparation._closed_lash(rgb, info)


def test_lighter_brow_and_hair_connection_do_not_enter_open_eye_parts():
    image = drawn_face()
    draw = ImageDraw.Draw(image)
    for x in (72, 122):
        draw.line((x, 52, x + 25, 52), fill=(135, 130, 138, 255), width=2)
        draw.line((x, 52, x, 67), fill=(135, 130, 138, 255), width=2)
    eyes = preparation._eye_regions(np.array(image.convert('RGB')), [50, 20, 120, 120])
    assert all(info['box'][1] > 54 for info in eyes.values())


def test_estimated_closed_lid_is_continuous_and_aligned_to_flattening_center(monkeypatch):
    import cv2
    _, result = run_drawn(monkeypatch)
    for side in ('l', 'r'):
        pixels = np.array(Image.open(io.BytesIO(result['pngs'][f'parts/eye_closed_{side}.png'])))
        mask = (pixels[:, :, 3] > 100).astype(np.uint8)
        count, _ = cv2.connectedComponents(mask)
        assert count == 2  # Background plus one coherent source-derived eyelid.
        ys, xs = np.nonzero(mask)
        assert mask[:, xs.min():xs.max() + 1].any(axis=0).all()
        assert abs(float(ys.mean()) - (pixels.shape[0] - 1) / 2) < 1.5


def test_missing_eye_is_rejected_without_anatomical_dummy():
    with pytest.raises(ValueError, match='左右の開いた目'):
        preparation._eye_regions(np.full((200, 200, 3), 245, np.uint8), [40, 20, 120, 120])


def test_already_closed_thin_lids_are_not_claimed_as_open_eyes():
    image = Image.new('RGB', (220, 260), (245, 208, 190))
    draw = ImageDraw.Draw(image)
    draw.line((70, 74, 100, 74), fill=(35, 30, 36), width=3)
    draw.line((120, 74, 150, 74), fill=(35, 30, 36), width=3)
    with pytest.raises(ValueError, match='左右の開いた目'):
        preparation._eye_regions(np.array(image), [50, 20, 120, 120])


def test_invalid_image_and_oversize_material_are_rejected(monkeypatch):
    with pytest.raises(ValueError, match='すべて透明'):
        preparation.prepare_inochi_image(Image.new('RGBA', (100, 100)))
    with pytest.raises(ValueError, match='64〜4096'):
        preparation.prepare_inochi_image(Image.new('RGBA', (4097, 64)))
    with pytest.raises(ValueError, match='2048'):
        preparation._png_part(np.full((2049, 2, 4), 255, np.uint8), 'face_base', (2, 2049))


def test_readiness_has_no_download_or_weight_load(monkeypatch):
    monkeypatch.setattr(preparation, 'CASCADE_PATH', preparation.ROOT / '.models/not-present-cascade')
    state = preparation.check_configuration()
    assert state['ready'] is False and state['configured'] is False
    assert state['automatic_downloads'] is False
    assert state['external_image_requests'] is False


def test_model_digest_mismatch_is_not_silently_used(tmp_path):
    path = tmp_path / 'invalid.xml'; path.write_text('wrong')
    with pytest.raises(preparation.ModelUnavailable):
        preparation._verified(path, preparation.CASCADE_SHA256, 'missing')
