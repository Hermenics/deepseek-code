import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    hookTimeout: 15000,
    testTimeout: 15000,
  },
})
