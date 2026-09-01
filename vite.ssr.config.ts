import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
/**
 * The same `__BUILD_ID__` stamp vite.config.ts carries, duplicated here because
 * it has to be.
 *
 * This config compiles src/entry-server.tsx, whose graph reaches App.tsx ->
 * AppShell.tsx -> ReportBugDialog -> src/lib/build.ts. Without the define
 * below, the identifier survives into the SSR bundle as a bare global and the
 * prerender step throws a ReferenceError — one build step AFTER the config
 * somebody actually edited, which is the confusing way round. Keep the two in
 * sync, or move both to a shared module if a third config ever appears.
 */
const BUILD_ID = (() => {
  const git = (args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8' }).trim();
  try {
    const sha = (process.env.GITHUB_SHA ?? git(['rev-parse', 'HEAD'])).slice(0, 7);
    return git(['status', '--porcelain']) ? `${sha}-dirty` : sha;
  } catch {
    // No git, no repo, no problem — a wrong label beats a failed build.
    return 'dev';
  }
})();

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
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
