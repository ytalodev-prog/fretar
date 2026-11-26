'use strict';
// Teste de ponta a ponta da API, usando um banco temporario.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Aponta o banco para uma pasta temporaria ANTES de carregar o servidor
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fretar-'));
const config = require('../server/config');
config.DATA_DIR = tmp;
config.DATABASE_URL = '';
const server = require('../server/index');

let base;
before(() => new Promise((ok) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; ok(); })));
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function call(method, url, body, cookie) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie');
  return { status: r.status, data: await r.json().catch(() => ({})), cookie: set ? set.split(';')[0] : null };
}

test('fluxo completo: notificante avisa e portaria trata', async () => {
  const cad = await call('POST', '/api/register', { login: 'Almoxarifado B', password: 'segredo1' });
  assert.equal(cad.status, 201);
  const dono = cad.cookie;

  assert.equal((await call('POST', '/api/register', { login: 'almoxarifado b', password: 'outra123' })).status, 409);
  assert.equal((await call('POST', '/api/register', { login: 'portaria', password: 'qualquer1' })).status, 409);

  const novo = await call('POST', '/api/avisos', {
    titulo: 'Entrega', mensagem: 'Chegou material', horarioInicio: '08:30', horarioFim: '10:00', prioridade: 'urgente',
  }, dono);
  assert.equal(novo.status, 201);
  assert.equal(novo.data.aviso.horarioInicio, '08:30');
  assert.equal(novo.data.aviso.horarioFim, '10:00');
  const id = novo.data.aviso.id;

  assert.equal((await call('POST', '/api/login', { login: 'Portaria', password: 'errada' })).status, 401);
  const por = await call('POST', '/api/login', { login: 'Portaria', password: config.PORTARIA_PASSWORD });
  assert.equal(por.status, 200);
  assert.equal(por.data.usuario.role, 'portaria');

  const lista = await call('GET', '/api/avisos', null, por.cookie);
  assert.equal(lista.data.avisos.length, 1);
  assert.equal(lista.data.avisos[0].autor, 'Almoxarifado B');

  assert.equal((await call('PATCH', `/api/avisos/${id}`, { status: 'visto' }, dono)).status, 403);
  assert.equal((await call('PATCH', `/api/avisos/${id}`, { status: 'visto' }, por.cookie)).status, 200);
  assert.equal((await call('POST', '/api/avisos', { titulo: 'x', mensagem: 'y' }, por.cookie)).status, 403);

  const meus = await call('GET', '/api/avisos', null, dono);
  assert.equal(meus.data.avisos[0].status, 'visto');
  assert.equal((await call('PATCH', `/api/avisos/${id}`, { status: 'concluido' }, por.cookie)).status, 200);
  assert.equal((await call('GET', '/api/avisos', null, dono)).data.avisos[0].status, 'concluido');
  assert.equal((await call('PATCH', `/api/avisos/${id}`, { status: 'visto' }, por.cookie)).status, 200);
  assert.equal((await call('GET', '/api/avisos', null, dono)).data.avisos[0].status, 'visto');
  assert.equal((await call('PATCH', `/api/avisos/${id}`, { status: 'concluido' }, por.cookie)).status, 200);
  assert.equal((await call('DELETE', `/api/avisos/${id}`, null, por.cookie)).status, 200);
});

test('notificante pode apagar avisos próprios em qualquer andamento, mas não avisos alheios', async () => {
  const dono = await call('POST', '/api/register', { login: 'Setor dono', password: 'segredo1' });
  const outro = await call('POST', '/api/register', { login: 'Outro setor', password: 'segredo1' });
  const portaria = await call('POST', '/api/login', { login: 'Portaria', password: config.PORTARIA_PASSWORD });

  const visto = await call('POST', '/api/avisos', { titulo: 'Aviso visto', mensagem: 'Teste' }, dono.cookie);
  assert.equal((await call('PATCH', `/api/avisos/${visto.data.aviso.id}`, { status: 'visto' }, portaria.cookie)).status, 200);
  assert.equal((await call('DELETE', `/api/avisos/${visto.data.aviso.id}`, null, dono.cookie)).status, 200);

  const concluido = await call('POST', '/api/avisos', { titulo: 'Aviso concluído', mensagem: 'Teste' }, dono.cookie);
  assert.equal((await call('PATCH', `/api/avisos/${concluido.data.aviso.id}`, { status: 'concluido' }, portaria.cookie)).status, 200);
  assert.equal((await call('DELETE', `/api/avisos/${concluido.data.aviso.id}`, null, dono.cookie)).status, 200);

  const alheio = await call('POST', '/api/avisos', { titulo: 'Aviso alheio', mensagem: 'Teste' }, outro.cookie);
  assert.equal((await call('DELETE', `/api/avisos/${alheio.data.aviso.id}`, null, dono.cookie)).status, 403);
});

