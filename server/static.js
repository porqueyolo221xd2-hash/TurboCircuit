// Servidor HTTP mínimo para servir el cliente compilado en producción.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

export function createStaticHandler({ root = resolve('dist'), enabled = true } = {}) {
  const rootPath = resolve(root);

  return async function serveStatic(req, res) {
    if (!enabled) {
      return sendJson(res, 404, {
        ok: false,
        error: 'static-disabled',
        hint: 'Sirve el cliente con Vite en desarrollo o compila con npm run build.',
      });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end('Method not allowed');
    }

    let urlPath = '/';
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return sendJson(res, 400, { ok: false, error: 'bad-url' });
    }

    const relative = normalize(urlPath).replace(/^([/\\])+/, '');
    let filePath = resolve(join(rootPath, relative));
    if (filePath !== rootPath && !filePath.startsWith(rootPath + sep)) {
      return sendJson(res, 403, { ok: false, error: 'forbidden' });
    }

    try {
      let info = await stat(filePath);
      if (info.isDirectory()) {
        filePath = join(filePath, 'index.html');
        info = await stat(filePath);
      }
      if (!info.isFile()) throw new Error('not a file');
    } catch {
      // SPA: cualquier ruta sin extensión vuelve a index.html.
      if (extname(relative)) return sendJson(res, 404, { ok: false, error: 'not-found' });
      filePath = join(rootPath, 'index.html');
      try {
        await stat(filePath);
      } catch {
        return sendJson(res, 404, {
          ok: false,
          error: 'client-not-built',
          hint: 'Ejecuta npm run build para generar dist/.',
        });
      }
    }

    const extension = extname(filePath).toLowerCase();
    const type = MIME[extension] ?? 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600',
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      return res.end();
    }
    res.writeHead(200, headers);
    const stream = createReadStream(filePath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  };
}
