'use strict'

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const writeAtomic = require('..')

let nextId = 0
const files = []

after(() => {
  for (const dest of files) {
    try {
      fs.unlinkSync(dest)
    } catch (_) {
    }
  }
})

function getDest (name) {
  const fileName = name || ('hello' + nextId++)
  const dest = join(tmpdir(), fileName)
  files.push(dest)
  return dest
}

function writeAtomicCb (fn, dest, content) {
  return new Promise((resolve, reject) => {
    fn(dest, content, (err) => {
      if (err) {
        reject(err)
        return
      }

      resolve()
    })
  })
}

function writeAtomicCbResult (fn, dest, content) {
  return new Promise((resolve) => {
    fn(dest, content, (err) => {
      resolve(err || null)
    })
  })
}

async function readFileBuffer (dest) {
  return fs.promises.readFile(dest)
}

function runSuite () {
  test('write a file', async () => {
    const dest = getDest()
    const content = Buffer.allocUnsafe(4096)

    await writeAtomicCb(writeAtomic, dest, content)
    const data = await readFileBuffer(dest)
    assert.equal(Buffer.compare(data, content), 0)
  })

  test('parallel writes', async () => {
    const dest = getDest()
    const content1 = Buffer.allocUnsafe(4096).fill('AB')
    const content2 = Buffer.allocUnsafe(4096).fill('CD')

    await Promise.all([
      writeAtomicCb(writeAtomic, dest, content1),
      writeAtomicCb(writeAtomic, dest, content2)
    ])

    const data = await readFileBuffer(dest)
    const isContent1 = Buffer.compare(data, content1) === 0
    const isContent2 = Buffer.compare(data, content2) === 0
    assert.equal(isContent1 || isContent2, true)
  })

  test('calls fsync and rename', async (t) => {
    const realFsync = fs.fsync
    const realRename = fs.rename

    let fsyncCalled = false
    let renameCalled = false

    t.mock.method(fs, 'fsync', function (fd, cb) {
      fsyncCalled = true
      return realFsync(fd, cb)
    })

    t.mock.method(fs, 'rename', function (source, dest, cb) {
      renameCalled = true
      return realRename(source, dest, cb)
    })

    const dest = getDest()
    const content = Buffer.allocUnsafe(4096)

    await writeAtomicCb(writeAtomic, dest, content)
    const data = await readFileBuffer(dest)

    assert.equal(Buffer.compare(data, content), 0)
    assert.equal(fsyncCalled, true)
    assert.equal(renameCalled, true)
  })

  test('unlinks if it errors during rename', async (t) => {
    let source

    t.mock.method(fs, 'rename', function (_source, _dest, cb) {
      source = _source
      process.nextTick(cb, new Error('kaboom'))
    })

    const dest = getDest()
    const content = Buffer.allocUnsafe(4096)

    const err = await writeAtomicCbResult(writeAtomic, dest, content)
    assert.equal(err.message, 'kaboom')

    await assert.rejects(readFileBuffer(dest), { code: 'ENOENT' })
    await assert.rejects(readFileBuffer(source), { code: 'ENOENT' })
  })

  test('unlinks if it errors during write', async (t) => {
    const realOpen = fs.open
    let source

    t.mock.method(fs, 'open', function (dest, flags, cb) {
      source = dest
      return realOpen(dest, flags, cb)
    })

    t.mock.method(fs, 'write', function (_fd, _content, _offset, cb) {
      process.nextTick(cb, new Error('kaboom'))
    })

    const dest = getDest()
    const content = Buffer.allocUnsafe(4096)

    const err = await writeAtomicCbResult(writeAtomic, dest, content)
    assert.equal(err.message, 'kaboom')

    await assert.rejects(readFileBuffer(dest), { code: 'ENOENT' })
    await assert.rejects(readFileBuffer(source), { code: 'ENOENT' })
  })

  test('unlinks if it errors during fsync', async (t) => {
    const realOpen = fs.open
    let source

    t.mock.method(fs, 'open', function (dest, flags, cb) {
      source = dest
      return realOpen(dest, flags, cb)
    })

    t.mock.method(fs, 'fsync', function (_fd, cb) {
      process.nextTick(cb, new Error('kaboom'))
    })

    const dest = getDest()
    const content = Buffer.allocUnsafe(4096)

    const err = await writeAtomicCbResult(writeAtomic, dest, content)
    assert.equal(err.message, 'kaboom')

    await assert.rejects(readFileBuffer(dest), { code: 'ENOENT' })
    await assert.rejects(readFileBuffer(source), { code: 'ENOENT' })
  })

  test('retries if the write was not completed', async (t) => {
    const realWrite = fs.write
    let first = true
    let writeCalls = 0

    t.mock.method(fs, 'write', function (fd, content, offset, cb) {
      writeCalls++
      if (first) {
        first = false
        return realWrite(fd, content, 0, 16, cb)
      }

      return realWrite(fd, content, offset, cb)
    })

    const dest = getDest()
    const content = Buffer.allocUnsafe(4096)

    await writeAtomicCb(writeAtomic, dest, content)
    const data = await readFileBuffer(dest)

    assert.equal(writeCalls >= 2, true)
    assert.equal(Buffer.compare(data, content), 0)
  })

  test('errors if open errors', async (t) => {
    let source

    t.mock.method(fs, 'open', function (dest, _flags, cb) {
      source = dest
      process.nextTick(cb, new Error('kaboom'))
    })

    const dest = getDest()
    const content = Buffer.allocUnsafe(4096)

    const err = await writeAtomicCbResult(writeAtomic, dest, content)
    assert.equal(err.message, 'kaboom')

    await assert.rejects(readFileBuffer(dest), { code: 'ENOENT' })
    await assert.rejects(readFileBuffer(source), { code: 'ENOENT' })
  })

  test('retries on EMFILE', async (t) => {
    const realOpen = fs.open
    let first = true

    t.mock.method(fs, 'open', function (dest, flags, cb) {
      if (first) {
        first = false
        const err = new Error('kaboom')
        err.code = 'EMFILE'
        process.nextTick(cb, err)
        return
      }

      return realOpen(dest, flags, cb)
    })

    const dest = getDest()
    const content = Buffer.allocUnsafe(4096)

    await writeAtomicCb(writeAtomic, dest, content)
    const data = await readFileBuffer(dest)
    assert.equal(Buffer.compare(data, content), 0)
  })

  test('write 2000 files in parallel', async () => {
    const max = 2000
    const writes = []

    for (let i = 0; i < max; i++) {
      const dest = getDest()
      const content = Buffer.allocUnsafe(4096)
      writes.push(writeAtomicCb(writeAtomic, dest, content))
    }

    await Promise.all(writes)
    assert.ok(true)
  })

  test('multibyte unicode symbols', async () => {
    const dest = getDest()
    const content = '{"name":"tajné jménoed25519","id":"QmSvTNE2Eo7SxRXjmEaZnE91cNpduKjYFBtd2LYC4Rsoeq"}'

    await writeAtomicCb(writeAtomic, dest, content)
    const data = await fs.promises.readFile(dest, 'utf8')
    assert.equal(data, content)
  })
}

module.exports = runSuite
