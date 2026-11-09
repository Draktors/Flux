import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Tests never read the personal ~/.flux/config.json
    env: { FLUX_CONFIG: fileURLToPath(new URL('./test/fixtures/config.json', import.meta.url)) },
  },
})
