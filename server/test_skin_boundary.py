"""Withheld drawn-skin controls, not proof of naturalness on unseen artwork."""
import numpy as np
import pytest

from server import skin_boundary as skin


def example(offset=(0, -8, -5)):
    y, x = np.indices((180, 210))
    truth = np.stack((245+x*.02, 219+x*.025+y*.01, 207+y*.025), axis=2).astype(np.uint8)
    target = np.zeros((180, 210), bool); target[65:104, 66:143] = True
    source = np.concatenate((truth, np.full((180, 210, 1), 255, np.uint8)), axis=2)
    source[target, :3] = [75, 65, 150]
    prior = np.zeros_like(source); prior[target, :3] = np.clip(truth[target].astype(int)+offset, 0, 255)
    prior[target, 3] = 255
    return source, prior, target, truth


def correct(source, prior, target):
    return skin.correct_boundary(source, prior, target, target, [58, 58, 151, 115], [10, 5, 180, 170])


def test_boundary_color_improves_against_withheld_skin_without_touching_observed_or_alpha():
    source, prior, target, truth = example(); saved_source, saved_prior = source.copy(), prior.copy()
    result, report = correct(source, prior, target)
    assert report['applied'] is True and report['solver_converged'] is True
    assert report['after']['mean_absolute_rgb_difference'] < report['before']['mean_absolute_rgb_difference'] * .5
    before = np.abs(prior[target, :3].astype(float)-truth[target]).mean()
    after = np.abs(result[target, :3].astype(float)-truth[target]).mean()
    assert after < before  # withheld pixels are not provided to the solver
    np.testing.assert_array_equal(source, saved_source); np.testing.assert_array_equal(prior, saved_prior)
    np.testing.assert_array_equal(result[:, :, 3], prior[:, :, 3]); np.testing.assert_array_equal(result[~target], prior[~target])
    assert np.abs(result[target, :3].astype(int)-prior[target, :3].astype(int)).max() <= 12
    assert report['hidden_detail_recovered'] is False and report['appearance_quality_passed'] is False


def test_consistent_skin_is_not_replaced_just_to_claim_correction():
    source, prior, target, _ = example(offset=(0, 0, 0))
    source[:, :, :3] = [246, 225, 215]; source[target, :3] = [70, 60, 150]
    prior[target, :3] = [246, 225, 215]
    result, report = correct(source, prior, target)
    assert report['applied'] is False and report['status'] == 'not-applied-no-measured-improvement'
    np.testing.assert_array_equal(result, prior)


def test_hair_or_iris_boundary_is_not_used_as_skin_or_replaced_with_stock_color():
    source, prior, target, _ = example()
    source[:, :, :3] = [80, 65, 145]
    with pytest.raises(ValueError): correct(source, prior, target)
    # Adequate visible skin farther away, but only non-skin immediately around
    # the target: optional correction is explicitly skipped, not certified.
    source[:, :, :3] = [246, 225, 215]; source[62:107, 63:146, :3] = [70, 60, 150]
    result, report = correct(source, prior, target)
    assert report['applied'] is False and report['status'] == 'insufficient-observed-skin-boundary'
    np.testing.assert_array_equal(result, prior)


def test_pixel_budget_is_checked_before_solving_and_returns_an_explicit_skip(monkeypatch):
    source, prior, target, _ = example(); monkeypatch.setattr(skin, 'MAX_PIXELS', 10)
    result, report = correct(source, prior, target)
    assert report['applied'] is False and report['status'] == 'target-budget-exceeded'
    np.testing.assert_array_equal(result, prior)


def test_nonconvergence_stops_without_mutating_the_original_fill(monkeypatch):
    import scipy.sparse.linalg
    source, prior, target, _ = example(); saved = prior.copy()
    monkeypatch.setattr(scipy.sparse.linalg, 'cg', lambda matrix, rhs, **kwargs: (np.zeros_like(rhs), 1))
    with pytest.raises(ValueError, match='収束'): correct(source, prior, target)
    np.testing.assert_array_equal(prior, saved)


def test_translucent_inferred_skin_or_mismatched_masks_cannot_silently_change_alpha():
    source, prior, target, _ = example(); prior[target, 3] = 254
    with pytest.raises(ValueError, match='一致'): correct(source, prior, target)
    with pytest.raises(ValueError, match='一致'): correct(source, prior, target.astype(np.uint8))
