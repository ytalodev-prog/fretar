'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const DB_FILE = path.join(config.DATA_DIR, 'db.json');
let db = { users: [], avisos: [], nextId: 1 };
let sql = null;

function normalizeLogin(login) {
  return String(login).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function persist() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function fromUserRow(row) {
  return {
    key: row.login_key,
    login: row.login,
    passwordHash: row.password_hash,
    criadoEm: new Date(row.created_at).toISOString(),
  };
}

function fromAvisoRow(row) {
  return {
    id: Number(row.id),
    autor: row.autor,
    autorKey: row.autor_key,
    titulo: row.titulo,
    mensagem: row.mensagem,
    horarioInicio: row.horario_inicio ? String(row.horario_inicio).slice(0, 5) : '',
    horarioFim: row.horario_fim ? String(row.horario_fim).slice(0, 5) : '',
    dataProgramada: row.data_programada
      ? (row.data_programada instanceof Date ? row.data_programada.toISOString().slice(0, 10) : String(row.data_programada).slice(0, 10))
      : '',
    prioridade: row.prioridade,
    status: row.status,
    criadoEm: new Date(row.created_at).toISOString(),
    atualizadoEm: new Date(row.updated_at).toISOString(),
  };
}

async function load() {
  if (config.DATABASE_URL) {
    const { neon } = require('@neondatabase/serverless');
    sql = neon(config.DATABASE_URL);
    await sql`
      CREATE TABLE IF NOT EXISTS fretar_users (
        login_key TEXT PRIMARY KEY,
        login TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS fretar_avisos (
        id SERIAL PRIMARY KEY,
        autor TEXT NOT NULL,
        autor_key TEXT NOT NULL,
        titulo TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        horario_inicio TIME,
        horario_fim TIME,
        data_programada DATE,
        prioridade TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`ALTER TABLE fretar_avisos ADD COLUMN IF NOT EXISTS horario_inicio TIME`;
    await sql`ALTER TABLE fretar_avisos ADD COLUMN IF NOT EXISTS horario_fim TIME`;
    await sql`ALTER TABLE fretar_avisos ADD COLUMN IF NOT EXISTS data_programada DATE`;
    return;
  }

  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    persist();
  }
}

async function findUser(login) {
  const key = normalizeLogin(login);
  if (!sql) return db.users.find((user) => user.key === key) || null;
  const rows = await sql`SELECT * FROM fretar_users WHERE login_key = ${key} LIMIT 1`;
  return rows.length ? fromUserRow(rows[0]) : null;
}

async function createUser(login, passwordHash) {
  const key = normalizeLogin(login);
  if (!sql) {
    const user = { key, login, passwordHash, criadoEm: new Date().toISOString() };
    db.users.push(user);
    persist();
    return user;
  }

  const rows = await sql`
    INSERT INTO fretar_users (login_key, login, password_hash)
    VALUES (${key}, ${login}, ${passwordHash})
    RETURNING *
  `;
  return fromUserRow(rows[0]);
}

async function listAvisos({ autorKey, dataDisponivelAte } = {}) {
  if (!sql) {
    const list = db.avisos.filter((aviso) =>
      (!autorKey || aviso.autorKey === autorKey) &&
      (!dataDisponivelAte || !aviso.dataProgramada || aviso.dataProgramada <= dataDisponivelAte));
    return [...list].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  }

  let rows;
  if (autorKey && dataDisponivelAte) {
    rows = await sql`
      SELECT * FROM fretar_avisos
      WHERE autor_key = ${autorKey}
        AND (data_programada IS NULL OR data_programada <= ${dataDisponivelAte}::date)
      ORDER BY created_at DESC, id DESC
    `;
  } else if (autorKey) {
    rows = await sql`SELECT * FROM fretar_avisos WHERE autor_key = ${autorKey} ORDER BY created_at DESC, id DESC`;
  } else if (dataDisponivelAte) {
    rows = await sql`
      SELECT * FROM fretar_avisos
      WHERE data_programada IS NULL OR data_programada <= ${dataDisponivelAte}::date
      ORDER BY created_at DESC, id DESC
    `;
  } else {
    rows = await sql`SELECT * FROM fretar_avisos ORDER BY created_at DESC, id DESC`;
  }
  return rows.map(fromAvisoRow);
}

async function createAviso({ autor, titulo, mensagem, horarioInicio, horarioFim, dataProgramada, prioridade }) {
  const autorKey = normalizeLogin(autor);
  if (!sql) {
    const agora = new Date().toISOString();
    const aviso = {
      id: db.nextId++,
      autor,
      autorKey,
      titulo,
      mensagem,
      horarioInicio,
      horarioFim,
      dataProgramada,
      prioridade,
      status: 'novo',
      criadoEm: agora,
      atualizadoEm: agora,
    };
    db.avisos.push(aviso);
    persist();
    return aviso;
  }

  const rows = await sql`
    INSERT INTO fretar_avisos
      (autor, autor_key, titulo, mensagem, horario_inicio, horario_fim, data_programada, prioridade, status)
    VALUES (${autor}, ${autorKey}, ${titulo}, ${mensagem}, ${horarioInicio || null}, ${horarioFim || null}, ${dataProgramada || null}, ${prioridade}, 'novo')
    RETURNING *
  `;
  return fromAvisoRow(rows[0]);
}

async function getAviso(id) {
  if (!sql) return db.avisos.find((aviso) => aviso.id === id) || null;
  const rows = await sql`SELECT * FROM fretar_avisos WHERE id = ${id} LIMIT 1`;
  return rows.length ? fromAvisoRow(rows[0]) : null;
}

async function updateStatus(id, status) {
  if (!sql) {
    const aviso = await getAviso(id);
    if (!aviso) return null;
    aviso.status = status;
    aviso.atualizadoEm = new Date().toISOString();
    persist();
    return aviso;
  }

  const rows = await sql`
    UPDATE fretar_avisos
    SET status = ${status}, updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return rows.length ? fromAvisoRow(rows[0]) : null;
}

async function deleteAviso(id, { autorKey, status } = {}) {
  if (!sql) {
    const index = db.avisos.findIndex((aviso) => aviso.id === id);
    if (index === -1) return false;
    const aviso = db.avisos[index];
    if ((autorKey && aviso.autorKey !== autorKey) || (status && aviso.status !== status)) return false;
    db.avisos.splice(index, 1);
    persist();
    return true;
  }

  const rows = autorKey
    ? status
      ? await sql`DELETE FROM fretar_avisos WHERE id = ${id} AND autor_key = ${autorKey} AND status = ${status} RETURNING id`
      : await sql`DELETE FROM fretar_avisos WHERE id = ${id} AND autor_key = ${autorKey} RETURNING id`
    : status
      ? await sql`DELETE FROM fretar_avisos WHERE id = ${id} AND status = ${status} RETURNING id`
      : await sql`DELETE FROM fretar_avisos WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

async function importLegacyData(data) {
  if (!sql) throw new Error('DATABASE_URL é obrigatório para importar dados ao Neon.');
  if (!data || !Array.isArray(data.users) || !Array.isArray(data.avisos)) {
    throw new Error('O arquivo JSON não tem o formato de banco do Fretar.');
  }

  const [counts] = await sql`
    SELECT
      (SELECT count(*) FROM fretar_users) AS users,
      (SELECT count(*) FROM fretar_avisos) AS avisos
  `;
  if (Number(counts.users) || Number(counts.avisos)) {
    throw new Error('O banco Neon de destino precisa estar vazio antes da importação.');
  }

  const queries = [];
  for (const user of data.users) {
    queries.push(sql`
      INSERT INTO fretar_users (login_key, login, password_hash, created_at)
      VALUES (${user.key}, ${user.login}, ${user.passwordHash}, ${user.criadoEm})
    `);
  }
  for (const aviso of data.avisos) {
    queries.push(sql`
      INSERT INTO fretar_avisos
        (id, autor, autor_key, titulo, mensagem, horario_inicio, horario_fim, data_programada, prioridade, status, created_at, updated_at)
      VALUES
        (${aviso.id}, ${aviso.autor}, ${aviso.autorKey}, ${aviso.titulo}, ${aviso.mensagem},
         ${aviso.horarioInicio || null}, ${aviso.horarioFim || null}, ${aviso.dataProgramada || null},
         ${aviso.prioridade}, ${aviso.status}, ${aviso.criadoEm}, ${aviso.atualizadoEm})
    `);
  }
  if (queries.length) await sql.transaction(queries);

  const lastId = data.avisos.reduce(
    (max, aviso) => Math.max(max, Number(aviso.id)),
    Number(data.nextId || 1) - 1,
  );
  if (lastId > 0) {
    await sql`SELECT setval(pg_get_serial_sequence('public.fretar_avisos', 'id'), ${lastId}, true)`;
  }

  return { users: data.users.length, avisos: data.avisos.length };
}

module.exports = {
  load, normalizeLogin, findUser, createUser,
  listAvisos, createAviso, getAviso, updateStatus, deleteAviso,
  importLegacyData,
};
