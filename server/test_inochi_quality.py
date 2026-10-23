"""Quality invariants with original drawn pixels, not a real-image quality pass."""
import copy
import numpy as np
import pytest
from PIL import Image

from server import inochi_preparation as stable
from server.inochi_quality import prepare_quality_image, extend_blink_parts, _canvas, _skin_field
from server.test_inochi_preparation import drawn_face


def test_improved_five_parts_preserve_neutral_alpha_and_source(monkeypatch):
    monkeypatch.setattr(stable, '_detect_face', lambda _: [50, 20, 120, 120])
    source = drawn_face()
    pixels = np.array(source); pixels[200, 100] = (65, 80, 120, 128)
    source = Image.fromarray(pixels)
    old = stable.prepare_inochi_image(source)
    improved = prepare_quality_image(source)
    assert [p['role'] for p in improved['manifest']['parts']] == list(stable.ROLES)
    mask = np.zeros(pixels.shape[:2], bool)
    result = Image.fromarray(_canvas(improved, 'face_base'))
    for side in ('l', 'r'):
        eye = _canvas(improved, 'eye_white_'+side)
        np.testing.assert_array_equal(eye, _canvas(old, 'eye_white_'+side))
        mask |= eye[:, :, 3] > 0
        result = Image.alpha_composite(result, Image.fromarray(eye))
    np.testing.assert_array_equal(np.array(result), pixels)
    np.testing.assert_array_equal(_canvas(improved, 'face_base')[~mask], _canvas(old, 'face_base')[~mask])
    assert improved['diagnostics']['closed_eyes']['l']['naturalness_verified'] is False


def test_lash_partition_is_disjoint_exact_and_does_not_mutate_five(monkeypatch):
    monkeypatch.setattr(stable, '_detect_face', lambda _: [50, 20, 120, 120])
    five = prepare_quality_image(drawn_face())
    original = copy.deepcopy(five)
    seven = extend_blink_parts(five)
    assert five == original
    assert len(five['manifest']['parts']) == 5 and len(seven['manifest']['parts']) == 7
    for side in ('l', 'r'):
        eye, lash = (_canvas(seven, name+side) for name in ('eye_white_', 'eye_lash_'))
        assert not np.any((eye[:, :, 3] > 0) & (lash[:, :, 3] > 0))
        composite = Image.alpha_composite(Image.fromarray(eye), Image.fromarray(lash))
        np.testing.assert_array_equal(np.array(composite), _canvas(five, 'eye_white_'+side))
        assert np.count_nonzero(lash[:, :, 3]) > 0
    assert seven['manifest']['quality']['neckBlend']['fixedY'] > seven['manifest']['quality']['neckBlend']['rigidY']


def test_skin_fit_retains_known_gradient_without_importing_blue_eye():
    yy, xx = np.indices((120, 160))
    rgb = np.stack((230+xx*.09+yy*.035, 195+xx*.075+yy*.05, 185+xx*.07+yy*.04), axis=2)
    rgb = np.rint(rgb).astype(np.uint8)
    truth = rgb.copy()
    mask = ((xx-80)/22)**2+((yy-57)/15)**2 < 1
    rgb[mask] = [80, 60, 170]
    field, box, report = _skin_field(rgb, mask, {'box': [57, 40, 104, 75]}, [10, 0, 140, 110])
    ax, ay, bx, by = box
    error = np.abs(field.astype(int)-truth[ay:by, ax:bx].astype(int))[mask[ay:by, ax:bx]]
    assert error.max() <= 2
    assert report['median_sample_residual'] < 1
    assert field[:, -1, 0].mean() > field[:, 0, 0].mean()+5


def test_missing_skin_evidence_is_refused_instead_of_dummy():
    rgb = np.full((120, 160, 3), [100, 120, 170], np.uint8)
    with pytest.raises(ValueError, match='肌色の根拠'):
        _skin_field(rgb, np.zeros((120, 160), bool), {'box': [57, 40, 104, 75]}, [10, 0, 140, 110])
