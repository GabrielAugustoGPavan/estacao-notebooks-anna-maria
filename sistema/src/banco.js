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

// Recursos que podem ser agendados com antecedência
const RECURSOS = [
  { id: 'sala_informatica', nome: 'Sala de Informática (turma toda)' },
  { id: 'estacao_A', nome: 'Estação A (carrinho móvel)' },
  { id: 'estacao_B', nome: 'Estação B (carrinho móvel)' },
  { id: 'estacao_C', nome: 'Estação C (carrinho móvel)' },
];

// Cargos administrativos que a gestão pode cadastrar (além da própria Gestão)
const CARGOS_ADMIN = ['Gestão Escolar', 'Diretor(a)', 'Vice-Diretor(a)', 'CGPAC', 'Estagiário(a)'];

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
    cargo         TEXT,
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
  // Agendamento antecipado — cobre tanto "Sala de Informática" (turma toda)
  // quanto reserva futura de uma Estação (A/B/C) para depois retirada imediata.
  `CREATE TABLE IF NOT EXISTS agendamentos (
    id            ${ID_AUTO},
    usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
    recurso       TEXT NOT NULL,
    data          TEXT NOT NULL,
    hora_inicio   TEXT NOT NULL,
    hora_fim      TEXT NOT NULL,
    sala          TEXT,
    turma         TEXT,
    observacao    TEXT,
    status        TEXT NOT NULL DEFAULT 'confirmado' CHECK (status IN ('confirmado','cancelado')),
    criado_em     TEXT NOT NULL
  )`,
  // Pedidos de recuperação de senha feitos por quem está deslogado.
  // A gestão atende manualmente (gera uma senha temporária e repassa ao usuário).
  `CREATE TABLE IF NOT EXISTS redefinicoes_senha (
    id            ${ID_AUTO},
    usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em     TEXT NOT NULL,
    atendida      INTEGER NOT NULL DEFAULT 0,
    atendida_em   TEXT
  )`,
];

// Pequenas migrações para bancos já existentes (adiciona coluna se faltar).
async function migrar() {
  try {
    if (usaPostgres) await run('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cargo TEXT');
    else await run('ALTER TABLE usuarios ADD COLUMN cargo TEXT');
  } catch (e) {
    if (!/duplicate column|already exists/i.test(e.message)) throw e;
  }
}

function gerarSenhaTemporaria() {
  // 8 caracteres fáceis de ditar por telefone/presencialmente (sem 0/O/1/I confusos)
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  return s;
}

async function inicializar() {
  for (const sql of TABELAS) await run(sql);
  await migrar();

  const temUsuarios = Number((await get('SELECT COUNT(*) AS n FROM usuarios')).n) > 0;
  if (!temUsuarios) {
    const SENHA_INICIAL_PROF = 'mudar123';
    const SENHA_INICIAL_GESTAO = 'gestao123';

    for (const [nome, materia] of PROFESSORES) {
      await run('INSERT INTO usuarios (nome, email, senha_hash, perfil, materia, cargo) VALUES (?, ?, ?, ?, ?, ?)',
        [nome, null, bcrypt.hashSync(SENHA_INICIAL_PROF, 10), 'professor', materia, null]);
    }
    await run('INSERT INTO usuarios (nome, email, senha_hash, perfil, materia, cargo) VALUES (?, ?, ?, ?, ?, ?)',
      ['Gestão Escolar', 'gestao@eeannamaria.sp.gov.br', bcrypt.hashSync(SENHA_INICIAL_GESTAO, 10), 'gestao', null, 'Gestão Escolar']);

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

module.exports = {
  inicializar, all, get, run,
  SALAS, RECURSOS, CARGOS_ADMIN, LOCAL_PADRAO,
  gerarSenhaTemporaria,
};
