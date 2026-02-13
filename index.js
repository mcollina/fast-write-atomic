'use strict'

const fs = require('node:fs')
const { join, dirname } = require('node:path')

let counter = 0

function cleanup (dest, err, cb) {
  fs.unlink(dest, function () {
    cb(err)
  })
}

function closeAndCleanup (fd, dest, err, cb) {
  fs.close(fd, cleanup.bind(null, dest, err, cb))
}

function writeLoop (fd, content, contentLength, offset, cb) {
  fs.write(fd, content, offset, function (err, bytesWritten) {
    if (err) {
      cb(err)
      return
    }

    return (bytesWritten < contentLength - offset)
      ? writeLoop(fd, content, contentLength, offset + bytesWritten, cb)
      : cb(null)
  })
}

function openLoop (dest, cb) {
  fs.open(dest, 'w', function (err, fd) {
    if (err) {
      return (err.code === 'EMFILE')
        ? openLoop(dest, cb)
        : cb(err)
    }

    cb(null, fd)
  })
}

function writeAtomic (path, content, cb) {
  const tmp = join(dirname(path), '.' + process.pid + '.' + counter++)
  openLoop(tmp, function (err, fd) {
    if (err) {
      cb(err)
      return
    }

    const contentLength = Buffer.byteLength(content)
    writeLoop(fd, content, contentLength, 0, function (err) {
      if (err) {
        closeAndCleanup(fd, tmp, err, cb)
        return
      }

      fs.fsync(fd, function (err) {
        if (err) {
          closeAndCleanup(fd, tmp, err, cb)
          return
        }

        fs.close(fd, function (err) {
          if (err) {
            // TODO could we possibly be leaking a file descriptor here?
            cleanup(tmp, err, cb)
            return
          }

          fs.rename(tmp, path, function (err) {
            if (err) {
              cleanup(tmp, err, cb)
              return
            }

            cb(null)
          })
        })
      })
    })

    // clean up after ourselves, this is not needed
    // anymore
    content = null
  })
}

writeAtomic.promise = function writeAtomicPromise (path, content) {
  return new Promise(function (resolve, reject) {
    writeAtomic(path, content, function (err) {
      if (err) {
        reject(err)
        return
      }

      resolve()
    })
  })
}

module.exports = writeAtomic
