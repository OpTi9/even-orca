import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const fromHere = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url))

export default defineConfig({
  root: fromHere('.'),
  // Why: shared sources sit under the desktop tsconfig, which extends a package this install lacks.
  tsconfig: fromHere('./tsconfig.json'),
  resolve: {
    // Why: mobile/src/transport is reused as-is; its Expo and bare imports must land on this
    // package's copies, not on mobile/node_modules (which may not be installed).
    alias: [
      { find: /^expo-crypto$/, replacement: fromHere('./src/platform/expo-crypto-web-shim.ts') },
      { find: /^tweetnacl$/, replacement: fromHere('./node_modules/tweetnacl') },
      { find: /^zod$/, replacement: fromHere('./node_modules/zod') }
    ]
  },
  server: {
    fs: { allow: [fromHere('..')] }
  },
  build: {
    target: 'es2022'
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
