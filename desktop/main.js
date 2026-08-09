const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { SidecarManager } = require('./sidecar');

if (process.platform === 'linux') {
  // Avoid chrome-sandbox setuid requirement on common Linux dev installs.
  app.commandLine.appendSwitch('no-sandbox');
}

const isDev = !app.isPackaged;
let mainWindow = null;
let sidecar = null;
let authToken = '';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function getUserDataDir() {
  return app.getPath('userData');
}

function getAppIconPath() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(__dirname, '..', 'assets', 'icons', 'icon.png'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function getPreloadPath() {
  return path.join(app.getAppPath(), 'desktop', 'preload.js');
}

function createWindow(serverUrl) {
  const iconPath = getAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'PDFEdit',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(serverUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(serverUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function hideApplicationMenu() {
  Menu.setApplicationMenu(null);
}

async function startApp() {
  sidecar = new SidecarManager({
    isDev,
    userDataDir: getUserDataDir(),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });

  try {
    const info = await sidecar.start();
    authToken = info.authToken;
    createWindow(info.url);
    hideApplicationMenu();
  } catch (error) {
    const errorWindow = new BrowserWindow({
      width: 720,
      height: 420,
      resizable: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const html = fs.readFileSync(path.join(__dirname, 'error.html'), 'utf8')
      .replace('__ERROR_MESSAGE__', String(error.message || error));
    await errorWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }
}

app.whenReady().then(startApp);

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('before-quit', async (event) => {
  if (!sidecar) return;
  event.preventDefault();
  await sidecar.stop();
  sidecar = null;
  app.exit(0);
});

ipcMain.handle('desktop:get-app-info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  dataDir: getUserDataDir(),
}));
ipcMain.handle('desktop:quit', () => {
  app.quit();
  return true;
});
ipcMain.handle('desktop:get-version', () => app.getVersion());
ipcMain.handle('desktop:get-auth-token', () => authToken);
ipcMain.handle('desktop:open-file', async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: options.filters || [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePaths.length) return [];
  return result.filePaths.map((filePath) => {
    const buffer = fs.readFileSync(filePath);
    return {
      name: path.basename(filePath),
      type: 'application/pdf',
      data: buffer,
      path: filePath,
    };
  });
});
ipcMain.handle('desktop:save-file', async (_event, payload = {}) => {
  const {
    defaultPath,
    data,
    filePath: existingPath,
    filters,
  } = payload;

  let targetPath = existingPath || null;
  if (!targetPath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultPath || 'document.pdf',
      filters: filters || [
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true, filePath: null };
    }
    targetPath = result.filePath;
  }

  const buffer = Buffer.from(data);
  fs.writeFileSync(targetPath, buffer);
  return { ok: true, canceled: false, filePath: targetPath };
});
ipcMain.handle('desktop:show-item-in-folder', async (_event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') return false;
  shell.showItemInFolder(targetPath);
  return true;
});
ipcMain.handle('desktop:open-path', async (_event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') return false;
  const err = await shell.openPath(targetPath);
  return !err;
});
ipcMain.handle('desktop:open-external', async (_event, url) => {
  await shell.openExternal(url);
  return true;
});
