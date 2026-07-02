import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    // Declarations are generated separately (`pnpm build:types`, via dts-bundle-generator) —
    // tsup's own bundled dts generator (rollup-plugin-dts) can't parse discord.js v13's
    // typings at all (crashes on its Mixin-based `extends SomeFn(Base)` class declarations),
    // so it can't produce the AnyClient/AnyMessage/AnyInteraction v13 | v14 union in types.ts.
    dts: false,
    clean: true,
    treeshake: true,
    target: 'es2022',
    platform: 'node',
    // peer dependencies — never bundle the Discord library
    external: ['discord.js', 'discord.js-selfbot-v13', 'discord.js-selfbot-youtsuho-v13'],
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    clean: false, // don't race the index build's clean
    treeshake: true,
    target: 'es2022',
    platform: 'node',
    banner: { js: '#!/usr/bin/env node' },
  },
])
