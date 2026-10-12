# InkNotes

Handwritten notes for pen tablets (Huion, Wacom, XP-Pen, Surface). Pressure-sensitive pens, pencil, marker, highlighter, two erasers, lasso, custom paper colours and patterns, vertical multi-page notes, custom shortcuts, PDF/PNG export.

| Folder | What it is |
|---|---|
| `web/` | Browser version (installable as an app). Published automatically with GitHub Pages. |
| `desktop/` | Windows desktop version (Electron). Built automatically by GitHub Actions. |

The drawing code (`renderer.js`) is shared between both. Only the file-saving and export layer differs. Keep the two copies in sync when changing it.

## Use the web version
Settings → Pages → Source: **GitHub Actions**. After the next push to `main` it is live at `https://god-particle16.github.io/ink-notes/`. Open it in Chrome or Edge and click the install icon in the address bar.

## Get the Windows app
Actions tab → **Build Windows app** → Run workflow, then download `InkNotes-Windows` from the finished run. To publish a download on the Releases page, push a tag such as `v1.0.0`. Unzip and run `InkNotes.exe`; nothing needs installing.

## Run from source
`cd desktop && npm install && npm start`

Huion/Wacom pressure: enable **Windows Ink** in the tablet driver.
