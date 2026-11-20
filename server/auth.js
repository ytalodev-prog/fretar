'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const store = require('./store');

const COOKIE = 'fretar_session';

// ---------- Senhas (scrypt + sal) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Conta da portaria: guardada so em memoria, derivada da configuracao
const PORTARIA_KEY = store.normalizeLogin(config.PORTARIA_LOGIN);
const PORTARIA_HASH = hashPassword(config.PORTARIA_PASSWORD);
const DUMMY_HASH = hashPassword('senha-falsa-para-igualar-tempo');

function isPortariaLogin(login) {
  return store.normalizeLogin(login) === PORTARIA_KEY;
}

// Retorna { login, role } ou null
async function authenticate(login, password) {
  if (isPortariaLogin(login)) {
    return verifyPassword(password, PORTARIA_HASH) ? { login: config.PORTARIA_LOGIN, role: 'portaria' } : null;
  }
  const user = await store.findUser(login);
  if (!user) {
    verifyPassword(password, DUMMY_HASH); // mesmo custo: nao revela se o login existe
    return null;
  }
  return verifyPassword(password, user.passwordHash) ? { login: user.login, role: 'notificante' } : null;
}

// ---------- Sessao (token assinado com HMAC, sem estado no servidor) ----------
function getSecret() {
  if (config.SESSION_SECRET) return config.SESSION_SECRET;
  const file = path.join(config.DATA_DIR, 'secret.key');
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8');
}
let SECRET = null;
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function createToken(session) {
  SECRET = SECRET || getSecret();
  const payload = Buffer.from(JSON.stringify({
    login: session.login, role: session.role,
    exp: Date.now() + config.SESSION_HOURS * 3600 * 1000,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  SECRET = SECRET || getSecret();
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const good = Buffer.from(sign(payload));
  const given = Buffer.from(sig || '');
  if (good.length !== given.length || !crypto.timingSafeEqual(good, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return { login: data.login, role: data.role };
  } catch {
    return null;
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function sessionFromRequest(req) {
  const session = readToken(parseCookies(req.headers.cookie)[COOKIE]);
  if (!session) return null;
  // Conta de notificante apagada do banco? Sessao invalida.
  if (session.role === 'notificante' && !(await store.findUser(session.login))) return null;
  return session;
}

function sessionCookie(token) {
  const maxAge = config.SESSION_HOURS * 3600;
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${config.IS_PROD ? '; Secure' : ''}`;
}
const clearCookie = () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${config.IS_PROD ? '; Secure' : ''}`;

module.exports = {
  hashPassword, authenticate, isPortariaLogin,
  createToken, sessionFromRequest, sessionCookie, clearCookie,
};
