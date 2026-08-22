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

// Obs.: a lista de "recursos agendáveis" (Sala de Informática + cada Estação)
// não é mais fixa aqui — é montada dinamicamente a partir das estações que
// existem de fato no banco (função montarRecursos, mais abaixo), já que agora
// a gestão pode criar novas estações a qualquer momento.

// Dias letivos — a grade de agendamento é semanal fixa (repete toda semana,
// no mesmo espírito da grade de horários oficial da escola).
const DIAS_SEMANA = [
  { id: 'segunda', nome: 'Segunda-feira' },
  { id: 'terca', nome: 'Terça-feira' },
  { id: 'quarta', nome: 'Quarta-feira' },
  { id: 'quinta', nome: 'Quinta-feira' },
  { id: 'sexta', nome: 'Sexta-feira' },
];

// Períodos (aulas) — extraídos dos horários oficiais 2026 da escola.
// "Manhã" = Anos Finais (6º ao 9º); "Tarde/Noite" = Ensino Médio.
// Intervalo e almoço/jantar não entram aqui (não são horários agendáveis).
const PERIODOS = [
  { id: 'm1', turno: 'Manhã',       rotulo: '1ª aula', inicio: '07:00', fim: '07:50' },
  { id: 'm2', turno: 'Manhã',       rotulo: '2ª aula', inicio: '07:50', fim: '08:40' },
  { id: 'm3', turno: 'Manhã',       rotulo: '3ª aula', inicio: '09:00', fim: '09:50' },
  { id: 'm4', turno: 'Manhã',       rotulo: '4ª aula', inicio: '09:50', fim: '10:40' },
  { id: 'm5', turno: 'Manhã',       rotulo: '5ª aula', inicio: '11:30', fim: '12:20' },
  { id: 'm6', turno: 'Manhã',       rotulo: '6ª aula', inicio: '12:20', fim: '13:10' },
  { id: 'm7', turno: 'Manhã',       rotulo: '7ª aula', inicio: '13:10', fim: '14:00' },
  { id: 't1', turno: 'Tarde/Noite', rotulo: '1ª aula', inicio: '14:20', fim: '15:10' },
  { id: 't2', turno: 'Tarde/Noite', rotulo: '2ª aula', inicio: '15:10', fim: '16:00' },
  { id: 't3', turno: 'Tarde/Noite', rotulo: '3ª aula', inicio: '16:20', fim: '17:10' },
  { id: 't4', turno: 'Tarde/Noite', rotulo: '4ª aula', inicio: '17:10', fim: '18:00' },
  { id: 't5', turno: 'Tarde/Noite', rotulo: '5ª aula', inicio: '18:00', fim: '18:50' },
  { id: 't6', turno: 'Tarde/Noite', rotulo: '6ª aula', inicio: '19:40', fim: '20:30' },
  { id: 't7', turno: 'Tarde/Noite', rotulo: '7ª aula', inicio: '20:30', fim: '21:20' },
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
    qtd_retirada  INTEGER,
    tipo          TEXT NOT NULL DEFAULT 'notebook' CHECK (tipo IN ('notebook','tablet')),
    marca         TEXT NOT NULL DEFAULT 'TES Guardian'
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
  // Agendamento com antecedência — pode ser: 'dia' (uma data específica),
  // 'semana' (repete toda semana, sem data final) ou 'mes' (repete todo
  // dia_semana dentro de um mês específico). Cobre tanto "Sala de Informática"
  // (turma toda) quanto reserva futura de uma Estação (A/B/C/...).
  // data_inicio/data_fim delimitam a vigência real da reserva, usados para
  // checar conflito entre reservas de tipos diferentes que se sobrepõem.
  `CREATE TABLE IF NOT EXISTS agendamentos (
    id            ${ID_AUTO},
    usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
    recurso       TEXT NOT NULL,
    tipo          TEXT NOT NULL DEFAULT 'semana' CHECK (tipo IN ('dia','semana','mes')),
    dia_semana    TEXT NOT NULL,
    periodo_id    TEXT NOT NULL,
    mes           TEXT,
    data_inicio   TEXT NOT NULL,
    data_fim      TEXT NOT NULL,
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
  const adicionarColuna = async (tabela, coluna, definicao) => {
    try {
      if (usaPostgres) await run(`ALTER TABLE ${tabela} ADD COLUMN IF NOT EXISTS ${coluna} ${definicao}`);
      else await run(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
    } catch (e) {
      if (!/duplicate column|already exists/i.test(e.message)) throw e;
    }
  };

  await adicionarColuna('usuarios', 'cargo', 'TEXT');
  await adicionarColuna('estacoes', 'tipo', "TEXT NOT NULL DEFAULT 'notebook'");
  await adicionarColuna('estacoes', 'marca', "TEXT NOT NULL DEFAULT 'TES Guardian'");
  // Estação C já existente em bancos antigos passa a ser da marca JEYTECH
  await run("UPDATE estacoes SET marca='JEYTECH' WHERE id='C' AND marca='TES Guardian'");

  // A tabela agendamentos ganhou tipo (dia/semana/mês) e vigência (data_inicio/
  // data_fim). Se o banco está no formato mais antigo (por data única, sem
  // "tipo") ou ainda mais antigo (por data corrida, coluna "data"), recria —
  // são reservas futuras, sem valor histórico que justifique migração de dado.
  const colunas = usaPostgres
    ? await all("SELECT column_name FROM information_schema.columns WHERE table_name='agendamentos'")
    : await all("PRAGMA table_info(agendamentos)");
  const nomes = colunas.map(c => c.column_name || c.name);
  if (nomes.includes('data') || !nomes.includes('tipo')) {
    await run('DROP TABLE IF EXISTS agendamentos');
    await run(`CREATE TABLE agendamentos (
      id            ${ID_AUTO},
      usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
      recurso       TEXT NOT NULL,
      tipo          TEXT NOT NULL DEFAULT 'semana' CHECK (tipo IN ('dia','semana','mes')),
      dia_semana    TEXT NOT NULL,
      periodo_id    TEXT NOT NULL,
      mes           TEXT,
      data_inicio   TEXT NOT NULL,
      data_fim      TEXT NOT NULL,
      turma         TEXT,
      observacao    TEXT,
      status        TEXT NOT NULL DEFAULT 'confirmado' CHECK (status IN ('confirmado','cancelado')),
      criado_em     TEXT NOT NULL
    )`);
    console.log('[banco] Tabela agendamentos migrada para o formato dia/semana/mês.');
  }
}

function gerarSenhaTemporaria() {
  // 8 caracteres fáceis de ditar por telefone/presencialmente (sem 0/O/1/I confusos)
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  return s;
}

// Data usada como "sem fim" para reservas do tipo 'semana' (indefinidas).
const DATA_FIM_INDEFINIDA = '2099-12-31';

// Monta a lista de recursos agendáveis: Sala de Informática + uma entrada por
// estação móvel que existir de fato no banco no momento (em ordem alfabética).
// O texto já reflete se a estação guarda notebooks ou tablets.
async function montarRecursos() {
  const estacoes = await all('SELECT id, tipo FROM estacoes ORDER BY id');
  return [
    { id: 'sala_informatica', nome: 'Sala de Informática (turma toda)' },
    ...estacoes.map(e => ({
      id: 'estacao_' + e.id,
      nome: `Estação ${e.id} (${e.tipo === 'tablet' ? 'tablets' : 'notebooks'})`,
    })),
  ];
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
      const marca = id === 'C' ? 'JEYTECH' : 'TES Guardian';
      await run('INSERT INTO estacoes (id, capacidade, qtd, local, tipo, marca) VALUES (?, ?, ?, ?, ?, ?)',
        [id, cap, cap, LOCAL_PADRAO, 'notebook', marca]);
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
  SALAS, CARGOS_ADMIN, LOCAL_PADRAO, DIAS_SEMANA, PERIODOS, DATA_FIM_INDEFINIDA,
  gerarSenhaTemporaria, montarRecursos,
};
