# InkNotes

Handwritten notes for pen tablets (Huion, Wacom, XP-Pen, Surface) that runs in the browser.

- **Landing page** that explains the site, with a centred **Get started** button that opens your notes
- **Notes home** with all your notes: thumbnails, search, sort, rename, duplicate, delete, import and export
- Pressure-sensitive pen, pencil, marker, highlighter, two erasers, lasso
- Custom paper colours and patterns (blank, ruled, grid, dotted), vertical multi-page notes
- Custom keyboard shortcuts, PDF and PNG export
- Works on phones, tablets and desktops; installable as an app; works offline

Notes are saved automatically in the browser (IndexedDB). Use **⋯ → Export file** on a note for a backup you can keep.

## Pages
| Address | Shows |
|---|---|
| `…/ink-notes/` | landing page |
| `…/ink-notes/#/` | notes home (the installed app opens here) |
| `…/ink-notes/#/note/<id>` | a note |

## Publish
Settings → Pages → Source: **GitHub Actions**. Every push to `main` that touches `web/` updates the site at `https://god-particle16.github.io/ink-notes/`.
The publish step gives each release its own offline cache (it writes the commit id into `web/sw.js`). Returning visitors load straight from that cache, and a new release replaces it by itself the next time they are on the notes list (it never reloads while a note is open).

## Run locally
Open `web/index.html` in Chrome or Edge. Locally the offline cache is switched off, so changes show up on a normal reload.

Huion/Wacom pressure: enable **Windows Ink** in the tablet driver.
