# Draco decoder (three.js build)

Draco is an open-source library by Google for compressing and decompressing 3D meshes
([website](https://google.github.io/draco/), [GitHub](https://github.com/google/draco)).

The three files in this folder are the browser decoder that three.js's `DRACOLoader` uses to read
`../models/school/hub.glb` (Draco-compressed, `KHR_draco_mesh_compression`):

- `draco_decoder.js` — Emscripten-compiled decoder (fallback, any modern browser)
- `draco_decoder.wasm` — WebAssembly decoder
- `draco_wasm_wrapper.js` — JavaScript wrapper for the WASM decoder

Copied unchanged from the installed `three` 0.185.1 package, `examples/jsm/libs/draco/gltf/`
(the glTF-extension build), on 2026-11-02 (AI 학교 탈출 Task 23). Nothing was downloaded. The game loads it with
`useGLTF(url, "/draco/")`.

## License

Apache License 2.0 — Copyright Google LLC / The Draco authors. The full license text:
https://www.apache.org/licenses/LICENSE-2.0 (also https://github.com/google/draco/blob/master/LICENSE).
The decoder files are redistributed here unmodified; this note travels with them. The project's own
asset list is `docs/licenses.md`.
