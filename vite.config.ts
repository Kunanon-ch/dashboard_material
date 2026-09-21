import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // The parser is loaded by a worker; prebundle it before the first upload so
  // dependency discovery does not reload the page and discard the local preview.
  optimizeDeps: { include: ['xlsx'] },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  build: { chunkSizeWarningLimit: 800 },
})
