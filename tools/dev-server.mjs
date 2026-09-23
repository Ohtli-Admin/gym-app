// Zero-dependency static file server for local manual testing.
//
// Why this exists instead of a package like `serve`/`http-server`: this
// repo has no package.json/npm dependency at all today, and the Today
// experience (GA-005) needs its .mjs files served with a correct
// JavaScript MIME type for the browser's native ES module loader to
// accept them — many simple static servers (including opening index.html
// directly via file://, and some minimal servers) either refuse module
// imports over file:// entirely or serve .mjs with the wrong
// Content-Type, which makes the browser reject the import with a strict
// MIME-type error. This script is ~60 lines of Node built-ins
// (node:http/fs/path/url) — no install step, no new dependency — and
// gets the .mjs MIME type right.
//
// Usage:
//   node tools/dev-server.mjs [port]
// Then open http://localhost:<port>/ (default port 5173).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const PORT = Number(process.argv[2]) || 5173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

async function resolveFile(urlPath) {
  const safePath = normalize(join(ROOT, decodeURIComponent(urlPath))).replace(/^(\.\.[/\\])+/, '');
  if (!safePath.startsWith(ROOT)) {
    return null; // path traversal guard
  }
  const candidate = urlPath.endsWith('/') ? join(safePath, 'index.html') : safePath;
  try {
    const info = await stat(candidate);
    return info.isDirectory() ? join(candidate, 'index.html') : candidate;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  const filePath = await resolveFile(urlPath);
  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  try {
    const contentType = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Server error: ${error.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`GymApp dev server running at http://localhost:${PORT}/`);
  console.log('Serving from:', ROOT);
});
