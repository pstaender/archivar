# archivar

Web app for archiving photos, scans, documents and PDFs: upload (incl. phone camera), edit images, OCR, stacks and folders.

## Stack

- Runtime/server: **Bun** (`Bun.serve` with route table, `bun:sqlite`). No Express, no Vite – Bun bundles `src/client/index.html` itself.
- Frontend: **React 19** + **react-router**, icons from **lucide-react**.
- Language: **TypeScript** everywhere (strict, `noUncheckedIndexedAccess`).
- Styling: plain modern CSS with custom properties (`src/client/styles/`). **No CSS framework, no SASS/SCSS.** Native nesting is fine.
- Images: **Jimp** assembled from its `@jimp/*` packages in `src/shared/image/jimp.ts` (the `jimp` meta package ships a broken browser build). The same pipeline (`src/shared/image/pipeline.ts`) renders the live preview in the browser and the final image on the server.
- OCR: **tesseract.js** on the server (`deu+eng` by default, language data cached in `data/tessdata`).
- PDFs: **unpdf** (text extraction, page rendering via `@napi-rs/canvas`).
- Automatic dewarping: **UVDoc** exported to ONNX (`models/uvdoc.onnx`, not in git, create with `bun run setup:uvdoc`), run with **onnxruntime-node** in `src/server/services/dewarp.ts`. The model only predicts a 2×45×31 grid; `src/shared/image/unwarp.ts` ports UVDoc's `bilinear_unwarping` (interpolate + grid_sample, `align_corners=True`) so the browser preview uses the same grid. Without the model the feature is hidden (`/api/config`).

## Commands

```sh
bun install
bun run dev          # hot reload, http://localhost:3000
bun run start        # production
bun run test         # server + shared tests, then client tests
bun run test:server  # src/server + src/shared
bun run test:client  # src/client with happy-dom preload
bun run typecheck
bun run setup:uvdoc  # one-time: export UVDoc to models/uvdoc.onnx (needs uv + git)
```

Do not run a bare `bun test`: client tests need the happy-dom preload, server tests must run without it (happy-dom replaces `fetch`/`Request`).

## Layout

- `src/shared/` – code used by client and server: types (API DTOs), edit settings normalization, folder path helpers, image pipeline (perspective warp, median denoise).
- `src/server/` – `index.ts` (entry), `routes.ts` (REST API), `context.ts` (wiring + current user), `db/` (migrations + repositories), `services/` (archive logic, imaging, OCR queue, PDF), `storage.ts` (files under `data/files`).
- `src/client/` – `pages/`, `components/`, `editor/` (canvas preview, corner overlay, controls), `hooks/` (contexts for toasts, folders, uploads).
- `test/` – test helpers (`server.ts` starts an API server on a random port with in-memory SQLite and a fake OCR engine; `client.tsx` has fetch mocks and render helpers).

## Domain rules

- Multi-user data model (`user_id` on every table) but no login yet: `context.currentUser()` always returns the `default` user. Keep every query scoped by user id.
- Folders are labels with hierarchical paths (`wichtig/2026`). Filtering by a folder includes its sub-folders. Documents and stacks can have many folders.
- A stack groups documents in order. Empty stacks are deleted automatically.
- Edit settings are stored as JSON on the document and always pass through `normalizeEditSettings`. The original file is never modified; derived files (`preview.jpg`, `processed.jpg`, `thumbnail.jpg`) live in `data/files/derived/<id>/`.
- Pipeline order: rotate → dewarp grid → crop/perspective → denoise → levels/brightness/contrast → color.
- A dewarp grid is stored in the edit settings together with the rotation it was predicted for; it is dropped when the rotation changes. Crop/perspective corners are normalized (0..1) relative to the rotated (and dewarped) image.
- Auto B/W (`src/shared/image/autoBw.ts`) analyses the image after geometry/denoise: brightness/contrast stretch the luma range, variants differ only in the threshold (Otsu first, then darker, then lighter). The client caches variants per geometry and cycles through them on repeated clicks.
- Uploads with `ocr=true` run dewarp (if the model exists) and the best auto B/W variant before rendering and OCR.
- OCR drops probable noise by default (`src/server/services/ocrFilter.ts`: low-confidence lines, lines without a real word, very unsure words) and stores the count in `ocr_removed`. `allText` (upload field `ocrAllText`, body of `POST /ocr`) keeps everything.
- OCR runs asynchronously in `OcrQueue`; clients poll while status is `pending`/`running`.
- UI is German, monochrome (grays only). Colors only for error/warning/success via `--color-danger|warning|success`.

## Conventions

- Code, identifiers and commits in English. UI strings in German.
- No comments unless the reason for the code is not evident from the code itself.
- Prefer maintained npm packages over hand-written code; add new design tokens to `tokens.css` instead of hard-coding values.
- Write tests for new behavior: API tests in `src/server/*.test.ts` via `startTestServer()`, component tests next to the component.
- Commit automatically when a piece of work is done and tests pass. **Never push.**
