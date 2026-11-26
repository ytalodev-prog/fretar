'use strict';
const config = require('../server/config');

let handler;
if (process.env.VERCEL === '1' && !config.DATABASE_URL) {
  handler = (_req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ erro: 'Configure DATABASE_URL com a conexão do Neon.' }));
  };
} else {
  const server = require('../server/index');
  handler = (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const apiPath = url.searchParams.get('path');
    if (apiPath !== null) {
      const segments = apiPath.split('/');
      if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ erro: 'Rota da API inválida.' }));
        return;
      }
      url.searchParams.delete('path');
      url.pathname = `/api/${segments.join('/')}`;
      req.url = `${url.pathname}${url.search}`;
    }
    server.emit('request', req, res);
  };
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
