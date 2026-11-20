'use strict';
const config = require('../server/config');

if (process.env.VERCEL === '1') {
  const missing = [];
  if (!config.DATABASE_URL) missing.push('DATABASE_URL');
  if (!config.PORTARIA_PASSWORD || config.PORTARIA_PASSWORD === 'Fretar#2026') missing.push('PORTARIA_PASSWORD');
  if (!config.SESSION_SECRET) missing.push('SESSION_SECRET');
  if (missing.length) {
    throw new Error(`Configure estas variáveis na Vercel: ${missing.join(', ')}.`);
  }
  config.validateProductionConfig();
  console.log('Configuração da Vercel validada.');
}
