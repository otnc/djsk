import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
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
