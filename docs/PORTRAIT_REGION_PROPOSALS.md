# Portrait head/torso geometry proposal (offline prototype)

Date: 2026-10-25. Development branch only.

## What it does

After the existing single-image audit and foreground-mask step, a user may tap **「頭部・胴体の候補範囲を推定する」**. The new offline `proposePortraitRegions` routine:

- Identifies connected foreground islands in an existing 768×1024 alpha mask (8-neighbor connectivity).
- Rejects sparse foregrounds and flags if significant disconnected figures are present.
- Calculates row-by-row silhouette width for the main island.
- Proposes an upper/lower split only if a clear narrowing exists between a reasonably wide upper area and a wider lower area.
- Overlays **candidate only** rectangles on the cutout for review, or explicitly reports an ambiguous result when no safe boundary is found.
- Exports `region_proposals.json` alongside previously available images and `source_audit.json`.

The original normalized image, mask and cutout remain intact. Neither the original character generation workflow nor the imported-33-PNG workflow is modified. All processing is local in the browser and requires no key, external inference provider, payment, server, or deployment.

## Accuracy scope

This is a **geometry heuristic**. It does not recognize an actual face, person, hair, mouth, eyes, arms, or clothing. A prominent neck-like narrowing is only *suggestive* of a split. Raised arms, accessories, costumes, hairstyles, multiple characters, cropped portraits and unrelated images can cause false proposals or rejection.

There is **no claim of semantic segmentation**, no detection of facial landmarks, no reconstruction of hidden surfaces, no 33 completed layers, and no Inochi2D rig created by this path. All reports retain `independent_parts_generated: 0`, `anatomical_segmentation_performed: false`, `landmarks_detected: false` and `appearance_quality_verified: false`.

No isolated upper/lower pixels are exported as riggable parts. Only geometric candidate rectangles and unmodified foreground cutout are exported, to avoid implying that a heuristic cut is valid for animation.

## Tests and limitations

Node unit tests: a designed connected silhouette with a neck; uniform rectangular silhouette; two significant silhouettes; small detached speck; invalid/empty mask. Playwright: generating a foreground mask, asking for regions, reading `region_proposals.json`, and confirming that a uniform rectangular image does not produce fake upper/lower regions. Existing offline regression must pass on GitHub Actions before the branch is considered verified.

No quality claims for real-world anime character images or iPhone Safari are made from synthetic fixtures. A future subject-aware segmentation model and hidden-surface reconstruction are still necessary to produce the intended app.
