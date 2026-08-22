#!/usr/bin/env node
/**
 * Folds the single-file build into one self-contained HTML page.
 *
 * `vite.config.singlefile.ts` already emits a single JS chunk and a single
 * stylesheet; this inlines both so the result runs from a file:// URL, inside
 * an embedded host page, or from the Android shell's assets folder — anywhere
 * there is no server to fetch siblings from.
 *
 * Usage: node scripts/bundle-single.mjs [outputPath]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(root, 'apps/studio/dist-single/assets');
const output = process.argv[2] ?? path.join(root, 'apps/studio/dist-single/wisp.html');

if (!fs.existsSync(assetsDir)) {
  console.error(
    'No single-file build found. Run:\n  npm run build:single --workspace @wisp/studio',
  );
  process.exit(1);
}

const files = fs.readdirSync(assetsDir);
const jsName = files.find((f) => f.endsWith('.js'));
const cssName = files.find((f) => f.endsWith('.css'));

if (!jsName || !cssName) {
  console.error(`Expected one .js and one .css in ${assetsDir}, found: ${files.join(', ')}`);
  process.exit(1);
}

const js = fs.readFileSync(path.join(assetsDir, jsName), 'utf8');
const css = fs.readFileSync(path.join(assetsDir, cssName), 'utf8');

// A literal </script> or <!-- inside the bundle would end the inline script
// tag early. Both are safe to escape in JS string and regex context.
const safeJs = js.replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--');

const nonAscii = [...js, ...css].filter((c) => c.charCodeAt(0) > 127).length;
if (nonAscii > 0) {
  // The ascii charset setting in vite.config.singlefile.ts exists to prevent
  // exactly this: without a charset declaration the bytes get mis-decoded.
  console.warn(`Warning: ${nonAscii} non-ASCII characters in the bundle.`);
}

const html = `<meta charset="utf-8">
<title>Wisp 3D Sketch</title>

<style>
${css}

/* A host page supplies its own document shell, so the app root is pinned to
   the viewport here rather than relying on the standalone index.html. */
html, body { height: 100%; margin: 0; overflow: hidden; background: #111214; }
#root { height: 100dvh; width: 100%; }
</style>

<div id="root"></div>

<script type="module">
${safeJs}
</script>
`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);

console.log(`${output}  ${(html.length / 1024 / 1024).toFixed(2)} MB`);
