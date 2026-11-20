'use strict';
// Armazenamento em arquivo JSON (data/db.json). Simples, sem dependencias.
// Para escalar, troque este modulo por SQLite/PostgreSQL mantendo as mesmas funcoes.
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('./config');

const DB_FILE = path.join(DATA_DIR, 'db.json');
let db = { users: [], avisos: [], nextId: 1 };

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    persist();
  }
}

function persist() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE); // troca atomica: evita arquivo corrompido
}

// "Almoxarifado" e "almoxarífado" contam como o mesmo login
function normalizeLogin(login) {
  return String(login).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function findUser(login) {
  const key = normalizeLogin(login);
  return db.users.find((u) => u.key === key) || null;
}

function createUser(login, passwordHash) {
  const user = { key: normalizeLogin(login), login, passwordHash, criadoEm: new Date().toISOString() };
  db.users.push(user);
  persist();
  return user;
}

function listAvisos({ autorKey } = {}) {
  const list = autorKey ? db.avisos.filter((a) => a.autorKey === autorKey) : db.avisos;
  return [...list].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

function createAviso({ autor, titulo, mensagem, prioridade }) {
  const agora = new Date().toISOString();
  const aviso = {
    id: db.nextId++,
    autor,
    autorKey: normalizeLogin(autor),
    titulo,
    mensagem,
    prioridade,
    status: 'novo',
    criadoEm: agora,
    atualizadoEm: agora,
  };
  db.avisos.push(aviso);
  persist();
  return aviso;
}

function getAviso(id) {
  return db.avisos.find((a) => a.id === id) || null;
}

function updateStatus(id, status) {
  const aviso = getAviso(id);
  if (!aviso) return null;
  aviso.status = status;
  aviso.atualizadoEm = new Date().toISOString();
  persist();
  return aviso;
}

function deleteAviso(id) {
  const i = db.avisos.findIndex((a) => a.id === id);
  if (i === -1) return false;
  db.avisos.splice(i, 1);
  persist();
  return true;
}

module.exports = {
  load, normalizeLogin, findUser, createUser,
  listAvisos, createAviso, getAviso, updateStatus, deleteAviso,
};
