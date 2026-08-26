import { build } from 'esbuild';
import { cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Builds the desktop app.
 *
 * The main process is bundled rather than merely compiled, for two reasons.
 * The workspace packages resolve to TypeScript source — right for Vite, and
 * unloadable by Node — and a packaged app should not have to carry
 * `node_modules` around to find them. Bundling settles both.
 *
 * `electron` itself stays external: it is provided by the runtime, not
 * installed as a library.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  // `electron` is provided by the runtime. `electron-updater` is left alone
  // too: it reads `app-update.yml` out of the installed app's resources and
  // expects to find itself in node_modules, which bundling would take away.
  external: ['electron', 'electron-updater'],
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: [join(root, 'src/main.ts')],
  outfile: join(root, 'dist/main.js'),
  format: 'esm',
  // Electron's ESM loader needs the extension present on relative imports,
  // and bundling removes them anyway.
  banner: {
    js: "import { createRequire as __cr } from 'node:module';const require = __cr(import.meta.url);",
  },
});

await build({
  ...common,
  entryPoints: [join(root, 'src/computeWorker.ts')],
  // .cjs, not .js: the package is ESM, so a CommonJS bundle written as .js is
  // parsed as a module and dies on its first `require` — which the pool then
  // reports as a crashed worker, several layers away from the cause.
  outfile: join(root, 'dist/computeWorker.cjs'),
  format: 'cjs',
});

await build({
  ...common,
  entryPoints: [join(root, 'src/preload.cts')],
  outfile: join(root, 'dist/preload.cjs'),
  format: 'cjs',
});

// The studio build is served, not bundled — the desktop window and a
// connected tablet load exactly the same files.
const studio = join(root, '..', 'studio', 'dist');
const target = join(root, 'studio');

if (!existsSync(studio)) {
  console.error('Build the studio first: npm run build --workspace @wisp/studio');
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await cp(studio, target, { recursive: true });
console.log(`Staged the studio build into ${target}`);
