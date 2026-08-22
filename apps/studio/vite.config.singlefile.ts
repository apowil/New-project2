import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

/**
 * Builds the whole studio into one HTML file with the JS and CSS inlined.
 *
 * Used for sharing a build that has to run from a single file with no server
 * and no sibling assets — handing someone a link to try, or dropping the app
 * into the Android shell's assets folder later. The normal `vite.config.ts`
 * build is the one to ship: it code-splits and registers the service worker,
 * neither of which a single file can do.
 */
export default defineConfig({
  plugins: [react(), tailwind()],
  esbuild: {
    // Escape non-ASCII to \uXXXX. A single file gets opened straight from
    // disk or embedded in a host page, where there may be no charset
    // declaration to tell the browser the bytes are UTF-8 — an ASCII-only
    // bundle cannot be mis-decoded in the first place.
    charset: 'ascii',
  },
  build: {
    target: 'es2022',
    outDir: 'dist-single',
    sourcemap: false,
    cssCodeSplit: false,
    // Fold every asset into the bundle rather than emitting sibling files.
    assetsInlineLimit: 100 * 1024 * 1024,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
  },
});
