# archivar

Archive photos, scans, documents and PDFs in the browser – on desktop and on the phone.

- Upload one or many files via button or drag & drop, or take a photo with the phone camera
- Edit images: crop, perspective correction, rotation, brightness, contrast, saturation, hue, grayscale, black & white, noise removal, auto levels – with live preview
- Text recognition (OCR) with Tesseract.js, editable recognized text, full-text search
- Group documents into ordered stacks with a title
- Hierarchical folders as labels (e.g. `wichtig/2026`)
- REST API, SQLite database, multi-user ready (currently a single default user without login)

## Getting started

```sh
bun install
bun run dev
```

Open http://localhost:3000. Data is stored in `./data` (database, files, OCR language data).
On first OCR run the language data (`deu`, `eng`) is downloaded once.

## Configuration

| Variable                 | Default                    | Description                    |
| ------------------------ | -------------------------- | ------------------------------ |
| `PORT`                   | `3000`                     | HTTP port                      |
| `ARCHIVAR_DATA_DIR`      | `./data`                   | Database, files, OCR cache     |
| `ARCHIVAR_DATABASE`      | `<data>/archivar.sqlite`   | SQLite file                    |
| `ARCHIVAR_OCR_LANGS`     | `deu+eng`                  | Tesseract languages            |
| `ARCHIVAR_MAX_UPLOAD_MB` | `512`                      | Max request body size          |

## API

| Method | Path                                | Description                                   |
| ------ | ----------------------------------- | --------------------------------------------- |
| GET    | `/api/me`                           | Current user                                  |
| GET    | `/api/library?folder=&q=`           | Stacks and loose documents                    |
| GET    | `/api/documents?folder=&q=&stackId=`| Documents                                     |
| POST   | `/api/documents`                    | Upload (`multipart`: `files[]`, `folders`, `stackId`, `ocr`) |
| GET    | `/api/documents/:id`                | Document                                      |
| PATCH  | `/api/documents/:id`                | Update `title`, `editSettings`, `ocrText`, `folders` |
| DELETE | `/api/documents/:id`                | Delete document and files                     |
| POST   | `/api/documents/:id/ocr`            | Queue OCR                                     |
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

## Tests

```sh
bun run test
```
