'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const tracked = []
let tracking = false

function track () {
  tracking = true
  return module.exports
}

function normalizeAffix (affixes) {
  if (affixes == null) return 'tmp-'
  if (typeof affixes === 'string') return affixes
  if (typeof affixes === 'object' && affixes.prefix) return String(affixes.prefix)
  return 'tmp-'
}

function mkdir (affixes, callback) {
  if (typeof affixes === 'function') {
    callback = affixes
    affixes = undefined
  }
  const prefix = path.join(os.tmpdir(), normalizeAffix(affixes))
  fs.mkdtemp(prefix, (err, dir) => {
    if (!err && tracking) tracked.push(dir)
    callback(err, dir)
  })
}

function mkdirSync (affixes) {
  const prefix = path.join(os.tmpdir(), normalizeAffix(affixes))
  const dir = fs.mkdtempSync(prefix)
  if (tracking) tracked.push(dir)
  return dir
}

function cleanupSync () {
  while (tracked.length) {
    const dir = tracked.pop()
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup failures
    }
  }
}

function cleanup (callback) {
  try {
    cleanupSync()
    if (callback) callback(null, 0)
  } catch (err) {
    if (callback) callback(err, 0)
    else throw err
  }
}

process.on('exit', cleanupSync)

module.exports = {
  track,
  mkdir,
  mkdirSync,
  cleanup,
  cleanupSync,
  path: mkdirSync,
  dir: mkdir,
  open () {
    throw new Error('temp.open is not implemented by temp-shim')
  },
  openSync () {
    throw new Error('temp.openSync is not implemented by temp-shim')
  },
  createWriteStream () {
    throw new Error('temp.createWriteStream is not implemented by temp-shim')
  }
}
