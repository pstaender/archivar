# archivar

Web app for archiving photos, scans, documents and PDFs: upload (incl. phone camera), edit images, OCR, stacks and folders.

## Stack

- Runtime/server: **Bun** (`Bun.serve` with route table, `bun:sqlite`). No Express, no Vite – Bun bundles `src/client/index.html` itself.
- Frontend: **React 19** + **react-router** as a data router (`createBrowserRouter(routes)` from `src/client/App.tsx`; needed for `useBlocker`). Folders are routes: `/folders/wichtig/2026`, built with `folderHref()` in `src/client/routes.ts`. Client tests render through `renderApp()` (`createMemoryRouter`, returns the `router`).
- Icons: **Keyline Icons** (`@iconify-json/keyline-icons`). Add an icon to `src/client/icons/index.tsx`; the `keyline()` macro inlines the SVG at bundle time, so never import the 7 MB icon JSON elsewhere.
- Font: **Inter** variable (`@fontsource-variable/inter`, Latin subsets declared in `styles/fonts.css`).
- Language: **TypeScript** everywhere (strict, `noUncheckedIndexedAccess`).
- Styling: plain modern CSS with custom properties (`src/client/styles/`). **No CSS framework, no SASS/SCSS.** Native nesting is fine.
- Images: **Jimp** assembled from its `@jimp/*` packages in `src/shared/image/jimp.ts` (the `jimp` meta package ships a broken browser build). The same pipeline (`src/shared/image/pipeline.ts`) renders the live preview in the browser and the final image on the server.
- OCR: **tesseract.js** on the server (`deu+eng` by default, language data cached in `data/tessdata`). Orientation detection (`OcrEngine.detectOrientation`) needs the legacy engine, so it runs in a second worker with `osd.traineddata`; results below confidence 2 are ignored.
- PDFs: **unpdf** (text extraction, page rendering via `@napi-rs/canvas`).
- Denoise: **OpenCV.js** (`@techstark/opencv-js`, ~11 MB). `src/shared/image/denoise.ts` uses `bilateralFilter` and, after B/W, `connectedComponentsWithStats` to drop isolated specks (marks near text are kept). The server loads it at startup (`src/server/opencv.ts`), the editor's preview worker loads it on demand with `importScripts` from `/vendor/opencv-<version>.js` (served gzipped by `src/server/vendor.ts`) – never import the package in client code. Never `await` the OpenCV module (it is a self-resolving thenable); use `initOpenCv()`. Server tests preload `test/opencv.ts`. The prebuilt OpenCV.js has no `fastNlMeansDenoising`.
- Optional image formats: **ImageMagick** CLI, detected at startup (`MagickConverter.detect()`); tests use `FakeImageConverter` (accepts `image/webp`).
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

- `src/shared/` – code used by client and server: types (API DTOs), edit settings normalization, folder path helpers, image pipeline (perspective warp, OpenCV denoise).
- `src/server/` – `index.ts` (entry), `routes.ts` (REST API), `context.ts` (wiring + current user), `db/` (migrations + repositories), `services/` (archive logic, imaging, OCR queue, PDF), `storage.ts` (files under `data/files`).
- `src/client/` – `pages/`, `components/`, `editor/` (canvas preview, corner overlay, controls), `hooks/` (contexts for toasts, folders, uploads).
- `test/` – test helpers (`server.ts` starts an API server on a random port with in-memory SQLite and a fake OCR engine; `client.tsx` has fetch mocks and render helpers).

## Domain rules

