// Banco de dados em modo duplo:
//   - Local (padrão): SQLite embutido no Node.js — arquivo escola.db, zero instalação
//   - Nuvem: PostgreSQL (Neon/Supabase/Render) — basta definir DATABASE_URL no ambiente
// A API é a mesma nos dois modos: all(), get() e run(), sempre assíncronas.
const path = require('node:path');
const bcrypt = require('bcryptjs');

const usaPostgres = !!process.env.DATABASE_URL;
const LOCAL_PADRAO = 'Sala de Informática';

const SALAS = [
  { id: 'Sala 1', turmas: '8º B / 3º TA EM (Téc. Vendas)' },
  { id: 'Sala 2', turmas: '8º A / 3º A EM' },
  { id: 'Sala 3', turmas: '7º B / 2º TA EM' },
  { id: 'Sala 4', turmas: '7º A / 2º A' },
  { id: 'Sala 5', turmas: '6º B / 1º B' },
  { id: 'Sala 6', turmas: '6º A / 1º A' },
  { id: 'Sala 8', turmas: '9º B' },
  { id: 'Sala 9', turmas: '9º A' },
];

// Horários das aulas (PDFs 2026): manhã = Anos Finais, tarde/noite = Ensino Médio
const SLOTS = [
  { id: 'M1', turno: 'Manhã — Anos Finais', aula: '1ª aula', horario: '7:00–7:50' },
  { id: 'M2', turno: 'Manhã — Anos Finais', aula: '2ª aula', horario: '7:50–8:40' },
  { id: 'M3', turno: 'Manhã — Anos Finais', aula: '3ª aula', horario: '9:00–9:50' },
  { id: 'M4', turno: 'Manhã — Anos Finais', aula: '4ª aula', horario: '9:50–10:40' },
  { id: 'M5', turno: 'Manhã — Anos Finais', aula: '5ª aula', horario: '11:30–12:20' },
  { id: 'M6', turno: 'Manhã — Anos Finais', aula: '6ª aula', horario: '12:20–13:10' },
  { id: 'M7', turno: 'Manhã — Anos Finais', aula: '7ª aula', horario: '13:10–14:00' },
  { id: 'T1', turno: 'Tarde/Noite — Ensino Médio', aula: '1ª aula', horario: '14:20–15:10' },
  { id: 'T2', turno: 'Tarde/Noite — Ensino Médio', aula: '2ª aula', horario: '15:10–16:00' },
  { id: 'T3', turno: 'Tarde/Noite — Ensino Médio', aula: '3ª aula', horario: '16:20–17:10' },
  { id: 'T4', turno: 'Tarde/Noite — Ensino Médio', aula: '4ª aula', horario: '17:10–18:00' },
  { id: 'T5', turno: 'Tarde/Noite — Ensino Médio', aula: '5ª aula', horario: '18:00–18:50' },
  { id: 'T6', turno: 'Tarde/Noite — Ensino Médio', aula: '6ª aula', horario: '19:40–20:30' },
  { id: 'T7', turno: 'Tarde/Noite — Ensino Médio', aula: '7ª aula', horario: '20:30–21:20' },
];

// Turmas da escola (Anos Finais + Ensino Médio + Técnico em Vendas)
const TURMAS = [
  '6º A', '6º B', '7º A', '7º B', '8º A', '8º B', '9º A', '9º B',
  '1º A EM', '1º B EM', '2º A EM', '3º A EM',
  '2º TA (Téc. Vendas)', '3º TA (Téc. Vendas)',
];

// Professores extraídos dos horários 2026 (Anos Finais + Ensino Médio)
const PROFESSORES = [
  ['Alex',      'Geografia / Filosofia / Projeto de Vida'],
  ['Caroline',  'Língua Portuguesa / Inglês'],
  ['Cynthian',  'Téc. Vendas — Marketing / Mat. Básica'],
  ['Daniela',   'História / Atualidades'],
  ['Dimas',     'História / Projeto de Vida'],
  ['Gabão',     'Matemática'],
  ['Jane',      'Inglês'],
  ['Laércio',   'Ciências / Matemática / Ed. Financeira'],
  ['Layla',     'Arte'],
  ['Letícia',   'Matemática'],
  ['Lucas',     'Ciências / Biologia'],
  ['Magali',    'Matemática / Tecnologia / Ed. Financeira'],
  ['Marcos',    'Téc. Vendas — Tecnologia / Planejamento / Carreira'],
  ['Maria V.',  'Geografia'],
  ['Melanie',   'Física / Química'],
  ['Ranif',     'Língua Portuguesa / Redação'],
  ['Robson',    'Sociologia / Filosofia / História'],
  ['Rosana',    'Língua Portuguesa / Redação e Leitura'],
  ['Sandra',    'Matemática / Ed. Financeira'],
  ['Vinícius',  'Téc. Vendas — Proc. Comercial / Comunicação'],
  ['Viviane',   'Língua Portuguesa / Redação e Leitura'],
  ['Yago',      'Educação Física'],
];

