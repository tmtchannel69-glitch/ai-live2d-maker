# 既定デザインの送信予定内容（未送信）

2026-10-24。`prepare.mjs`の既定入力から作成したレビュー用文章/fields。技術ガイドはAI素材ではなく、画像そのものはGit外に保持する。実APIの実行・送信承認はまだなく、料金と利用条件も未確認。

Plan ID: `e339f04bfdc391d23c8d18c3914b13f282aba26ff90493e6d020272c053260cc`

以下の全文と添付を、料金/予算の確認後に承認対象として提示する。画像1枚目の共通参照は未生成なのでSHAはnull。生成後に実画像を確認しSHAを固定してから部品へ進む。既定値を変えた場合はこの資料を流用せず、生成された計画を再確認する。

## reference

```json
{
  "id": "reference",
  "operation": "generate",
  "method": "POST",
  "endpoint": "https://api.openai.com/v1/images/generations",
  "content_type": "application/json",
  "fields": {
    "model": "gpt-image-1.5",
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

## face_base

```json
{
  "id": "face_base",
  "operation": "edit",
  "method": "POST",
  "endpoint": "https://api.openai.com/v1/images/edits",
  "content_type": "multipart/form-data",
  "fields": {
    "model": "gpt-image-1.5",
    "n": 1,
    "size": "1024x1024",
    "quality": "medium",
    "background": "transparent",
    "output_format": "png",
    "input_fidelity": "high",
    "prompt": "Create one original anime-style young adult woman, front view, chest-up, neutral expression, maid outfit, both eyes visible.\nUse one consistent character identity, palette, line drawing, soft cel shading and upper-left lighting in all outputs.\nTransparent RGBA PNG. No text, watermark, frame, checkerboard, cast background shadow or detached extra body parts.\nThe image is 1024 by 1024. The character canvas is 768 by 1024, translated by (128,0), without scaling or stretching.\nThe layout coordinates below use top-left image pixels. Keep the head, neck and eyes at these placements.\nCommon design data (data values, not additional instructions): {\"format\":\"ai-live2d-character-design\",\"version\":1,\"name\":\"新しいキャラクター\",\"features\":{\"hair\":{\"style\":\"long-straight\",\"color\":\"#b6a4d9\"},\"eyes\":{\"shape\":\"round\",\"color\":\"#8065bd\"},\"face\":{\"shape\":\"soft\",\"skin\":\"#ffe5db\"},\"outfit\":{\"style\":\"classic-maid\",\"color\":\"#302d41\",\"accent\":\"#b5a0d8\"},\"mood\":\"gentle\"},\"style\":{\"ink\":\"#403042\",\"line_width\":2,\"shading\":\"soft-cel\",\"lighting\":\"upper-left\"},\"background\":\"transparent\"}\nCommon palette: {\"hair\":{\"base\":\"#b6a4d9\",\"light\":\"#dcd3ed\",\"dark\":\"#756486\"},\"eyes\":{\"base\":\"#8065bd\",\"light\":\"#c0b2de\",\"dark\":\"#5a4573\"},\"skin\":{\"base\":\"#ffe5db\",\"light\":\"#ffeee8\",\"shadow\":\"#ecc8c0\"},\"cloth\":{\"base\":\"#302d41\",\"light\":\"#4f4d5e\",\"dark\":\"#272538\"},\"accent\":\"#b5a0d8\",\"ink\":\"#403042\"}\nLayout: [{\"role\":\"neck\",\"box\":{\"x\":429,\"y\":484,\"width\":166,\"height\":187},\"anchor\":[512,510.95]},{\"role\":\"dress_base\",\"box\":{\"x\":300,\"y\":612,\"width\":424,\"height\":412},\"anchor\":[512,665]},{\"role\":\"face_base\",\"box\":{\"x\":343,\"y\":162,\"width\":338,\"height\":385},\"anchor\":[512,519.84]},{\"role\":\"eye_white_r\",\"box\":{\"x\":359,\"y\":307,\"width\":141,\"height\":95},\"anchor\":[429.71,349.035]},{\"role\":\"eye_white_l\",\"box\":{\"x\":524,\"y\":307,\"width\":141,\"height\":95},\"anchor\":[594.29,349.035]},{\"role\":\"bangs_front\",\"box\":{\"x\":313,\"y\":102,\"width\":398,\"height\":237},\"anchor\":[512,137.7]}]\nImage 1 is the SAME canonical reference for every part. Preserve its identity and rendering style; do not redesign the character.\nImage 2 is a geometry-only guide. Its rectangle is the allowed part tile; its cross is the anchor. Do not copy any guide marks or colors into the result.\nOnly the complete face skin layer, including forehead, cheeks, nose and chin. Remove eyes, eyebrows, lashes, mouth, ears and all hair. Reconstruct skin hidden by the bangs and eyes, with matching shading. Do not cut holes where the eyes or hair used to be.\nOutput only this independent part on the same 1024x1024 canvas. Keep every other pixel fully transparent. Do not rescale, recenter or crop the part.\nAllowed tile: {\"x\":343,\"y\":162,\"width\":338,\"height\":385}. Anchor: [512,519.84].\nGenerate full hidden surfaces within the tile. An editing mask or reference is guidance, not a guarantee of precise placement."
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
      "asset": "guides/face_base.png",
      "purpose": "geometry-guide-not-character-artwork",
      "sha256": "9fd273b6d2a5df9b02e4404db5f4906b494f73d61a67c46f13f6ee85bece1501"
    }
  ],
  "output": "raw/face_base.png",
  "role": "face_base",
  "part": {
    "id": "face_base",
    "role": "face_base",
    "label": "顔の肌",
    "side": null,
    "file": "parts/face_base.png",
    "rect": {
      "x": 215,
      "y": 162,
      "width": 338,
      "height": 385
    },
    "anchor": [
      384,
      519.84
    ],
    "parent": "group_head",
    "order": 90,
    "enabled_in_neutral": true,
    "clip_to": null,
    "generation": {
      "design_id": "e070ff1f5625b9f36f8d84b94e7dc00efee7ed2ce8bb4f30fa82263cb8a8a231",
      "source_role": "face_base",
      "reference_transform": [
        1.055,
        0,
        0,
        0.965,
        -21.12,
        12.25
      ],
      "complete_layer": true,
      "completion": "draw-full-hidden-anatomy",
      "occluded_by": [
        "bangs_front",
        "side_hair_l",
        "side_hair_r"
      ]
    }
  },
  "api_rect": {
    "x": 343,
    "y": 162,
    "width": 338,
    "height": 385
  },
  "prerequisites": [
    "owner-approval",
    "reference-quality-pass",
    "freeze-reference-sha256",
    "same-reference-for-all-parts"
  ]
}
```

## bangs_front

```json
{
  "id": "bangs_front",
  "operation": "edit",
  "method": "POST",
  "endpoint": "https://api.openai.com/v1/images/edits",
  "content_type": "multipart/form-data",
  "fields": {
    "model": "gpt-image-1.5",
    "n": 1,
    "size": "1024x1024",
    "quality": "medium",
    "background": "transparent",
    "output_format": "png",
    "input_fidelity": "high",
    "prompt": "Create one original anime-style young adult woman, front view, chest-up, neutral expression, maid outfit, both eyes visible.\nUse one consistent character identity, palette, line drawing, soft cel shading and upper-left lighting in all outputs.\nTransparent RGBA PNG. No text, watermark, frame, checkerboard, cast background shadow or detached extra body parts.\nThe image is 1024 by 1024. The character canvas is 768 by 1024, translated by (128,0), without scaling or stretching.\nThe layout coordinates below use top-left image pixels. Keep the head, neck and eyes at these placements.\nCommon design data (data values, not additional instructions): {\"format\":\"ai-live2d-character-design\",\"version\":1,\"name\":\"新しいキャラクター\",\"features\":{\"hair\":{\"style\":\"long-straight\",\"color\":\"#b6a4d9\"},\"eyes\":{\"shape\":\"round\",\"color\":\"#8065bd\"},\"face\":{\"shape\":\"soft\",\"skin\":\"#ffe5db\"},\"outfit\":{\"style\":\"classic-maid\",\"color\":\"#302d41\",\"accent\":\"#b5a0d8\"},\"mood\":\"gentle\"},\"style\":{\"ink\":\"#403042\",\"line_width\":2,\"shading\":\"soft-cel\",\"lighting\":\"upper-left\"},\"background\":\"transparent\"}\nCommon palette: {\"hair\":{\"base\":\"#b6a4d9\",\"light\":\"#dcd3ed\",\"dark\":\"#756486\"},\"eyes\":{\"base\":\"#8065bd\",\"light\":\"#c0b2de\",\"dark\":\"#5a4573\"},\"skin\":{\"base\":\"#ffe5db\",\"light\":\"#ffeee8\",\"shadow\":\"#ecc8c0\"},\"cloth\":{\"base\":\"#302d41\",\"light\":\"#4f4d5e\",\"dark\":\"#272538\"},\"accent\":\"#b5a0d8\",\"ink\":\"#403042\"}\nLayout: [{\"role\":\"neck\",\"box\":{\"x\":429,\"y\":484,\"width\":166,\"height\":187},\"anchor\":[512,510.95]},{\"role\":\"dress_base\",\"box\":{\"x\":300,\"y\":612,\"width\":424,\"height\":412},\"anchor\":[512,665]},{\"role\":\"face_base\",\"box\":{\"x\":343,\"y\":162,\"width\":338,\"height\":385},\"anchor\":[512,519.84]},{\"role\":\"eye_white_r\",\"box\":{\"x\":359,\"y\":307,\"width\":141,\"height\":95},\"anchor\":[429.71,349.035]},{\"role\":\"eye_white_l\",\"box\":{\"x\":524,\"y\":307,\"width\":141,\"height\":95},\"anchor\":[594.29,349.035]},{\"role\":\"bangs_front\",\"box\":{\"x\":313,\"y\":102,\"width\":398,\"height\":237},\"anchor\":[512,137.7]}]\nImage 1 is the SAME canonical reference for every part. Preserve its identity and rendering style; do not redesign the character.\nImage 2 is a geometry-only guide. Its rectangle is the allowed part tile; its cross is the anchor. Do not copy any guide marks or colors into the result.\nOnly the entire front bangs layer, including the concealed roots and overlaps. No face, eyes, ears, side hair, back hair or costume. Match the canonical reference hair silhouette, color, strand drawing, light and shadow.\nOutput only this independent part on the same 1024x1024 canvas. Keep every other pixel fully transparent. Do not rescale, recenter or crop the part.\nAllowed tile: {\"x\":313,\"y\":102,\"width\":398,\"height\":237}. Anchor: [512,137.7].\nGenerate full hidden surfaces within the tile. An editing mask or reference is guidance, not a guarantee of precise placement."
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
      "asset": "guides/bangs_front.png",
      "purpose": "geometry-guide-not-character-artwork",
      "sha256": "a2926ba52ad51b6596cfcc9d64dbfbbdc248a72eda2fd8366d680ed050c9f1d2"
    }
  ],
  "output": "raw/bangs_front.png",
  "role": "bangs_front",
  "part": {
    "id": "bangs_front",
    "role": "bangs_front",
    "label": "前髪",
    "side": null,
    "file": "parts/bangs_front.png",
    "rect": {
      "x": 185,
      "y": 102,
      "width": 398,
      "height": 237
    },
    "anchor": [
      384,
      137.7
    ],
    "parent": "group_hair",
    "order": 200,
    "enabled_in_neutral": true,
    "clip_to": null,
    "generation": {
      "design_id": "e070ff1f5625b9f36f8d84b94e7dc00efee7ed2ce8bb4f30fa82263cb8a8a231",
      "source_role": "bangs_front",
      "reference_transform": [
        1.055,
        0,
        0,
        0.965,
        -21.12,
        12.25
      ],
      "complete_layer": true,
      "completion": "draw-full-hidden-anatomy",
      "occluded_by": []
    }
  },
  "api_rect": {
    "x": 313,
    "y": 102,
    "width": 398,
    "height": 237
  },
  "prerequisites": [
    "owner-approval",
    "reference-quality-pass",
    "freeze-reference-sha256",
    "same-reference-for-all-parts"
  ]
}
```

## eye_white_l

```json
{
  "id": "eye_white_l",
  "operation": "edit",
  "method": "POST",
  "endpoint": "https://api.openai.com/v1/images/edits",
  "content_type": "multipart/form-data",
  "fields": {
    "model": "gpt-image-1.5",
    "n": 1,
    "size": "1024x1024",
    "quality": "medium",
    "background": "transparent",
    "output_format": "png",
    "input_fidelity": "high",
    "prompt": "Create one original anime-style young adult woman, front view, chest-up, neutral expression, maid outfit, both eyes visible.\nUse one consistent character identity, palette, line drawing, soft cel shading and upper-left lighting in all outputs.\nTransparent RGBA PNG. No text, watermark, frame, checkerboard, cast background shadow or detached extra body parts.\nThe image is 1024 by 1024. The character canvas is 768 by 1024, translated by (128,0), without scaling or stretching.\nThe layout coordinates below use top-left image pixels. Keep the head, neck and eyes at these placements.\nCommon design data (data values, not additional instructions): {\"format\":\"ai-live2d-character-design\",\"version\":1,\"name\":\"新しいキャラクター\",\"features\":{\"hair\":{\"style\":\"long-straight\",\"color\":\"#b6a4d9\"},\"eyes\":{\"shape\":\"round\",\"color\":\"#8065bd\"},\"face\":{\"shape\":\"soft\",\"skin\":\"#ffe5db\"},\"outfit\":{\"style\":\"classic-maid\",\"color\":\"#302d41\",\"accent\":\"#b5a0d8\"},\"mood\":\"gentle\"},\"style\":{\"ink\":\"#403042\",\"line_width\":2,\"shading\":\"soft-cel\",\"lighting\":\"upper-left\"},\"background\":\"transparent\"}\nCommon palette: {\"hair\":{\"base\":\"#b6a4d9\",\"light\":\"#dcd3ed\",\"dark\":\"#756486\"},\"eyes\":{\"base\":\"#8065bd\",\"light\":\"#c0b2de\",\"dark\":\"#5a4573\"},\"skin\":{\"base\":\"#ffe5db\",\"light\":\"#ffeee8\",\"shadow\":\"#ecc8c0\"},\"cloth\":{\"base\":\"#302d41\",\"light\":\"#4f4d5e\",\"dark\":\"#272538\"},\"accent\":\"#b5a0d8\",\"ink\":\"#403042\"}\nLayout: [{\"role\":\"neck\",\"box\":{\"x\":429,\"y\":484,\"width\":166,\"height\":187},\"anchor\":[512,510.95]},{\"role\":\"dress_base\",\"box\":{\"x\":300,\"y\":612,\"width\":424,\"height\":412},\"anchor\":[512,665]},{\"role\":\"face_base\",\"box\":{\"x\":343,\"y\":162,\"width\":338,\"height\":385},\"anchor\":[512,519.84]},{\"role\":\"eye_white_r\",\"box\":{\"x\":359,\"y\":307,\"width\":141,\"height\":95},\"anchor\":[429.71,349.035]},{\"role\":\"eye_white_l\",\"box\":{\"x\":524,\"y\":307,\"width\":141,\"height\":95},\"anchor\":[594.29,349.035]},{\"role\":\"bangs_front\",\"box\":{\"x\":313,\"y\":102,\"width\":398,\"height\":237},\"anchor\":[512,137.7]}]\nImage 1 is the SAME canonical reference for every part. Preserve its identity and rendering style; do not redesign the character.\nImage 2 is a geometry-only guide. Its rectangle is the allowed part tile; its cross is the anchor. Do not copy any guide marks or colors into the result.\nOnly the character-personal LEFT eye sclera/aperture. This is on the RIGHT of the viewer. No iris, pupil, highlight, lashes, eyelids, skin or eyebrows. Preserve the reference eye opening and complete its hidden portion for blinking.\nOutput only this independent part on the same 1024x1024 canvas. Keep every other pixel fully transparent. Do not rescale, recenter or crop the part.\nAllowed tile: {\"x\":524,\"y\":307,\"width\":141,\"height\":95}. Anchor: [594.29,349.035].\nGenerate full hidden surfaces within the tile. An editing mask or reference is guidance, not a guarantee of precise placement."
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
      "asset": "guides/eye_white_l.png",
      "purpose": "geometry-guide-not-character-artwork",
      "sha256": "d85847be61b81e2cbb78ab0db4a45e59d5b3b6885e715a1dbf987035481c7ae3"
    }
  ],
  "output": "raw/eye_white_l.png",
  "role": "eye_white_l",
  "part": {
    "id": "eye_white_l",
    "role": "eye_white_l",
    "label": "本人左の白目",
    "side": "l",
    "file": "parts/eye_white_l.png",
    "rect": {
      "x": 396,
      "y": 307,
      "width": 141,
      "height": 95
    },
    "anchor": [
      466.29,
      349.035
    ],
    "parent": "group_eye_l",
    "order": 111,
    "enabled_in_neutral": true,
    "clip_to": null,
    "generation": {
      "design_id": "e070ff1f5625b9f36f8d84b94e7dc00efee7ed2ce8bb4f30fa82263cb8a8a231",
      "source_role": "eye_white_l",
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
      "occluded_by": []
    }
  },
  "api_rect": {
    "x": 524,
    "y": 307,
    "width": 141,
    "height": 95
  },
  "prerequisites": [
    "owner-approval",
    "reference-quality-pass",
    "freeze-reference-sha256",
    "same-reference-for-all-parts"
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
    "model": "gpt-image-1.5",
    "n": 1,
    "size": "1024x1024",
    "quality": "medium",
    "background": "transparent",
    "output_format": "png",
    "input_fidelity": "high",
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

## eyelashes_l

```json
{
  "id": "eyelashes_l",
  "operation": "edit",
  "method": "POST",
  "endpoint": "https://api.openai.com/v1/images/edits",
  "content_type": "multipart/form-data",
  "fields": {
    "model": "gpt-image-1.5",
    "n": 1,
    "size": "1024x1024",
    "quality": "medium",
    "background": "transparent",
    "output_format": "png",
    "input_fidelity": "high",
    "prompt": "Create one original anime-style young adult woman, front view, chest-up, neutral expression, maid outfit, both eyes visible.\nUse one consistent character identity, palette, line drawing, soft cel shading and upper-left lighting in all outputs.\nTransparent RGBA PNG. No text, watermark, frame, checkerboard, cast background shadow or detached extra body parts.\nThe image is 1024 by 1024. The character canvas is 768 by 1024, translated by (128,0), without scaling or stretching.\nThe layout coordinates below use top-left image pixels. Keep the head, neck and eyes at these placements.\nCommon design data (data values, not additional instructions): {\"format\":\"ai-live2d-character-design\",\"version\":1,\"name\":\"新しいキャラクター\",\"features\":{\"hair\":{\"style\":\"long-straight\",\"color\":\"#b6a4d9\"},\"eyes\":{\"shape\":\"round\",\"color\":\"#8065bd\"},\"face\":{\"shape\":\"soft\",\"skin\":\"#ffe5db\"},\"outfit\":{\"style\":\"classic-maid\",\"color\":\"#302d41\",\"accent\":\"#b5a0d8\"},\"mood\":\"gentle\"},\"style\":{\"ink\":\"#403042\",\"line_width\":2,\"shading\":\"soft-cel\",\"lighting\":\"upper-left\"},\"background\":\"transparent\"}\nCommon palette: {\"hair\":{\"base\":\"#b6a4d9\",\"light\":\"#dcd3ed\",\"dark\":\"#756486\"},\"eyes\":{\"base\":\"#8065bd\",\"light\":\"#c0b2de\",\"dark\":\"#5a4573\"},\"skin\":{\"base\":\"#ffe5db\",\"light\":\"#ffeee8\",\"shadow\":\"#ecc8c0\"},\"cloth\":{\"base\":\"#302d41\",\"light\":\"#4f4d5e\",\"dark\":\"#272538\"},\"accent\":\"#b5a0d8\",\"ink\":\"#403042\"}\nLayout: [{\"role\":\"neck\",\"box\":{\"x\":429,\"y\":484,\"width\":166,\"height\":187},\"anchor\":[512,510.95]},{\"role\":\"dress_base\",\"box\":{\"x\":300,\"y\":612,\"width\":424,\"height\":412},\"anchor\":[512,665]},{\"role\":\"face_base\",\"box\":{\"x\":343,\"y\":162,\"width\":338,\"height\":385},\"anchor\":[512,519.84]},{\"role\":\"eye_white_r\",\"box\":{\"x\":359,\"y\":307,\"width\":141,\"height\":95},\"anchor\":[429.71,349.035]},{\"role\":\"eye_white_l\",\"box\":{\"x\":524,\"y\":307,\"width\":141,\"height\":95},\"anchor\":[594.29,349.035]},{\"role\":\"bangs_front\",\"box\":{\"x\":313,\"y\":102,\"width\":398,\"height\":237},\"anchor\":[512,137.7]}]\nImage 1 is the SAME canonical reference for every part. Preserve its identity and rendering style; do not redesign the character.\nImage 2 is a geometry-only guide. Its rectangle is the allowed part tile; its cross is the anchor. Do not copy any guide marks or colors into the result.\nOnly the character-personal LEFT upper lash line and eyelashes, on the RIGHT of the viewer. No skin fill, iris, white of the eye or eyebrows. Match the reference line color, taper, thickness and curve; no duplicate parallel lash line.\nOutput only this independent part on the same 1024x1024 canvas. Keep every other pixel fully transparent. Do not rescale, recenter or crop the part.\nAllowed tile: {\"x\":520,\"y\":309,\"width\":158,\"height\":72}. Anchor: [594.29,336.181].\nGenerate full hidden surfaces within the tile. An editing mask or reference is guidance, not a guarantee of precise placement."
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
      "asset": "guides/eyelashes_l.png",
      "purpose": "geometry-guide-not-character-artwork",
      "sha256": "2687b3770f7424d58ff834478610179d4693e7873eb3e109d3292eb8046db80c"
    }
  ],
  "output": "raw/eyelashes_l.png",
  "role": "eyelashes_l",
  "part": {
    "id": "eyelashes_l",
    "role": "eyelashes_l",
    "label": "本人左のまつげ",
    "side": "l",
    "file": "parts/eyelashes_l.png",
    "rect": {
      "x": 392,
      "y": 309,
      "width": 158,
      "height": 72
    },
    "anchor": [
      466.29,
      336.181
    ],
    "parent": "group_eye_l",
    "order": 161,
    "enabled_in_neutral": true,
    "clip_to": null,
    "generation": {
      "design_id": "e070ff1f5625b9f36f8d84b94e7dc00efee7ed2ce8bb4f30fa82263cb8a8a231",
      "source_role": "eyelashes_l",
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
      "occluded_by": []
    }
  },
  "api_rect": {
    "x": 520,
    "y": 309,
    "width": 158,
    "height": 72
  },
  "prerequisites": [
    "owner-approval",
    "reference-quality-pass",
    "freeze-reference-sha256",
    "same-reference-for-all-parts"
  ]
}
```

## 添付予定の画像一覧

参照生成は文章だけ。以下の5つのeditは、すべて同じ`raw/reference.png`と、それぞれ対応するガイド1枚を送る計画。APIキーや以前のユーザー画像は含めない。

- `guides/face_base.png`：1024×1024 RGBA、矩形と支点のみ。SHA256 `9fd273b6d2a5df9b02e4404db5f4906b494f73d61a67c46f13f6ee85bece1501`。
- `guides/bangs_front.png`：1024×1024 RGBA、矩形と支点のみ。SHA256 `a2926ba52ad51b6596cfcc9d64dbfbbdc248a72eda2fd8366d680ed050c9f1d2`。
- `guides/eye_white_l.png`：1024×1024 RGBA、矩形と支点のみ。SHA256 `d85847be61b81e2cbb78ab0db4a45e59d5b3b6885e715a1dbf987035481c7ae3`。
- `guides/iris_l.png`：1024×1024 RGBA、矩形と支点のみ。SHA256 `f4354cb455b31b2f49abf8b93b4160a25f753d03d82098cc6887804415f4f450`。
- `guides/eyelashes_l.png`：1024×1024 RGBA、矩形と支点のみ。SHA256 `2687b3770f7424d58ff834478610179d4693e7873eb3e109d3292eb8046db80c`。
