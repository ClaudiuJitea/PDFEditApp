const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { SidecarManager } = require('../../desktop/sidecar');

test('SidecarManager resolves dev command', () => {
  const manager = new SidecarManager({
    isDev: true,
    userDataDir: '/tmp/pdfedit-test',
    resourcesPath: '/tmp/resources',
    appPath: path.join(__dirname, '..', '..'),
  });

  const command = manager._resolveSidecarCommand({});
  assert.equal(command.args[0], 'server_entry.py');
  assert.match(command.cwd, /backend$/);
});
