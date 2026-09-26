import { fileURLToPath } from 'node:url';
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
    // Two pages: the book, and the Sommelier, where the owner talks to the
    // agent that keeps the book.
    rollupOptions: {
      input: {
        book: fileURLToPath(new URL('./apps/display/index.html', import.meta.url)),
        sommelier: fileURLToPath(new URL('./apps/display/sommelier.html', import.meta.url)),
      },
    },
  },
});
