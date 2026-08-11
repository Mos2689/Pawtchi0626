/**
 * Static server for eyeballing rendered email HTML in a real browser.
 *
 * Development only, never deployed. It exists because a widget mockup of an
 * email is two abstractions away from the thing itself — the only preview worth
 * trusting is the actual output string in an actual rendering engine.
 *
 *   node scripts/email-preview-server.js        # serves my-app/ on :4321
 *
 * Deliberately dependency-free: `npx serve` needs a network fetch on first run,
 * which fails behind a proxy and leaves the preview tab pointing at nothing.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 4321);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/**
 * Where POST /save is allowed to write. The browser is being used as an image
 * pipeline — there is no sharp, ImageMagick or node-canvas on this machine, and
 * a headless Chrome canvas resizes and re-encodes perfectly well — so the page
 * has to hand finished bytes back to disk somehow.
 *
 * Confined to the website's email asset folder and nowhere else. This binds a
 * port, and "dev-only" is not a security control.
 */
const SAVE_ROOT = path.resolve(ROOT, '..', 'pawtchi-website', 'public', 'email');

function handleSave(req, res) {
  let body = '';
  req.on('data', (c) => {
    body += c;
    // A 4K hero JPEG base64s to a few hundred KB; 12 MB is a generous ceiling
    // that still stops an unbounded write.
    if (body.length > 12_000_000) {
      res.writeHead(413).end('too large');
      req.destroy();
    }
  });
  req.on('end', () => {
    try {
      const { name, dataUrl } = JSON.parse(body);
      if (typeof name !== 'string' || !/^[a-z0-9/-]+\.(png|jpg)$/i.test(name)) {
        res.writeHead(400).end('bad name');
        return;
      }
      const target = path.resolve(SAVE_ROOT, name);
      if (!target.startsWith(SAVE_ROOT)) {
        res.writeHead(403).end('outside save root');
        return;
      }
      const b64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, '');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(b64, 'base64'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, bytes: fs.statSync(target).size }));
    } catch (e) {
      res.writeHead(500).end(String(e && e.message));
    }
  });
}

http
  .createServer((req, res) => {
    if (req.method === 'POST' && (req.url || '').startsWith('/save')) {
      handleSave(req, res);
      return;
    }

    const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');

    // `/assets/*` maps to the website's email folder, so a preview can load the
    // real hosted assets at the paths they will actually be served from rather
    // than a copy that can drift.
    if (rel.startsWith('assets/')) {
      const asset = path.resolve(SAVE_ROOT, rel.slice('assets/'.length));
      if (!asset.startsWith(SAVE_ROOT)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      fs.readFile(asset, (err, buf) => {
        if (err) {
          res.writeHead(404).end('not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(asset).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(buf);
      });
      return;
    }

    const target = path.join(ROOT, rel || 'email-preview.html');

    // Path traversal guard. Trivial to get wrong, and this binds a port.
    if (!target.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    fs.readFile(target, (err, buf) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(buf);
    });
  })
  .listen(PORT, () => {
    process.stdout.write(`email preview on http://localhost:${PORT}\n`);
  });
