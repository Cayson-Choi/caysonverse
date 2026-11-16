# Basis Universal transcoder (three.js build)

Basis Universal by Binomial LLC ([GitHub](https://github.com/BinomialLLC/basis_universal)) turns the M1 PBR textures
(`../2k/*.ktx2`, `../1k/*.ktx2`, KTX2 with ETC1S / UASTC payloads) into the GPU's own compressed format (BC7 on PCs,
ETC2 / ASTC on phones). three.js's `KTX2Loader` loads it from here (`client/src/village/pbr/pbrLibrary.ts`,
`setTranscoderPath("/textures/pbr/basis/")`), and only when a PBR set is first requested.

- `basis_transcoder.js` — JavaScript wrapper
- `basis_transcoder.wasm` — WebAssembly transcoder

Copied unchanged from the installed `three` 0.185 package, `examples/jsm/libs/basis/`, by `scripts/build-materials.mjs`
on 2026-11-17. Nothing was downloaded.

## License

Apache License 2.0 — Copyright Binomial LLC. The full license text ships next to the transcoder:
[`LICENSE.txt`](LICENSE.txt) (the Apache-2.0 text, same as `/draco/LICENSE.txt`).
