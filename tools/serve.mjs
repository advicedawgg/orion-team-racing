// node tools/serve.mjs [port]  — static dev server, no caching (stale JS cost SO1/SO2 whole rounds).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.argv[2] || process.env.PORT || 8960);
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json',
  '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml',
  '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.wav':'audio/wav', '.glb':'model/gltf-binary', '.gltf':'model/gltf+json', '.ico':'image/x-icon', '.woff2':'font/woff2' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, path.normalize(p));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.stat(f, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store', 'content-length': st.size, 'access-control-allow-origin': '*' });
    fs.createReadStream(f).pipe(res);
  });
}).listen(PORT, '0.0.0.0', () => console.log(`OTR dev server http://0.0.0.0:${PORT}`));