let all, get, run;

if (usaPostgres) {
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  const pool = new Pool({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
  });
  // PostgreSQL usa $1, $2… no lugar de "?"
  const traduz = sql => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };
  all = async (sql, params = []) => (await pool.query(traduz(sql), params)).rows;
  get = async (sql, params = []) => (await all(sql, params))[0];
  run = async (sql, params = []) => (await pool.query(traduz(sql), params)).rowCount;
} else {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(__dirname, '..', 'escola.db'));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  all = async (sql, params = []) => db.prepare(sql).all(...params);
  get = async (sql, params = []) => db.prepare(sql).get(...params);
  run = async (sql, params = []) => Number(db.prepare(sql).run(...params).changes);
}

const ID_AUTO = usaPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';

const TABELAS = [
  `CREATE TABLE IF NOT EXISTS usuarios (
    id            ${ID_AUTO},
    nome          TEXT NOT NULL UNIQUE,
    email         TEXT UNIQUE,
    senha_hash    TEXT NOT NULL,
    perfil        TEXT NOT NULL CHECK (perfil IN ('professor','gestao')),
    materia       TEXT,
    ativo         INTEGER NOT NULL DEFAULT 1,
    troca_senha   INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS estacoes (
    id            TEXT PRIMARY KEY,
    capacidade    INTEGER NOT NULL,
    qtd           INTEGER NOT NULL,
    em_uso        INTEGER NOT NULL DEFAULT 0,
    divergencia   INTEGER NOT NULL DEFAULT 0,
    local         TEXT NOT NULL,
    professor_id  INTEGER REFERENCES usuarios(id),
    sala          TEXT,
    qtd_retirada  INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS registros (
    id            ${ID_AUTO},
    usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
    estacao_id    TEXT NOT NULL REFERENCES estacoes(id),
    sala          TEXT NOT NULL,
    qtd_ret       INTEGER NOT NULL,
    data_ret      TEXT NOT NULL,
    qtd_dev       INTEGER,
    data_dev      TEXT,
    obs           TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS notificacoes (
    id            ${ID_AUTO},
    texto         TEXT NOT NULL,
    criada_em     TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agendamentos (
    id            ${ID_AUTO},
    usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
    data          TEXT NOT NULL,
    slot          TEXT NOT NULL,
    turma         TEXT NOT NULL,
    criado_em     TEXT NOT NULL,
    UNIQUE (data, slot)
  )`,
];

async function inicializar() {
  for (const sql of TABELAS) await run(sql);

  const temUsuarios = Number((await get('SELECT COUNT(*) AS n FROM usuarios')).n) > 0;
  if (!temUsuarios) {
    const SENHA_INICIAL_PROF = 'mudar123';
    const SENHA_INICIAL_GESTAO = 'gestao123';

    for (const [nome, materia] of PROFESSORES) {
      await run('INSERT INTO usuarios (nome, email, senha_hash, perfil, materia) VALUES (?, ?, ?, ?, ?)',
        [nome, null, bcrypt.hashSync(SENHA_INICIAL_PROF, 10), 'professor', materia]);
    }
    await run('INSERT INTO usuarios (nome, email, senha_hash, perfil, materia) VALUES (?, ?, ?, ?, ?)',
      ['Gestão Escolar', 'gestao@eeannamaria.sp.gov.br', bcrypt.hashSync(SENHA_INICIAL_GESTAO, 10), 'gestao', null]);

    for (const [id, cap] of [['A', 32], ['B', 32], ['C', 30]]) {
      await run('INSERT INTO estacoes (id, capacidade, qtd, local) VALUES (?, ?, ?, ?)',
        [id, cap, cap, LOCAL_PADRAO]);
    }

    console.log('[banco] Carga inicial criada:');
    console.log(`[banco]   ${PROFESSORES.length} professores — senha inicial: ${SENHA_INICIAL_PROF}`);
    console.log(`[banco]   Gestão (gestao@eeannamaria.sp.gov.br) — senha inicial: ${SENHA_INICIAL_GESTAO}`);
    console.log('[banco]   Todos devem trocar a senha no primeiro acesso.');
  }
  console.log(`[banco] Modo: ${usaPostgres ? 'PostgreSQL (nuvem)' : 'SQLite (local — escola.db)'}`);
}

module.exports = { inicializar, all, get, run, SALAS, SLOTS, TURMAS, LOCAL_PADRAO };