test('horários opcionais do aviso validam o formato HH:MM', async () => {
  const cadastro = await call('POST', '/api/register', { login: 'Expedição', password: 'segredo1' });
  const invalido = await call('POST', '/api/avisos', {
    titulo: 'Janela de entrega', mensagem: 'Receber carga', horarioInicio: '25:30',
  }, cadastro.cookie);
  assert.equal(invalido.status, 400);

  const semHorario = await call('POST', '/api/avisos', {
    titulo: 'Aviso sem horário', mensagem: 'Atender quando possível',
  }, cadastro.cookie);
  assert.equal(semHorario.status, 201);
  assert.equal(semHorario.data.aviso.horarioInicio, '');
  assert.equal(semHorario.data.aviso.horarioFim, '');
});

test('notificante so ve os proprios avisos e rotas exigem login', async () => {
  assert.equal((await call('GET', '/api/avisos')).status, 401);
  const a = await call('POST', '/api/register', { login: 'Setor A', password: 'abcdef' });
  const b = await call('POST', '/api/register', { login: 'Setor B', password: 'abcdef' });
  await call('POST', '/api/avisos', { titulo: 'Aviso A', mensagem: 'a' }, a.cookie);
  const meus = await call('GET', '/api/avisos', null, b.cookie);
  assert.equal(meus.data.avisos.length, 0);
});

test('cookie adulterado e rejeitado', async () => {
  const r = await call('GET', '/api/me', null, 'fretar_session=abc.def');
  assert.equal(r.status, 401);
});

test('health, arquivos estaticos e recursos ausentes', async () => {
  assert.equal((await call('GET', '/api/health')).status, 200);
  assert.equal((await call('GET', '/index.html')).status, 200);
  assert.equal((await call('HEAD', '/index.html')).status, 200);
  assert.equal((await call('GET', '/img/nao-existe.png')).status, 404);
});

test('payloads JSON que nao sao objetos falham sem erro interno', async () => {
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' };
  const cadastro = await fetch(base + '/api/register', options);
  assert.equal(cadastro.status, 400);
  const login = await fetch(base + '/api/login', options);
  assert.equal(login.status, 401);
});

test('configuracao de producao exige senha e segredo proprios', () => {
  const validar = config.validateProductionConfig;
  assert.throws(() => validar({
    IS_PROD: true,
    PORTARIA_PASSWORD: 'Fretar#2026',
    SESSION_SECRET: '',
  }), /PORTARIA_PASSWORD[\s\S]*SESSION_SECRET/);
  assert.doesNotThrow(() => validar({
    IS_PROD: true,
    PORTARIA_PASSWORD: 'Senha-forte-da-portaria-2026',
    SESSION_SECRET: 'a'.repeat(64),
  }));
});

test('configuração aceita variáveis de conexão da Neon e mantém prioridade de DATABASE_URL', () => {
  const { resolveDatabaseUrl } = config;
  const connectionString = 'postgres://neon-vercel-test';
  for (const name of [
    'DATABASE_URL',
    'DATABASE_POSTGRES_URL',
    'DATABASE_POSTGRES_PRISMA_URL',
    'POSTGRES_URL',
    'POSTGRES_URL_NON_POOLING',
  ]) {
    assert.equal(resolveDatabaseUrl({ [name]: connectionString }), connectionString);
  }
  assert.equal(resolveDatabaseUrl({
    DATABASE_URL: 'postgres://primary',
    DATABASE_POSTGRES_PRISMA_URL: connectionString,
  }), 'postgres://primary');
});

test('hashes de senha malformados são rejeitados sem derrubar o login', () => {
  const auth = require('../server/auth');
  assert.equal(auth.verifyPassword('qualquer1', 'hash-malformado'), false);
});
