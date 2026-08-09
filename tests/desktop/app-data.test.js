'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveAppDataDir, migrateLegacyLinuxData } = require('../../desktop/app-data');

function testResolveHonorsEnv() {
  const prev = process.env.PDFEDIT_DATA_DIR;
  process.env.PDFEDIT_DATA_DIR = '/tmp/pdfedit-custom-data';
  try {
    const dir = resolveAppDataDir({ getPath: () => '/unused' });
    assert.strictEqual(dir, path.resolve('/tmp/pdfedit-custom-data'));
  } finally {
    if (prev === undefined) delete process.env.PDFEDIT_DATA_DIR;
    else process.env.PDFEDIT_DATA_DIR = prev;
  }
}

function testMigrateLinuxDrafts() {
  if (process.platform !== 'linux') {
    console.log('skip migrate test (not linux)');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfedit-migrate-'));
  const oldDir = path.join(root, 'config-PDFEdit');
  const newDir = path.join(root, 'share-pdfedit');
  fs.mkdirSync(path.join(oldDir, 'unsaved'), { recursive: true });
  fs.mkdirSync(path.join(newDir, 'unsaved'), { recursive: true }); // empty pre-existing
  fs.writeFileSync(path.join(oldDir, 'unsaved', 'draft.pdf'), 'draft');
  fs.writeFileSync(path.join(oldDir, 'ai_settings.json'), '{"ok":true}');

  const migrated = migrateLegacyLinuxData(newDir, oldDir);
  assert.strictEqual(migrated, true);
  assert.ok(fs.existsSync(path.join(newDir, 'unsaved', 'draft.pdf')));
  assert.ok(fs.existsSync(path.join(newDir, 'ai_settings.json')));
  assert.ok(!fs.existsSync(path.join(oldDir, 'unsaved')));
  assert.ok(!fs.existsSync(path.join(oldDir, 'ai_settings.json')));

  fs.rmSync(root, { recursive: true, force: true });
}

testResolveHonorsEnv();
testMigrateLinuxDrafts();
console.log('app-data tests passed');
