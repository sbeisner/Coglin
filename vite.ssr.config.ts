import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build config for the prerender step only (COG-050).
 *
 * Separate from vite.config.ts because the Cloudflare plugin owns the output
 * layout there: it emits dist/client and dist/coglin_app_dev and builds the
 * Worker, so `vite build --ssr` against it produced
 * dist/ssr/client/assets/entry-server-<hash>.js instead of a module this script
 * could import. It also has no business running for a build whose only output
 * is thrown away seconds later.
 *
 * Tailwind is absent for the same reason: the SSR bundle renders markup, and
 * the stylesheet comes from the client build. CSS imports are stubbed below.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // src/main.tsx is not in this graph, but App.tsx's children may reach for
      // CSS; Rollup cannot parse it and does not need to.
      './index.css': path.resolve(import.meta.dirname, './scripts/empty.css'),
    },
  },
  build: {
    ssr: true,
    outDir: 'dist/ssr',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, './src/entry-server.tsx'),
      output: { entryFileNames: 'entry-server.js', format: 'esm' },
    },
  },
});