- Multi-user data model (`user_id` on every table) but no login yet: `context.currentUser()` always returns the `default` user. Keep every query scoped by user id.
- Folders are labels with hierarchical paths (`wichtig/2026`). Filtering by a folder includes its sub-folders. Documents and stacks can have many folders. The selection's „Ordner“ dialog (`FolderTargetDialog`) picks existing or new folders: „Hinzufügen“ adds them, „Verschieben“ (`moveToFolders`) removes the folder being viewed and its sub-folders first (in the overview: all folders). Inside a folder, the „Ordner“ button with the minus icon removes the selection from that folder and its sub-folders.
- A stack groups documents in order. Empty stacks are deleted automatically.
- Edit settings are stored as JSON on the document and always pass through `normalizeEditSettings`. The original file is never modified; derived files (`preview-<size>.jpg`, `processed.jpg`, `thumbnail.jpg`) live in `data/files/derived/<id>/`.
- Pipeline order: rotate → dewarp grid → crop/perspective → denoise (smoothing) → levels/brightness/contrast → color → speck removal (B/W only, when denoise > 0). Denoise parameters scale with the image size so the preview matches the final render.
- The editor's base image (`/preview`) is at most `PREVIEW_SIZE` (3000 px, `src/shared/preview.ts`) and is filtered at that size, because threshold/contrast look different on a downscaled image. The size is part of its file name and URL, so changing it regenerates the file (on demand) and busts the browser cache; previews of other sizes are deleted at startup (`removeStalePreviews`). The live preview renders in Web Workers (`src/client/editor/preview.worker.ts` via `PreviewRenderer`, which runs one render at a time and drops superseded ones). Bun's HTML bundler does not bundle workers, so `src/server/vendor.ts` bundles it with `Bun.build` as a classic script at `/assets/preview-worker.js` (rebuilt per request in development, ETag + `no-cache`). `ImageEditor` uses a second worker with a 1200 px copy for drafts: when the last full render took over 250 ms, the draft shows while settings change and the full image once they settle. Browser entry points import `src/shared/bufferGlobal.ts` first (Jimp needs a global `Buffer`). Saturation/hue use `adjustColor` (`src/shared/image/color.ts`), a fast equivalent of Jimp's tinycolor-based `color()`.
- A dewarp grid is stored in the edit settings together with the rotation it was predicted for; it is dropped when the rotation changes. Crop/perspective corners are normalized (0..1) relative to the rotated (and dewarped) image.
- Auto B/W (`src/shared/image/autoBw.ts`) analyses the image after geometry/denoise: brightness/contrast stretch the luma range, variants differ only in the threshold (Otsu first, then darker, then lighter). The client caches variants per geometry and cycles through them on repeated clicks.
- Supported uploads are the Jimp image types and PDF (`src/shared/uploads.ts`, used for the file inputs' `accept` and to skip dropped files). If ImageMagick is installed (`magick`, or IM6 `convert`), HEIC/HEIF/AVIF/WebP/JPEG XL/JPEG 2000 are accepted too (`/api/config` → `convertibleImageTypes`): `src/server/services/magick.ts` converts them to PNG with an explicit coder prefix, the result is cached as `derived/<id>/source.png` and everything else (editor preview, OCR) works on that. The client uploads files one request at a time via `XMLHttpRequest` to show progress; client tests mock it with `mockXhr()`.
- „Auto-Zuschnitt“ (`src/shared/image/autoCrop.ts`, OpenCV) finds the largest four-cornered page outline (Canny edges or Otsu, like z80z80z80/autocrop) in the rotated and dewarped image; almost upright outlines snap to a plain crop, the client opens the matching corner mode so they can be adjusted. „Auto-Drehen“ sets the absolute rotation detected on the original (`POST /orientation`).
- User settings (`src/shared/settings.ts`, `users.settings` JSON, `GET/PATCH /api/settings`) are stored per user on the server and edited in the „Einstellungen“ dialog (sidebar) with the tabs „Bildgrößen“, „Bildbearbeitung“ and „OCR“. The client reads them through `SettingsProvider`/`useSettings` (the upload sends `ocr`, `ocrAllText`, `dewarp` from them); OCR switches that older versions kept in `localStorage` are moved to the server once.
- Uploads with `ocr=true` are prepared according to the setting `uploadEnhancement`: `bw` (default) turns them upright first (Tesseract OSD), then runs the best auto B/W variant; `grayscale` turns them upright and stretches the tone (`autoTone`); `color` („Auto-Rotation“) only turns them upright; `original` leaves them alone. This happens before rendering and OCR; with `dewarp=true` (setting „Automatisch entzerren“, off by default) they are dewarped first if the model exists.
- Languages: OCR runs with `ARCHIVAR_OCR_LANGS` (`/api/config` → `ocrLanguages`) unless the document has its own `ocrLanguages` (set via `POST /ocr` `{ languages }`, list in `src/shared/languages.ts`; `TesseractEngine` switches with `reinitialize`). The language of stored text (OCR, PDF text, edits) is detected with **franc** (`services/language.ts`, ≥ 20 characters) into `ocrLanguage`; texts without one are checked again at startup. Similar languages (Danish/Norwegian) can be confused.
- OCR drops probable noise by default (`src/server/services/ocrFilter.ts`: low-confidence lines, lines without a real word, very unsure words) and stores the count in `ocr_removed`. `allText` (upload field `ocrAllText`, body of `POST /ocr`) keeps everything.
- OCR runs asynchronously in `OcrQueue` (in memory only): at startup `resume()` re-queues documents left `pending`/`running` by a previous process, and each image/PDF page gets `OCR_PAGE_TIMEOUT_MS` (3 min) before the document fails with a German message and the Tesseract worker is replaced. Clients poll with `usePolling` (background `refresh()`, so `loading` does not flicker; gives up after 10 min).
- PDF export (`POST /pdf`, `src/server/services/searchablePdf.ts`, **pdf-lib**): one page with `processed.jpg` (long side 842 pt; scaled to the setting `pdfImageQuality` for A4 with `@napi-rs/canvas` in `pdfImage.ts`: B/W documents become Flate-compressed 1-bit image XObjects written directly, since pdf-lib only embeds 8-bit images; others JPEG q75/q80) and the text as invisible Helvetica (render mode 3, horizontally scaled into each box; characters outside Windows-1252 lose accents or become „?“). OCR stores the kept lines' boxes normalized to 0..1 in `ocr_layout` (not in the DTO; `getOcrLayout`) together with the edit settings they were recognized for. The text is put on those boxes only if the settings are unchanged and the text has the same number of non-empty lines; otherwise lines are spread evenly over the page (only shrunk, never stretched). The „Text“ tab exports the unsaved textarea content. `POST /api/export/pdf` combines several documents (selection „PDF“, stacks expanded in order); uploaded PDFs are copied page by page with pdf-lib (422 if one cannot be read).
- Unsaved edit settings: `useLeaveGuard` (`src/client/hooks/leaveGuard.ts`) holds back route changes (`useBlocker`) and leaving the „Bearbeiten“ tab, and `UnsavedChangesDialog` offers Speichern/Verwerfen/Abbrechen; closing the browser tab only gets the browser's own `beforeunload` question. Call `skipNext()` before navigating away on purpose (e.g. after deleting).
- While crop/perspective corners are shown (also after „Auto-Zuschnitt“), Enter applies them (`EditControls`, ignored in text fields).
- Document page opens on the „Text“ tab. Images are shown with `ZoomableImage` (fit by default, zoom steps from `src/client/zoom.ts`, 100 %, open in new tab). In „Bearbeiten“, „Vorschau“ (`PreviewBar`, `useProcessedPreview`) renders the unsaved draft at full resolution via `POST /api/documents/:id/render` (nothing is stored) and shows it instead of the live canvas, with a 100 % `Magnifier` on mouse hover; any settings change drops it and aborts a running render.
- UI is German, monochrome (grays only). Colors only for error/warning/success via `--color-danger|warning|success`.

## Conventions

- Code, identifiers and commits in English. UI strings in German.
- No comments unless the reason for the code is not evident from the code itself.
- Prefer maintained npm packages over hand-written code; add new design tokens to `tokens.css` instead of hard-coding values.
- Write tests for new behavior: API tests in `src/server/*.test.ts` via `startTestServer()`, component tests next to the component.
- Commit automatically when a piece of work is done and tests pass. **Never push.**
