'use strict'

const writeAtomic = require('..')
const proxyquire = require('proxyquire')
const { test, tearDown } = require('tap')
const {
  readFile,
  unlink,
  unlinkSync,
  open,
  write,
  close,
  fsync,
  rename
} = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')

const files = []

tearDown(() => {
  for (let dest of files) {
    try {
      unlinkSync(dest)
    } catch (_) {
    }
  }
})

let nextId = 0

function getDest (name) {
  if (!name) {
    name = 'hello' + nextId++
  }
  const dest = join(tmpdir(), name)
  files.push(dest)
  return dest
}

test('write a file', (t) => {
  t.plan(3)

  const dest = getDest()
  const content = Buffer.allocUnsafe(4096) // 4 KB

  writeAtomic(dest, content, (err) => {
    t.error(err)
    readFile(dest, (err, data) => {
      t.error(err)
      t.equal(Buffer.compare(data, content), 0)
    })
  })
})

test('parallel writes', (t) => {
  t.plan(4)

  const dest = getDest()
  const content1 = Buffer.allocUnsafe(4096).fill('AB') // 4 KB
  const content2 = Buffer.allocUnsafe(4096).fill('CD') // 4 KB

  let countdown = 2

  writeAtomic(dest, content1, (err) => {
    t.error(err)
    done()
  })

  writeAtomic(dest, content2, (err) => {
    t.error(err)
    done()
  })

  function done () {
    if (--countdown !== 0) {
      return
    }

    readFile(dest, (err, data) => {
      t.error(err)
      // we expect either content1 or content2 to be there
      t.equal(Buffer.compare(data, content2) === 0 || Buffer.compare(data, content1) === 0, true)
    })
  }
})

test('calls fsync', (t) => {
  t.plan(5)

  const writeAtomic = proxyquire('..', {
    fs: {
      open,
      write,
      close,
      fsync (fd, cb) {
        t.pass('fsync called')
        return fsync(fd, cb)
      },
      rename (source, dest, cb) {
        t.pass('rename called')
        return rename(source, dest, cb)
      }
    }
  })

  const dest = getDest()
  const content = Buffer.allocUnsafe(4096) // 4 KB

  writeAtomic(dest, content, (err) => {
    t.error(err)
    readFile(dest, (err, data) => {
      t.error(err)
      t.equal(Buffer.compare(data, content), 0)
    })
  })
})

test('unlinks if it errors during rename', (t) => {
  t.plan(4)

  let _source
  const writeAtomic = proxyquire('..', {
    fs: {
      open,
      write,
      close,
      unlink (file, cb) {
        t.equal(file, _source)
        return unlink(file, cb)
      },
      rename (source, dest, cb) {
        _source = source
        process.nextTick(cb, new Error('kaboom'))
      }
    }
  })

  const dest = getDest()
  const content = Buffer.allocUnsafe(4096) // 4 KB

  writeAtomic(dest, content, (err) => {
    t.equal(err.message, 'kaboom')
    readFile(dest, (err) => {
      t.equal(err.code, 'ENOENT')
    })
    readFile(_source, (err) => {
      t.equal(err.code, 'ENOENT')
    })
  })
})

test('write 2000 files in parallel', (t) => {
  const MAX = 2000
  t.plan(MAX)

  for (var i = 0; i < MAX; i++) {
    const dest = getDest()
    const content = Buffer.allocUnsafe(4096) // 4 KB

    writeAtomic(dest, content, (err) => {
      t.error(err)
    })
  }
})
