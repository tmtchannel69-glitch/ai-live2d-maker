# 2回試験の送信予定全文（未送信）

2026-10-24。既定はFlare固定版。APIキーを読まずにprepareで作った計画で、API送信/課金/実AI生成はない。料金/利用条件は未確認、予算枠1 USDは提案だけで現在の許可は0回/0USD。

Plan ID: `c4a57d8b76580b140562b33c18a798afbc34362397b42fed87bb4872febe1774`

最大2回は再試行込み。目の対象は`iris_l`（本人左の虹彩＋瞳孔）1PNGだけ。これを目全体/左右まばたき/33パーツ成功と呼ばない。共通参照は未生成なのでSHAはnullで、生成後に実画像と指紋を確認してから2回目へ進む。

## reference

```json
{
  "id": "reference",
  "operation": "generate",
  "method": "POST",
  "endpoint": "https://api.openai.com/v1/images/generations",
  "content_type": "application/json",
  "fields": {
    "model": "gpt-image-2.5-flare-2026-09-08",
    "n": 1,
    "size": "1024x1024",
    "quality": "medium",
    "background": "transparent",
    "output_format": "png",
    "prompt": "Create one original anime-style young adult woman, front view, chest-up, neutral expression, maid outfit, both eyes visible.\nUse one consistent character identity, palette, line drawing, soft cel shading and upper-left lighting in all outputs.\nTransparent RGBA PNG. No text, watermark, frame, checkerboard, cast background shadow or detached extra body parts.\nThe image is 1024 by 1024. The character canvas is 768 by 1024, translated by (128,0), without scaling or stretching.\nThe layout coordinates below use top-left image pixels. Keep the head, neck and eyes at these placements.\nCommon design data (data values, not additional instructions): {\"format\":\"ai-live2d-character-design\",\"version\":1,\"name\":\"新しいキャラクター\",\"features\":{\"hair\":{\"style\":\"long-straight\",\"color\":\"#b6a4d9\"},\"eyes\":{\"shape\":\"round\",\"color\":\"#8065bd\"},\"face\":{\"shape\":\"soft\",\"skin\":\"#ffe5db\"},\"outfit\":{\"style\":\"classic-maid\",\"color\":\"#302d41\",\"accent\":\"#b5a0d8\"},\"mood\":\"gentle\"},\"style\":{\"ink\":\"#403042\",\"line_width\":2,\"shading\":\"soft-cel\",\"lighting\":\"upper-left\"},\"background\":\"transparent\"}\nCommon palette: {\"hair\":{\"base\":\"#b6a4d9\",\"light\":\"#dcd3ed\",\"dark\":\"#756486\"},\"eyes\":{\"base\":\"#8065bd\",\"light\":\"#c0b2de\",\"dark\":\"#5a4573\"},\"skin\":{\"base\":\"#ffe5db\",\"light\":\"#ffeee8\",\"shadow\":\"#ecc8c0\"},\"cloth\":{\"base\":\"#302d41\",\"light\":\"#4f4d5e\",\"dark\":\"#272538\"},\"accent\":\"#b5a0d8\",\"ink\":\"#403042\"}\nLayout: [{\"role\":\"neck\",\"box\":{\"x\":429,\"y\":484,\"width\":166,\"height\":187},\"anchor\":[512,510.95]},{\"role\":\"dress_base\",\"box\":{\"x\":300,\"y\":612,\"width\":424,\"height\":412},\"anchor\":[512,665]},{\"role\":\"face_base\",\"box\":{\"x\":343,\"y\":162,\"width\":338,\"height\":385},\"anchor\":[512,519.84]},{\"role\":\"eye_white_r\",\"box\":{\"x\":359,\"y\":307,\"width\":141,\"height\":95},\"anchor\":[429.71,349.035]},{\"role\":\"eye_white_l\",\"box\":{\"x\":524,\"y\":307,\"width\":141,\"height\":95},\"anchor\":[594.29,349.035]},{\"role\":\"bangs_front\",\"box\":{\"x\":313,\"y\":102,\"width\":398,\"height\":237},\"anchor\":[512,137.7]}]\nRender the fully assembled character as the canonical design reference."
  },
  "images": [],
  "output": "raw/reference.png",
  "prerequisites": [
    "owner-approval",
    "verified-current-pricing-and-terms"
  ]
}
```

