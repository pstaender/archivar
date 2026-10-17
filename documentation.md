# archivar

Archive photos, scans, documents and PDFs in the browser – on desktop and on the phone.

- Upload one or many files via button or drag & drop, or take a photo with the phone camera
- Edit images: crop, perspective correction, rotation, brightness, contrast, saturation, hue, grayscale, black & white, noise removal, auto levels – with live preview
- "Entrauschen" with [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html): edge-preserving smoothing (bilateral filter) and, in black & white, removal of isolated specks; clicking again increases the strength (Leicht, Mittel, Stark, Aus)
- "Auto-Drehen" turns photos upright using Tesseract's orientation detection; "Auto-Zuschnitt" finds the page or photo outline with OpenCV and crops (or straightens) it. Uploads with OCR are turned upright automatically
- Automatic dewarping of curved/bent pages with [UVDoc](https://github.com/tanguymagne/UVDoc), running server-side via ONNX Runtime
- "Automatisch SW": finds brightness, contrast and threshold for black and white; clicking again cycles through variants (best guess, darker, lighter). Uploads with "Nach dem Upload erkennen" are converted automatically before OCR, and also dewarped if "Automatisch entzerren" is switched on (off by default)
- Image view with zoom (fit, steps up to 400 %, 100 %); "Vorschau" in the editor renders the final image at full resolution with a 100 % magnifier
- Text recognition (OCR) with Tesseract.js, editable recognized text, full-text search. Unsure, probably misread text parts are left out unless "Alle Textteile erkennen" is enabled
- The text tab shows the detected language of the text and can recognize it again in another language (21 languages; the language data is downloaded on first use)
- "PDF" in the text tab downloads the edited image as a searchable PDF: the (edited) text lies invisibly on the recognized line positions, so it can be searched and copied in any PDF viewer
- Sort the overview and folders by change date, upload date or name; inside a folder also in an own order arranged by dragging cards (mouse, touch, or keyboard via the grip)
- Group documents into ordered stacks with a title
- Hierarchical folders as labels (e.g. `wichtig/2026`); selected documents and stacks can be moved into or added to existing folders (or a new one), or removed from the folder being viewed
- "PDF" for a selection downloads all its images (as searchable pages) and PDFs, including the documents of selected stacks, as one PDF
- "Einstellungen" (sidebar, stored per user on the server), in three tabs: "Bildgrößen" – the image resolution in exported PDFs (300 DPI for A4 by default, 150 DPI, or original); "Bildbearbeitung" – how uploads with OCR are prepared (black & white – the default –, grayscale, "Auto-Rotation" which only turns them upright, or original) and "Automatisch entzerren"; "OCR" – "Nach dem Upload erkennen" and "Alle Textteile erkennen". In PDFs, black-and-white pages are stored as lossless 1-bit images (about 150–200 KB per A4 text page at 300 DPI), others as JPEG
- REST API, SQLite database, multi-user ready (currently a single default user without login)

## Getting started

```sh
bun install
bun run dev
```

Open http://localhost:3000. Data is stored in `./data` (database, files, OCR language data).
On first OCR run the language data (`deu`, `eng`) is downloaded once, the orientation model (`osd`, 10 MB) on first automatic rotation.

For automatic dewarping, export the UVDoc model once (needs `git` and [`uv`](https://docs.astral.sh/uv/); Python is only used for the export):

```sh
bun run setup:uvdoc
```

Without `models/uvdoc.onnx` the app works normally, the "Automatisch entzerren" button is just hidden.

Optional: with [ImageMagick](https://imagemagick.org) installed (`brew install imagemagick`, `apt install imagemagick`), HEIC/HEIF, AVIF, WebP, JPEG XL and JPEG 2000 can be uploaded, edited and OCRed as well. The formats your ImageMagick build can read are detected at startup.

## Configuration

| Variable                 | Default                    | Description                    |
| ------------------------ | -------------------------- | ------------------------------ |
| `PORT`                   | `3000`                     | HTTP port                      |
| `ARCHIVAR_DATA_DIR`      | `./data`                   | Database, files, OCR cache     |
| `ARCHIVAR_DATABASE`      | `<data>/archivar.sqlite`   | SQLite file                    |
| `ARCHIVAR_OCR_LANGS`     | `deu+eng`                  | Tesseract languages            |
| `ARCHIVAR_MAX_UPLOAD_MB` | `512`                      | Max request body size          |
| `ARCHIVAR_UVDOC_MODEL`   | `models/uvdoc.onnx`        | UVDoc ONNX model               |

## API

| Method | Path                                | Description                                   |
| ------ | ----------------------------------- | --------------------------------------------- |
| GET    | `/api/me`                           | Current user                                  |
| GET    | `/api/config`                       | Feature flags (`dewarpAvailable`, `convertibleImageTypes`) |
| GET    | `/api/settings`                     | User settings (`autoOcr`, `autoDewarp`, `ocrAllText`, `uploadEnhancement`, `pdfImageQuality`) |
| PATCH  | `/api/settings`                     | Update user settings (unknown values are ignored) |
| GET    | `/api/library?folder=&q=&sort=`     | Stacks and loose documents; `sort`: `updated` (default), `created-desc`, `created-asc`, `title-asc`, `title-desc`, `custom` |
| PUT    | `/api/folders/order`                | Store the own order `{ folder, items: [{ type, id }] }` of a folder |
| GET    | `/api/documents?folder=&q=&stackId=`| Documents                                     |
| POST   | `/api/documents`                    | Upload (`multipart`: `files[]`, `folders`, `stackId`, `ocr`, `ocrAllText`; left-out OCR fields follow the user's settings) |
| GET    | `/api/documents/:id`                | Document                                      |
| PATCH  | `/api/documents/:id`                | Update `title`, `editSettings`, `ocrText`, `folders` |
| DELETE | `/api/documents/:id`                | Delete document and files                     |
| POST   | `/api/documents/:id/ocr`            | Queue OCR; `{ allText: true }` keeps unsure text parts, `{ languages: ["fra"] }` sets the recognition languages (`null`: default) |
| POST   | `/api/documents/:id/dewarp`         | Predict UVDoc grid for `{ rotation }` (store it via `editSettings.dewarp`) |
| POST   | `/api/documents/:id/orientation`    | `{ rotation }` that turns the original upright, `null` if unsure |
| POST   | `/api/documents/:id/auto-crop`      | Page outline `{ corners }` for unsaved `{ editSettings }` (rotation/dewarp), `null` if none |
| POST   | `/api/documents/:id/auto-bw`        | Black-and-white variants `{ brightness, contrast, bwThreshold }[]` for `{ editSettings }`, best first |
| POST   | `/api/documents/:id/render`         | Full-resolution JPEG of unsaved `{ editSettings }` (not stored) |
| POST   | `/api/documents/:id/pdf`            | Searchable PDF of the edited image with `{ text }` (default: stored OCR text) |
| POST   | `/api/export/pdf`                   | One PDF of `{ documentIds, title? }` in order (images as searchable pages, PDF pages copied, other files left out) |
| GET    | `/api/documents/:id/{file,preview,image,thumbnail}` | Original, editor preview, edited image, thumbnail |
| GET    | `/api/stacks`                       | Stacks                                        |
| POST   | `/api/stacks`                       | Create from `documentIds`                     |
| GET    | `/api/stacks/:id`                   | Stack with documents                          |
| PATCH  | `/api/stacks/:id`                   | Update `title`, `folders`, `documentIds` (order/membership) |
| DELETE | `/api/stacks/:id`                   | Dissolve stack (documents stay)               |
| POST   | `/api/stacks/:id/documents`         | Append documents                              |
| GET    | `/api/folders`                      | Folders with counts                           |
| POST   | `/api/folders`                      | Create folder                                 |
| PATCH  | `/api/folders/:id`                  | Rename (incl. sub-folders, merges on conflict)|
| DELETE | `/api/folders/:id`                  | Delete folder and sub-folders                 |
| GET    | `/api/tokens`                       | API tokens (name, prefix, created, last used) |
| POST   | `/api/tokens`                       | Create `{ name }`; the response contains the `token`, shown only once |
| DELETE | `/api/tokens/:id`                   | Revoke a token                                |

### Using the API from scripts

Create a token under „Einstellungen" → „API" and send it as `Authorization: Bearer <token>`. Requests with an unknown or revoked token get `401`. Only a SHA-256 hash of each token is stored.
There is no login yet, so requests without a token still act as the default user – do not expose archivar to untrusted networks.

[`scripts/upload.sh`](scripts/upload.sh) uploads files with `curl`:

```sh
ARCHIVAR_TOKEN=arch_… scripts/upload.sh scan.jpg brief.pdf
ARCHIVAR_URL=http://nas:3000 ARCHIVAR_FOLDER=wichtig/2026 ARCHIVAR_OCR=false scripts/upload.sh *.jpg
```

The same with plain `curl`:

```sh
curl -H "Authorization: Bearer $ARCHIVAR_TOKEN" -F "files=@scan.jpg" -F "folders=wichtig/2026" http://localhost:3000/api/documents
```

## Tests

```sh
bun run test
```
