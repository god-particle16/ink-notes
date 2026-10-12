const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win;
const autosavePath = () => path.join(app.getPath('userData'), 'autosave.inknote');

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#1b1c20', title: 'InkNotes', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  Menu.setApplicationMenu(null);
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

ipcMain.handle('save-note', async (_e, text, name) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: (name || 'Untitled') + '.inknote',
    filters: [{ name: 'InkNotes note', extensions: ['inknote'] }]
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, text, 'utf8');
  return path.basename(filePath, path.extname(filePath));
});

ipcMain.handle('open-note', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    filters: [{ name: 'InkNotes note', extensions: ['inknote', 'json'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths[0]) return null;
  return {
    name: path.basename(filePaths[0], path.extname(filePaths[0])),
    text: fs.readFileSync(filePaths[0], 'utf8')
  };
});

ipcMain.handle('export-png', async (_e, dataUrl, name) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: (name || 'page') + '.png',
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return filePath;
});

ipcMain.handle('export-pdf', async (_e, images, name) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: (name || 'Untitled') + '.pdf',
    filters: [{ name: 'PDF document', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return null;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:0}
    html,body{margin:0;padding:0}
    img{display:block;width:210mm;height:296.6mm;page-break-after:always}
    img:last-child{page-break-after:auto}
  </style></head><body>${images.map(s => `<img src="${s}">`).join('')}</body></html>`;
  const tmp = path.join(app.getPath('temp'), 'inknotes-export-' + Date.now() + '.html');
  fs.writeFileSync(tmp, html);
  const w = new BrowserWindow({ show: false });
  try {
    await w.loadFile(tmp);
    await w.webContents.executeJavaScript(
      'Promise.all([...document.images].map(i=>i.decode?i.decode():Promise.resolve()))');
    const pdf = await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(filePath, pdf);
  } finally {
    w.destroy();
    fs.unlink(tmp, () => {});
  }
  shell.showItemInFolder(filePath);
  return filePath;
});

ipcMain.handle('autosave', (_e, text) => { try { fs.writeFileSync(autosavePath(), text, 'utf8'); } catch (e) {} });
ipcMain.handle('load-autosave', () => { try { return fs.readFileSync(autosavePath(), 'utf8'); } catch (e) { return null; } });
