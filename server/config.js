'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

function resolveDatabaseUrl(env = process.env) {
  return (
    env.DATABASE_URL ||
    env.DATABASE_POSTGRES_URL ||
    env.DATABASE_POSTGRES_PRISMA_URL ||
    env.POSTGRES_URL ||
    env.POSTGRES_URL_NON_POOLING ||
    ''
  );
}

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT deve ser um número inteiro entre 1 e 65535.');
}

const config = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  DATA_DIR: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  PORT: port,
  DATABASE_URL: resolveDatabaseUrl(),
  PORTARIA_LOGIN: process.env.PORTARIA_LOGIN || 'Portaria',
  PORTARIA_PASSWORD: process.env.PORTARIA_PASSWORD || 'Fretar#2026',
  SESSION_SECRET: process.env.SESSION_SECRET || '',
  IS_PROD: process.env.NODE_ENV === 'production' || process.env.VERCEL === '1',
  SESSION_HOURS: 12,
};

function validateProductionConfig(settings = config) {
  if (!settings.IS_PROD) return;

  const problems = [];
  if (settings.PORTARIA_PASSWORD === 'Fretar#2026' || settings.PORTARIA_PASSWORD.length < 12 || settings.PORTARIA_PASSWORD.length > 72) {
    problems.push('PORTARIA_PASSWORD precisa ter de 12 a 72 caracteres e não pode ser a senha padrão.');
  }
  if (Buffer.byteLength(settings.SESSION_SECRET, 'utf8') < 32) {
    problems.push('SESSION_SECRET precisa ter pelo menos 32 bytes.');
  }
  if (problems.length) {
    throw new Error(`Configuração de produção inválida:\n- ${problems.join('\n- ')}`);
  }
}

module.exports = { ...config, validateProductionConfig, resolveDatabaseUrl };
