'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP_ID = 'pdfedit';
const DESKTOP_FILENAME = `${APP_ID}.desktop`;
const ICON_SIZES = ['16x16', '32x32', '48x48', '64x64', '128x128', '256x256', '512x512', '1024x1024'];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function quoteDesktopExec(filePath) {
  // Desktop Entry Spec: escape/quote paths with spaces or special chars.
  if (!/[ \t"'\\><~|&;$*?#()`]/.test(filePath)) return filePath;
  return `"${filePath.replace(/(["`$\\])/g, '\\$1')}"`;
}

function resolveExecPath() {
  if (process.env.APPIMAGE && fs.existsSync(process.env.APPIMAGE)) {
    return process.env.APPIMAGE;
  }
  return process.execPath;
}

function installIconsFromAppDir(appDir, iconsRoot) {
  let copied = 0;
  for (const size of ICON_SIZES) {
    const src = path.join(appDir, 'usr', 'share', 'icons', 'hicolor', size, 'apps', `${APP_ID}.png`);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(iconsRoot, size, 'apps', `${APP_ID}.png`);
    copyFile(src, dest);
    copied += 1;
  }
  return copied;
}

function installFallbackIcon(iconPath, iconsRoot) {
  if (!iconPath || !fs.existsSync(iconPath)) return 0;
  // Install the master icon into common dock sizes so GNOME can find something.
  let copied = 0;
  for (const size of ['48x48', '64x64', '128x128', '256x256', '512x512']) {
    const dest = path.join(iconsRoot, size, 'apps', `${APP_ID}.png`);
    copyFile(iconPath, dest);
    copied += 1;
  }
  // Also place a named icon at the icons root for simpler lookups.
  copyFile(iconPath, path.join(path.dirname(iconsRoot), `${APP_ID}.png`));
  return copied;
}

function writeDesktopFile(desktopPath, execPath) {
  const content = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=PDFEdit',
    'GenericName=PDF Editor',
    'Comment=Desktop PDF editor powered by PyMuPDF and Fabric.js',
    `Exec=${quoteDesktopExec(execPath)} --no-sandbox %U`,
    'Terminal=false',
    `Icon=${APP_ID}`,
    `StartupWMClass=${APP_ID}`,
    'Categories=Office;Graphics;Viewer;',
    'MimeType=application/pdf;',
    'StartupNotify=true',
    'X-GNOME-UsesNotifications=false',
    '',
  ].join('\n');
  ensureDir(path.dirname(desktopPath));
  fs.writeFileSync(desktopPath, content, 'utf8');
}

function refreshDesktopCaches(applicationsDir, iconsRoot) {
  try {
    spawnSync('update-desktop-database', [applicationsDir], { stdio: 'ignore' });
  } catch (_) {
    /* optional */
  }
  try {
    spawnSync('gtk-update-icon-cache', ['-f', '-t', path.dirname(iconsRoot)], { stdio: 'ignore' });
  } catch (_) {
    /* optional */
  }
  try {
    spawnSync('xdg-desktop-menu', ['forceupdate'], { stdio: 'ignore' });
  } catch (_) {
    /* optional */
  }
}

/**
 * Install a user-level .desktop entry + icons so GNOME/Ubuntu dock can resolve
 * the AppImage/window to pdfedit.png. AppImage mounts are not searched by the
 * icon theme, which is why the dock otherwise shows a generic gear.
 */
function installLinuxDesktopIntegration({ iconPath } = {}) {
  if (process.platform !== 'linux') return false;

  const home = os.homedir();
  const applicationsDir = path.join(home, '.local', 'share', 'applications');
  const iconsRoot = path.join(home, '.local', 'share', 'icons', 'hicolor');
  const desktopPath = path.join(applicationsDir, DESKTOP_FILENAME);
  const execPath = resolveExecPath();
  const appDir = process.env.APPDIR || null;

  let iconCount = 0;
  if (appDir && fs.existsSync(appDir)) {
    iconCount = installIconsFromAppDir(appDir, iconsRoot);
  }
  if (iconCount === 0) {
    iconCount = installFallbackIcon(iconPath, iconsRoot);
  }

  writeDesktopFile(desktopPath, execPath);
  refreshDesktopCaches(applicationsDir, iconsRoot);

  return {
    desktopPath,
    execPath,
    iconCount,
  };
}

module.exports = {
  installLinuxDesktopIntegration,
  APP_ID,
  DESKTOP_FILENAME,
};
