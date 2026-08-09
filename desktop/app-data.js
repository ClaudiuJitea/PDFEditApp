'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Directory for PDF working copies, drafts, and AI settings.
 * Kept separate from Electron's Chromium profile (userData) on Linux.
 */
function resolveAppDataDir(app) {
  if (process.env.PDFEDIT_DATA_DIR) {
    return path.resolve(process.env.PDFEDIT_DATA_DIR);
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || app.getPath('appData');
    return path.join(base, 'PDFEdit');
  }
  if (process.platform === 'darwin') {
    return path.join(app.getPath('home'), 'Library', 'Application Support', 'PDFEdit');
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(xdg, 'pdfedit');
}

function _copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      _copyDirRecursive(from, to);
    } else if (entry.isFile()) {
      if (!fs.existsSync(to)) {
        fs.copyFileSync(from, to);
      }
    }
  }
}

function _isEmptyDir(dir) {
  try {
    return fs.readdirSync(dir).length === 0;
  } catch {
    return false;
  }
}

/**
 * Move session drafts out of the Electron profile dir (~/.config/PDFEdit)
 * into the XDG data dir (~/.local/share/pdfedit) when upgrading.
 */
function migrateLegacyLinuxData(appDataDir, electronUserDataDir) {
  if (process.platform !== 'linux') return false;
  if (!electronUserDataDir || appDataDir === electronUserDataDir) return false;
  if (!fs.existsSync(electronUserDataDir)) return false;

  fs.mkdirSync(appDataDir, { recursive: true });

  let migrated = false;
  for (const name of ['unsaved', 'saved', 'ai_settings.json']) {
    const from = path.join(electronUserDataDir, name);
    const to = path.join(appDataDir, name);
    if (!fs.existsSync(from)) continue;
    try {
      const stat = fs.statSync(from);
      if (stat.isDirectory()) {
        if (!fs.existsSync(to) || _isEmptyDir(to)) {
          if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
          fs.renameSync(from, to);
        } else {
          _copyDirRecursive(from, to);
          fs.rmSync(from, { recursive: true, force: true });
        }
        migrated = true;
      } else if (!fs.existsSync(to)) {
        fs.renameSync(from, to);
        migrated = true;
      }
    } catch (err) {
      console.error(`Failed to migrate ${name}:`, err);
    }
  }
  return migrated;
}

module.exports = {
  resolveAppDataDir,
  migrateLegacyLinuxData,
};
