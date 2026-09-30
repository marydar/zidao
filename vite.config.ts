/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The >500kB chunks are on-demand *data* assets (full HSK word index, the
  // offline HSK-1 stroke bundle), not application code — they load lazily.
  build: {
    chunkSizeWarningLimit: 1700,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
