# Third-party runtime notice

The research harness calls unmodified Inox2D and its OpenGL renderer at `d4dd9dd7f16b775042cbda44370570abf9a8cf81`, including its official WebGL example as the API reference. The upstream source is fetched by Cargo; no runtime source or compiled WebAssembly is vendored here.

## Inox2D BSD 2-Clause notice

```text
Copyright (c) 2022 Speykious <speykious@gmail.com> and Inochi2D Project

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
SUCH DAMAGE.

```

## Other dependencies and model files

`Cargo.lock` pins the resolved 56 third-party packages. See DEPENDENCIES.md for their SPDX declarations (including Unicode-3.0 in unicode-ident); those declarations do not replace full license or applicable NOTICE texts in a distributed binary package. Rust standard-library/toolchain licenses must also be accounted for if distributing the resulting module.

Model art, rigs, logos and fonts are not covered by this runtime license merely because their container is INP/INX. This harness ships no model or branded assets. Its input is a trusted locally generated research fixture, not an untrusted public upload.
