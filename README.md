# InkNotes

Handwritten notes for pen tablets (Huion, Wacom, XP-Pen, Surface) that runs in the browser.

- **Home page** with all your notes: thumbnails, search, sort, rename, duplicate, delete, import and export
- Pressure-sensitive pen, pencil, marker, highlighter, two erasers, lasso
- Custom paper colours and patterns (blank, ruled, grid, dotted), vertical multi-page notes
- Custom keyboard shortcuts, PDF and PNG export
- Installable as an app, works offline

Notes are saved automatically in the browser (IndexedDB). Use **⋯ → Export file** on a note for a backup you can keep.

## Publish
Settings → Pages → Source: **GitHub Actions**. Every push to `main` that touches `web/` updates the site at `https://god-particle16.github.io/ink-notes/`.

## Run locally
Open `web/index.html` in Chrome or Edge.

Huion/Wacom pressure: enable **Windows Ink** in the tablet driver.
