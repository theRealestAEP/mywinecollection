import { defineConfig } from 'vite';

// The display app lives in apps/display. It reads VITE_CONVEX_URL from the
// .env.local file that `npx convex dev` writes at the repo root.
export default defineConfig({
  root: 'apps/display',
  envDir: '../..',
  server: { port: 5180, strictPort: true },
  build: {
    outDir: '../../dist/display',
    emptyOutDir: true,
  },
});
