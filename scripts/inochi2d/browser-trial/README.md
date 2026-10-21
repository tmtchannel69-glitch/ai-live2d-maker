# Inox2D baseline browser research

This is an isolated research harness for AI Live2D Maker. It uses unmodified
Inox2D `d4dd9dd7f16b775042cbda44370570abf9a8cf81` (core/renderer 0.3.0) to test
whether a generated legacy INP can load and animate in WebGL2. It does not change
the app or turn this runtime into a Live2D/VTube Studio implementation.

The WebAssembly build and browser load succeeded. The pinned runtime still
fails the complete blink criterion: `ParamCtx::apply` skips exact `(0,0)` values,
and `BindingValues::Opacity` has no implementation. The harness passes parameter
values unchanged and records that failure. The `0.0001` sample is a diagnostic
comparison, not a replacement for the requested closed value or a passing result.

## Rebuild

Requirements: Rust 1.90.0 with the wasm32-unknown-unknown target,
wasm-bindgen-cli **0.2.100**, Node dependencies from this repository, and Chromium.
The `Cargo.lock` pins the resolved third-party versions. The runtime is fetched
from its exact Git revision; it is not copied into this repository.

```sh
rustup toolchain install 1.90.0 --profile minimal --target wasm32-unknown-unknown
# Obtain wasm-bindgen-cli 0.2.100 from its official release or cargo install.
cargo +1.90.0 build --manifest-path scripts/inochi2d/browser-trial/Cargo.toml \
  --locked --target wasm32-unknown-unknown --release --target-dir /tmp/inox-target

mkdir -p /tmp/inox-web/pkg
wasm-bindgen --target web --out-dir /tmp/inox-web/pkg \
  /tmp/inox-target/wasm32-unknown-unknown/release/inochi_browser_preview.wasm
cp scripts/inochi2d/browser-trial/index.html scripts/inochi2d/browser-trial/main.mjs /tmp/inox-web/
cp /path/to/trusted/generated-model.inp /tmp/inox-web/minimal.inp
node scripts/inochi2d/browser-trial/verify.mjs /tmp/inox-web /tmp/new-inox-browser-report
```

The output directory must be new. The verifier serves only fixed files over a
temporary loopback HTTP server and closes it afterwards. The cloud's localhost
is not an access URL for a user's Windows PC or phone. No public hosting is used.
Compiled bindings, WASM, model inputs and screenshots belong outside Git.

The controlled fixture must contain parameters `EyeOpenL`, `EyeOpenR` in [0,1]
and `HeadX` in [-1,1]. The preview is 384×480, camera scale 1.2, and model
coordinates are centered at the origin. The parent fixture uses five Part nodes.
This is not a general uploader: the upstream parser and image decoder have not
been hardened here. The 16 MiB byte guard is not a decoded-image memory limit.
Production integration must independently validate texture counts/dimensions,
decoded budgets, node/binding complexity and unsupported features.

## Recorded results

For the common metadata fixture with SHA256
`18fbffbfa3816f268585fd68e9cffac5954e109a6cb5e423149d847dc43bc5dc`:

- Real WebGL2 load succeeded in cloud Chromium; page/console errors: 0.
- Eye value 0.5 changed 1,979 pixels and the deformation buffer by up to 6.5475.
- Both eyes at exact 0 changed 0 pixels and 0 deformation values from fully open.
- Head -1/+1 changed 15,138/15,137 pixels. All sampled deformations stayed finite.
- Dynamic opacity is ignored, so the closed eyelid line appears while open.

The initial valid official-SDK fixture omitted optional `meta.artist` and other
fields and was rejected by the stricter Inox parser. A metadata-complete fixture
was generated separately, with image/mesh/binding content unchanged. Do not
discard this schema difference when claiming cross-runtime compatibility.

These are synthetic-fixture diagnostics, not natural-character quality,
smartphone hardware, official Live2D Core or VTube Studio acceptance tests.
See THIRD_PARTY.md and DEPENDENCIES.md for license records and distribution limits.
