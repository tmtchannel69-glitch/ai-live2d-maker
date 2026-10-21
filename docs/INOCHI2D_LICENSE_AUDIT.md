# Stable Inochi2D dependency LICENSE sources

Checked 2026-10-21, read-only source audit. Parent pins: SDK v0.8.6 `dda3a8f005f808104caa43183ab8753fb989e30f`; Creator v0.8.6 `371e5f4e21117102dbecc82371bfd9a6e2f5df02`.

固定した3つの上流tag/revisionのtracked filesにCargo.lock / dub.selections.jsonなし（試験用wrapperの新規Cargo.lockとは区別）。下表はmanifestで指定された基準版の上流LICENSE本文であり、範囲指定を解決した最終依存一覧ではない。推移的依存は未監査。

| Package | Version | License | 確認済み上流本文 / 条件anchor |
|---|---|---|---|
| imagefmt | 2.1.0 | BSD-2-Clause | [LICENSE L1](https://github.com/lgvz/imagefmt/blob/v2.1.0/LICENSE#L1), 再配布条件L3-11 |
| inmath | 1.3.0 | MIT | [LICENSE L5](https://github.com/Inochi2D/inmath/blob/v1.3.0/LICENSE#L5), 保持条件L17-18 |
| i2d-opengl | 1.0.0 | Boost Software License 1.0 | [LICENSE_1_0.txt L1](https://github.com/Inochi2D/i2d-opengl/blob/v1.0.0/LICENSE_1_0.txt#L1), 保持/object code例外L10-15 |
| fghj | 1.0.2 | Boost Software License 1.0 | [LICENSE.md L1](https://github.com/Inochi2D/fghj/blob/v1.0.2/LICENSE.md#L1), 保持/object code例外L10-15 |
| numem | 0.11.1 | BSD-2-Clause | [固定SHA LICENSE L1](https://github.com/Inochi2D/numem/blob/8f3a5256525f2d997826a5e73d68663cd9b4961a/LICENSE#L1), 再配布条件L9-14 |
| silly (SDK full構成) | 1.1.1 | ISC | [LICENSE L1](https://gitlab.com/ohboi/silly/-/blob/v1.1.1/LICENSE#L1), 保持条件L3-5 |
| psd-d | 0.6.1 | BSD 2-clause宣言のみ | **本文未確認・未同梱**。[dub.sdl L4-5](https://github.com/Inochi2D/psd-d/blob/623d6dcbca850f46ef6217a708f96876c6659175/dub.sdl#L4) |
| kra-d | 0.5.6 | BSD-2-Clause | [LICENSE L1](https://github.com/Inochi2D/kra-d/blob/v0.5.6/LICENSE#L1), 再配布条件L9-14 |
| i2d-imgui | 0.8.0 | Boost Software License 1.0 | [LICENSE L1-2](https://github.com/Inochi2D/i2d-imgui/blob/v0.8.0/LICENSE#L1), 保持/object code例外L11-16 |
| bindbc-sdl | 1.1.2 | Boost Software License 1.0 | [LICENSE_1_0.txt L1](https://github.com/BindBC/bindbc-sdl/blob/v1.1.2/LICENSE_1_0.txt#L1), 保持/object code例外L10-15 |
| dcv (:core) | 0.3.0 | Boost Software License 1.0 | [LICENSE_1_0.txt L1](https://github.com/libmir/dcv/blob/v0.3.0/LICENSE_1_0.txt#L1), 保持/object code例外L10-15 |
| tinyfiledialogs (tinyfiledialogs-d) | 0.10.1 | Zlib | [LICENSE L1](https://github.com/dayllenger/tinyfiledialogs-d/blob/v0.10.1/LICENSE#L1), 商用含む許可L10-12・条件L14-20 |

本文確認方法: SDK側6件はgit tagのLICENSE blobを読み、Creator側はtagのLICENSE本文を直接取得。psd-dはtag SHA `623d6dcbca850f46ef6217a708f96876c6659175` の全tracked filesにLICENSE本文・ソース内許諾文が見つからず、manifest宣言のみ。i18n-d ~>1.0.2 は当該パッケージの同定・LICENSE確認未了。

SDK側検証tag SHAs: imagefmt `1cfa8dfc300375ed64befac2a7ebf8fdb004ee0f`; inmath `2c01e45dff04775c7089854934f630707f530973`; i2d-opengl `985ab89dd82aafc7f0733e855096a38b4a612762`; fghj `cb73df65e289c820e801c62401c8048c03c806bf`; numem v0.11.1 `8f3a5256525f2d997826a5e73d68663cd9b4961a`; silly `9c7743d73b7dae6c7ec841fe719d0a04a99096b9`.

## SDK v0.8.6と比較版v0.8.7の確認範囲

今回の選択基準はSDK v0.8.6。固定[dub.sdl L6–18](https://github.com/Inochi2D/inochi2d/blob/dda3a8f005f808104caa43183ab8753fb989e30f/dub.sdl#L6)の全直接依存指定を読み、v0.8.7との`dub.sdl`/`LICENSE`の差分を確認した。manifestの変更はnumemだけ（v0.8.6の`~>0.11.1`→v0.8.7の`~>0.20.1`）で、imagefmt/inmath/i2d-opengl/fghj/sillyの指定とSDK LICENSE本文は同一。したがって他の上記5件の確認済みLICENSE参照はv0.8.6の宣言基準版にも該当する。numemはv0.11.1を改めて確認し、表とtag SHAを訂正した。

numem v0.11.1の著作権は2023 Inochi2D Project、BSD2許可L6–7・ソース保持L9–10・バイナリ再掲L12–14・免責L16–25。v0.11.1の[dub.sdl L8](https://github.com/Inochi2D/numem/blob/8f3a5256525f2d997826a5e73d68663cd9b4961a/dub.sdl#L8)にはoptionalなtinyd-rt指定もあるが、これは実際のCreator配布物への組込み確認や全推移的依存のライセンス確認ではない。範囲指定で実解決された依存版と公式Creatorバイナリの全内包物を、上記の宣言基準版LICENSE確認だけで確定しない。

## Creator bundled fonts

Versions below were read with fontTools from the actual pinned Creator binaries (name ID5); binary use is in [source/creator/core/font.d L41-44](https://github.com/Inochi2D/inochi-creator/blob/371e5f4e21117102dbecc82371bfd9a6e2f5df02/source/creator/core/font.d#L41).

| Font | 実物version | 確認内容 / source |
|---|---|---|
| Noto Sans | 2.008 | 実物name ID13はSIL OFL1.1。固定Creator [notice L1](https://github.com/Inochi2D/inochi-creator/blob/371e5f4e21117102dbecc82371bfd9a6e2f5df02/res/NotoSans-Regular-LICENSE#L1) はOFL宣言とURLのみ。一般の上流OFL本文は [notofonts/noto-fonts LICENSE L3](https://github.com/notofonts/noto-fonts/blob/main/LICENSE#L3) を取得・確認済み。ただしmainはこのfont binaryの元commitとの同定ではない。実物copyrightはGoogle LLC 2015-2021。 |
| Noto Sans CJK | 2.004 | 実物name ID13はSIL OFL1.1。固定Creator [notice L1](https://github.com/Inochi2D/inochi-creator/blob/371e5f4e21117102dbecc82371bfd9a6e2f5df02/res/NotoSansCJK-Regular-LICENSE#L1) はOFL宣言とURLのみ。実物copyrightはAdobe 2014-2021。該当releaseの上流LICENSEファイルは今回未同定。 |
| Material Icons | 1.017 | 固定Creatorに[Apache-2.0全文 L2](https://github.com/Inochi2D/inochi-creator/blob/371e5f4e21117102dbecc82371bfd9a6e2f5df02/res/MaterialIcons-LICENSE#L2)、再配布条件L90以降。同じ上流本文も [google/material-design-icons LICENSE L2](https://github.com/google/material-design-icons/blob/master/LICENSE#L2) で確認済み（元font release commitとの同定ではない）。 |
| OpenDyslexic | 0.920 | **記載不整合**。固定Creator [付属テキスト L13-23](https://github.com/Inochi2D/inochi-creator/blob/371e5f4e21117102dbecc82371bfd9a6e2f5df02/res/OpenDyslexic-LICENSE#L13) は旧Bitstream Vera条件。実物name ID13には2019 Abbie Gonzalez / Reserved Font Name OpenDyslexic / OFL1.1全文がある。該当版上流LICENSE URLは未確認。 |

OpenDyslexic実物SHA256: `c1a0cbf814a75a61abdf0f18143d347222b85e51209f47f8b685a1e0ca594b88`。

この表はSDL2/FreeType/cimgui/FFmpeg/codec等の推移的・同梱ネイティブ依存のライセンスを確定しない。i2d-imguiのBoost表示はそれらの許諾を代替しない。
