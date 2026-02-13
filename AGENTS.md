This file provides guidance to AI coding agents like Claude Code (claude.ai/code), Cursor AI, Codex, Gemini CLI, GitHub Copilot, and other AI coding assistants when working with code in this repository.

## Project snapshot
- Package: `fast-write-atomic`
- Runtime target: Node.js `>=20`
- Module format: CommonJS (`require` / `module.exports`)
- Entry point: `index.js`
- Library contract: callback API `writeAtomic(path, content, cb)` plus Promise helper `writeAtomic.promise(path, content)`.

## Common commands
Run from repository root.

- Install dependencies:
  - `npm install`
- Lint:
  - `npm run lint`
- Full local validation:
  - `npm test`
  - Runs `eslint .` (configured via `eslint.config.js` generated from `neostandard`) then `node --test --test-concurrency=1 test/*.test.js`.
- Coverage:
  - `npm run cov`
  - Runs `node --test --test-concurrency=1 --experimental-test-coverage test/*.test.js`.
- Run one test file:
  - `node --test test/bare.test.js`
  - `node --test test/graceful.test.js`
- Run a single test by name pattern:
  - `node --test --test-name-pattern "retries on EMFILE" test/bare.test.js`
- Benchmark:
  - `node bench.js`

## CI
- GitHub Actions workflow: `.github/workflows/ci.yml`
- CI runs on Node 20, 22, and 24.
- CI executes:
  1. `npm install`
  2. `npm test`
  3. `npm run cov`

## Architecture and behavior
### Atomic write algorithm (`index.js`)
`writeAtomic(path, content, cb)` does:
1. Create a temp file path in the same directory (`.<pid>.<counter>`).
2. Open temp file (`openLoop`) and retry on `EMFILE`.
3. Write all bytes (`writeLoop`) until complete.
4. `fsync` temp file.
5. Close file descriptor.
6. `rename(tmp, path)` to atomically replace destination.
7. On write/fsync/rename errors, unlink temp file and return original error.

### Helper functions
- `cleanup(dest, err, cb)`: unlink temp and forward original error.
- `closeAndCleanup(fd, dest, err, cb)`: close fd, then cleanup.

### Test structure (`test/`)
- `test/suite.js`: shared test suite with all behavior checks.
- `test/bare.test.js`: runs suite against native `fs`.
- `test/graceful.test.js`: applies `graceful-fs.gracefulify(fs)` then runs same suite.
- Tests should run with `--test-concurrency=1` because `gracefulify(fs)` mutates the shared `fs` module.

Behavior guarded by tests includes:
- successful writes,
- parallel writes,
- fsync/rename invocation,
- cleanup on write/fsync/rename failures,
- partial-write retry,
- `EMFILE` open retry,
- high parallel load,
- multibyte unicode input.

## Editing rules for agents
- Keep CommonJS format unless explicitly requested otherwise.
- Keep callback-based public API unless a deliberate breaking change is requested.
- Preserve atomicity invariants (same-directory temp file, `fsync`, `rename`, cleanup on failure).
- If filesystem flow changes, update `test/suite.js` in the same change.