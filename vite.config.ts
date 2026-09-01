import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

/**
 * Which build this is, stamped into the bundle so a bug report can name it.
 *
 * Short commit sha, plus `-dirty` when the tree has uncommitted changes —
 * because during the alpha half the builds that reach staging are not a clean
 * commit, and a report labelled with a sha whose source does not match is worse
 * than one labelled `dev`. No timestamp: a value that changes on every build
 * churns the entry chunk hash for no information gain.
 *
 * MUST BE DEFINED IN BOTH VITE CONFIGS. The prerender step compiles
 * src/entry-server.tsx, whose graph reaches App.tsx -> AppShell.tsx ->
 * ReportBugDialog -> src/lib/build.ts. Defining it here only would leave a bare
 * identifier in the SSR bundle and fail `npm run build` one step later.
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
  // Pinned off Vite's default 5173, which the Inkubus dev server already uses
  // on this machine. strictPort so a clash fails loudly instead of drifting.
  server: { port: 5174, strictPort: true },
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: {
    // import.meta.dirname, not __dirname — this config is ESM. shadcn's docs
    // show the CommonJS form, which throws here.
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
});
