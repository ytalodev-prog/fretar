'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const store = require('./store');
const auth = require('./auth');

config.validateProductionConfig();
store.load();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; frame-ancestors 'none'",
};

// ---------- Utilitarios ----------
function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extraHeaders });
  res.end(JSON.stringify(data));
}
const fail = (res, status, message) => sendJson(res, status, { erro: message });

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) return reject({ status: 415, message: 'Envie os dados em JSON.' });
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 20 * 1024) { reject({ status: 413, message: 'Conteúdo grande demais.' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject({ status: 400, message: 'JSON inválido.' }); }
    });
    req.on('error', () => reject({ status: 400, message: 'Falha ao ler a requisição.' }));
  });
}

// Limite de tentativas por IP em login/cadastro
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) { attempts.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 }); return false; }
  entry.count += 1;
  return entry.count > 15;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k); }, 60 * 1000).unref();

// ---------- Validacao ----------
const LOGIN_RE = /^[\p{L}\p{N} _.\-]+$/u;
function cleanLogin(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }

function validateCredentials(body) {
  const login = cleanLogin(body.login);
  const password = String(body.password ?? '');
  if (login.length < 3 || login.length > 40 || !LOGIN_RE.test(login)) {
    return { error: 'O nome de login deve ter de 3 a 40 caracteres, só com letras, números, espaço, ponto, hífen ou sublinhado.' };
  }
  if (password.length < 6 || password.length > 72) return { error: 'A senha deve ter de 6 a 72 caracteres.' };
  return { login, password };
}

const PRIORIDADES = ['informativo', 'normal', 'urgente'];
const STATUS = ['novo', 'visto', 'concluido'];

function objectBody(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// ---------- Rotas da API ----------
async function handleApi(req, res, url) {
  const method = req.method;
  const route = url.pathname;
  const ip = req.socket.remoteAddress || 'ip';
  const session = auth.sessionFromRequest(req);

  if (route === '/api/health' && method === 'GET') return sendJson(res, 200, { ok: true });

  if (route === '/api/me' && method === 'GET') {
    return session ? sendJson(res, 200, { usuario: session }) : fail(res, 401, 'Você não está logado.');
  }

  if (route === '/api/register' && method === 'POST') {
    if (tooManyAttempts(ip)) return fail(res, 429, 'Muitas tentativas. Aguarde alguns minutos.');
    const body = objectBody(await readJson(req));
    const { login, password, error } = validateCredentials(body);
    if (error) return fail(res, 400, error);
    if (auth.isPortariaLogin(login)) return fail(res, 409, 'Esse nome de login é reservado. Escolha outro.');
    if (store.findUser(login)) return fail(res, 409, 'Já existe uma conta com esse nome de login.');
    store.createUser(login, auth.hashPassword(password));
    const sessao = { login, role: 'notificante' };
    return sendJson(res, 201, { usuario: sessao }, { 'Set-Cookie': auth.sessionCookie(auth.createToken(sessao)) });
  }

  if (route === '/api/login' && method === 'POST') {
    if (tooManyAttempts(ip)) return fail(res, 429, 'Muitas tentativas. Aguarde alguns minutos.');
    const body = objectBody(await readJson(req));
    const login = cleanLogin(body.login);
    const password = String(body.password ?? '');
    const sessao = login && password ? auth.authenticate(login, password) : null;
    if (!sessao) return fail(res, 401, 'Login ou senha incorretos.');
    return sendJson(res, 200, { usuario: sessao }, { 'Set-Cookie': auth.sessionCookie(auth.createToken(sessao)) });
  }

  if (route === '/api/logout' && method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  }

  // Daqui para baixo, so logados
  if (!session) return fail(res, 401, 'Entre na sua conta para continuar.');

  if (route === '/api/avisos' && method === 'GET') {
    const avisos = session.role === 'portaria'
      ? store.listAvisos()
      : store.listAvisos({ autorKey: store.normalizeLogin(session.login) });
    return sendJson(res, 200, { avisos });
  }

  if (route === '/api/avisos' && method === 'POST') {
    if (session.role !== 'notificante') return fail(res, 403, 'A portaria apenas recebe avisos.');
    const body = objectBody(await readJson(req));
    const titulo = String(body.titulo ?? '').trim();
    const mensagem = String(body.mensagem ?? '').trim();
    const prioridade = PRIORIDADES.includes(body.prioridade) ? body.prioridade : 'normal';
    if (titulo.length < 3 || titulo.length > 80) return fail(res, 400, 'O título deve ter de 3 a 80 caracteres.');
    if (mensagem.length < 1 || mensagem.length > 600) return fail(res, 400, 'A mensagem deve ter de 1 a 600 caracteres.');
    const aviso = store.createAviso({ autor: session.login, titulo, mensagem, prioridade });
    return sendJson(res, 201, { aviso });
  }

  const match = route.match(/^\/api\/avisos\/(\d+)$/);
  if (match) {
    const aviso = store.getAviso(Number(match[1]));
    if (!aviso) return fail(res, 404, 'Aviso não encontrado.');

    if (method === 'PATCH') {
      if (session.role !== 'portaria') return fail(res, 403, 'Só a portaria pode alterar o andamento do aviso.');
      const body = objectBody(await readJson(req));
      if (!STATUS.includes(body.status)) return fail(res, 400, 'Status inválido.');
      return sendJson(res, 200, { aviso: store.updateStatus(aviso.id, body.status) });
    }

    if (method === 'DELETE') {
      const dono = session.role === 'notificante' && aviso.autorKey === store.normalizeLogin(session.login);
      if (dono && aviso.status === 'novo') { store.deleteAviso(aviso.id); return sendJson(res, 200, { ok: true }); }
      if (session.role === 'portaria' && aviso.status === 'concluido') { store.deleteAviso(aviso.id); return sendJson(res, 200, { ok: true }); }
      return fail(res, 403, dono ? 'Esse aviso já foi visto pela portaria e não pode mais ser apagado.' : 'Você não pode apagar esse aviso.');
    }
  }

  return fail(res, 404, 'Rota não encontrada.');
}

// ---------- Arquivos estaticos ----------
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(config.PUBLIC_DIR, rel));
  if (!file.startsWith(config.PUBLIC_DIR + path.sep)) return fail(res, 403, 'Acesso negado.');
  fs.readFile(file, (err, data) => {
    if (err) {
      if (path.extname(url.pathname)) return fail(res, 404, 'Arquivo não encontrado.');
      // Qualquer outra rota volta para o app (single page)
      return fs.readFile(path.join(config.PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) return fail(res, 404, 'Não encontrado.');
        res.writeHead(200, { 'Content-Type': MIME['.html'], ...SECURITY_HEADERS });
        res.end(html);
      });
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache', ...SECURITY_HEADERS,
    });
    res.end(data);
  });
}

// ---------- Servidor ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Método não permitido.');
    return serveStatic(req, res, url);
  } catch (err) {
    if (err && err.status) return fail(res, err.status, err.message);
    console.error(err);
    return fail(res, 500, 'Erro interno do servidor.');
  }
});

if (require.main === module) {
  server.listen(config.PORT, () => {
    console.log(`Fretar rodando em http://localhost:${config.PORT}`);
    if (config.PORTARIA_PASSWORD === 'Fretar#2026') {
      console.log('Aviso: a senha da Portaria é a padrão. Defina PORTARIA_PASSWORD no .env antes de publicar.');
    }
  });
}

module.exports = server;
