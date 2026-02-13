'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const writeAtomic = require('..')

let nextId = 0

function getDest () {
  return join(tmpdir(), 'promise-' + process.pid + '-' + nextId++)
}

test('exposes promise API', () => {
  assert.equal(typeof writeAtomic.promise, 'function')
})

test('promise API writes a file', async () => {
  const dest = getDest()
  const content = Buffer.from('hello promise')

  await writeAtomic.promise(dest, content)

  const data = await fs.promises.readFile(dest)
  assert.equal(Buffer.compare(data, content), 0)

  await fs.promises.unlink(dest)
})

test('promise API rejects on fs errors', async (t) => {
  t.mock.method(fs, 'rename', function (_source, _dest, cb) {
    process.nextTick(cb, new Error('kaboom'))
  })

  const dest = getDest()
  const content = Buffer.from('hello failure')

  await assert.rejects(writeAtomic.promise(dest, content), {
    message: 'kaboom'
  })
})
