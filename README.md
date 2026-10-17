# Archivar
## A tool for archiving and managing documents (scans, pdfs etc)

The following features are available:

- Upload and manage documents (PDF, images, etc.)
- Automatic OCR (Optical Character Recognition) for text extraction
- Automatic converting of images to black-and-white for better readability
- Grouping documents into stacks
- Organizing documents into folders
- Export file(s) as searchable PDF

- Optional login with a password or passkeys (reset with `bun run password`)
- REST API with personal access tokens, e.g. to upload from a script ([example](scripts/upload.sh))

[More details in the software documentation.](documentation.md)

## Requirements

- bun
- [ImageMagick](https://imagemagick.org/) (optional)

## Uploading via the API

Create a token under „Einstellungen" → „API", then:

```sh
ARCHIVAR_TOKEN=arch_… scripts/upload.sh scan.jpg brief.pdf

# or with curl directly
curl -H "Authorization: Bearer $ARCHIVAR_TOKEN" -F "files=@scan.jpg" http://localhost:3000/api/documents
```

## About this project

This tool is vibe coded: most of the code was written by an AI coding assistant. It is nevertheless tested – by an automated test suite and by humans who actually use it.

## Upcoming features

- multi language support (i18n), currently german only
- user management

## License

MIT
