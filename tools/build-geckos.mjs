// node tools/build-geckos.mjs — build the ONE vendored browser bundle of the geckos.io client
// (vendor/geckos.client.js, ESM, minified) from server/node_modules (cd server && npm install first).
// The static game stays dependency-free: src/net.js imports this file lazily, and falls back to a
// plain WebSocket when it's missing or WebRTC can't connect. Re-run only when bumping @geckos.io/client.
import { build } from '../server/node_modules/esbuild/lib/main.js';
import { readFileSync, statSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(root + 'server/node_modules/@geckos.io/client/package.json', 'utf8'));
await build({
  stdin: { contents: "export { default } from '@geckos.io/client';", resolveDir: root + 'server', loader: 'js' },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2020', minify: true, legalComments: 'inline',
  outfile: root + 'vendor/geckos.client.js',
  banner: { js: `/* @geckos.io/client ${pkg.version} (BSD-3-Clause, https://github.com/geckosio/geckos.io) — bundled by tools/build-geckos.mjs */` },
});
console.log('vendor/geckos.client.js', statSync(root + 'vendor/geckos.client.js').size, 'bytes, @geckos.io/client', pkg.version);