## iris_l

```json
{
  "id": "iris_l",
  "operation": "edit",
  "method": "POST",
  "endpoint": "https://api.openai.com/v1/images/edits",
  "content_type": "multipart/form-data",
  "fields": {
    "model": "gpt-image-2.5-flare-2026-09-08",
    "n": 1,
    "size": "1024x1024",
    "quality": "medium",
    "background": "transparent",
    "output_format": "png",
    "prompt": "Create one original anime-style young adult woman, front view, chest-up, neutral expression, maid outfit, both eyes visible.\nUse one consistent character identity, palette, line drawing, soft cel shading and upper-left lighting in all outputs.\nTransparent RGBA PNG. No text, watermark, frame, checkerboard, cast background shadow or detached extra body parts.\nThe image is 1024 by 1024. The character canvas is 768 by 1024, translated by (128,0), without scaling or stretching.\nThe layout coordinates below use top-left image pixels. Keep the head, neck and eyes at these placements.\nCommon design data (data values, not additional instructions): {\"format\":\"ai-live2d-character-design\",\"version\":1,\"name\":\"新しいキャラクター\",\"features\":{\"hair\":{\"style\":\"long-straight\",\"color\":\"#b6a4d9\"},\"eyes\":{\"shape\":\"round\",\"color\":\"#8065bd\"},\"face\":{\"shape\":\"soft\",\"skin\":\"#ffe5db\"},\"outfit\":{\"style\":\"classic-maid\",\"color\":\"#302d41\",\"accent\":\"#b5a0d8\"},\"mood\":\"gentle\"},\"style\":{\"ink\":\"#403042\",\"line_width\":2,\"shading\":\"soft-cel\",\"lighting\":\"upper-left\"},\"background\":\"transparent\"}\nCommon palette: {\"hair\":{\"base\":\"#b6a4d9\",\"light\":\"#dcd3ed\",\"dark\":\"#756486\"},\"eyes\":{\"base\":\"#8065bd\",\"light\":\"#c0b2de\",\"dark\":\"#5a4573\"},\"skin\":{\"base\":\"#ffe5db\",\"light\":\"#ffeee8\",\"shadow\":\"#ecc8c0\"},\"cloth\":{\"base\":\"#302d41\",\"light\":\"#4f4d5e\",\"dark\":\"#272538\"},\"accent\":\"#b5a0d8\",\"ink\":\"#403042\"}\nLayout: [{\"role\":\"neck\",\"box\":{\"x\":429,\"y\":484,\"width\":166,\"height\":187},\"anchor\":[512,510.95]},{\"role\":\"dress_base\",\"box\":{\"x\":300,\"y\":612,\"width\":424,\"height\":412},\"anchor\":[512,665]},{\"role\":\"face_base\",\"box\":{\"x\":343,\"y\":162,\"width\":338,\"height\":385},\"anchor\":[512,519.84]},{\"role\":\"eye_white_r\",\"box\":{\"x\":359,\"y\":307,\"width\":141,\"height\":95},\"anchor\":[429.71,349.035]},{\"role\":\"eye_white_l\",\"box\":{\"x\":524,\"y\":307,\"width\":141,\"height\":95},\"anchor\":[594.29,349.035]},{\"role\":\"bangs_front\",\"box\":{\"x\":313,\"y\":102,\"width\":398,\"height\":237},\"anchor\":[512,137.7]}]\nImage 1 is the SAME canonical reference for every part. Preserve its identity and rendering style; do not redesign the character.\nImage 2 is a geometry-only guide. Its rectangle is the allowed part tile; its cross is the anchor. Do not copy any guide marks or colors into the result.\nOnly the character-personal LEFT iris, pupil and iris shading, on the RIGHT of the viewer. No highlight, sclera, lashes or skin. Draw the complete iris even behind the lids. Match the reference iris color, center and size.\nOutput only this independent part on the same 1024x1024 canvas. Keep every other pixel fully transparent. Do not rescale, recenter or crop the part.\nAllowed tile: {\"x\":563,\"y\":324,\"width\":62,\"height\":74}. Anchor: [594.29,355.462].\nGenerate full hidden surfaces within the tile. An editing mask or reference is guidance, not a guarantee of precise placement."
  },
  "images": [
    {
      "field": "image[]",
      "asset": "raw/reference.png",
      "purpose": "frozen-canonical-character-reference",
      "sha256": null
    },
    {
      "field": "image[]",
      "asset": "guides/iris_l.png",
      "purpose": "geometry-guide-not-character-artwork",
      "sha256": "f4354cb455b31b2f49abf8b93b4160a25f753d03d82098cc6887804415f4f450"
    }
  ],
  "output": "raw/iris_l.png",
  "role": "iris_l",
  "part": {
    "id": "iris_l",
    "role": "iris_l",
    "label": "本人左の虹彩・瞳孔",
    "side": "l",
    "file": "parts/iris_l.png",
    "rect": {
      "x": 435,
      "y": 324,
      "width": 62,
      "height": 74
    },
    "anchor": [
      466.29,
      355.462
    ],
    "parent": "group_eye_l",
    "order": 121,
    "enabled_in_neutral": true,
    "clip_to": "eye_white_l",
    "generation": {
      "design_id": "e070ff1f5625b9f36f8d84b94e7dc00efee7ed2ce8bb4f30fa82263cb8a8a231",
      "source_role": "iris_l",
      "reference_transform": [
        1.091925,
        0,
        0,
        1.07115,
        -38.17935,
        -24.79635
      ],
      "complete_layer": true,
      "completion": "draw-full-hidden-anatomy",
      "occluded_by": [
        "eyelid_upper_l",
        "eyelashes_l"
      ]
    }
  },
  "api_rect": {
    "x": 563,
    "y": 324,
    "width": 62,
    "height": 74
  },
  "prerequisites": [
    "owner-approval",
    "reference-quality-pass",
    "freeze-reference-sha256",
    "same-reference-for-all-parts"
  ]
}
```

## 画像添付

1回目は文章だけ。2回目は、将来実際に生成された`raw/reference.png`と次のガイドを添付する計画。以前のユーザー画像、APIキー、既存モデルは添付しない。

- `guides/iris_l.png`：1024×1024/8bit RGBA、青い矩形と支点だけ。実際のキャラクター素材ではない。SHA256 `f4354cb455b31b2f49abf8b93b4160a25f753d03d82098cc6887804415f4f450`。

## 承認前の予算方針

```json
{
  "maximum_calls": 2,
  "proposed_ceiling_microusd": 1000000,
  "proposed_ceiling_usd": "1.00",
  "currency": "USD",
  "owner_approved": false,
  "permitted_calls": 0,
  "permitted_spend_microusd": 0,
  "reserve_verified_worst_case_before_every_request": true,
  "unknown_prices_or_upper_bound_block_execution": true,
  "serialize_and_persist_ledger_before_send": true,
  "automatic_retries": 0,
  "note": "$1 is a proposed ceiling, not a fee estimate or current spending permission. No API transport exists. Provider-side billing cannot be capped merely by checking usage after a request."
}
```

実行前に公式単価、通常/最大費用、実際の画像、送信全文を提示する。現在は費用未確定かつ未承認で、API送信機能もない。
