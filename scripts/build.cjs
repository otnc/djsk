// Copies the CJS-generated .d.ts (dts-bundle-generator only emits one file) to `.d.cts`, so
// both the ESM and CJS entry points have a matching declaration file. Run after `build:types`.
const { copyFileSync } = require('node:fs')

copyFileSync('dist/index.d.ts', 'dist/index.d.cts')
