// Tiny static file server for local preview: `npm run serve` then open http://localhost:8099/demo.html
import http from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';

const root = process.cwd();
const PORT = process.env.PORT || 8099;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/demo.html';
  try {
    const data = await readFile(join(root, p));
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'text/plain' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(PORT, () => console.log(`Serving ${root} at http://localhost:${PORT}/demo.html`));
