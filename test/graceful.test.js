'use strict'

const fs = require('node:fs')
const gracefulFs = require('graceful-fs')
const runSuite = require('./suite')

gracefulFs.gracefulify(fs)

runSuite()
