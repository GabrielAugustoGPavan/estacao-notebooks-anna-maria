// Servidor — Organização Estação Notebooks E.E Anna Maria
// API + interface no mesmo servidor. Regras de negócio aplicadas AQUI (não na tela):
//   1. Professor nunca recebe dados de divergência nem contagem real.
//   2. Professor só retira nova estação após devolver a atual.
//   3. Localização: em uso = sala da aula; devolvida = Sala de Informática.
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { inicializar, all, get, run, SALAS, SLOTS, TURMAS, LOCAL_PADRAO } = require('./banco');

const app = express();
// Render/Railway definem PORT; localmente usamos 3000
const PORTA = process.env.PORT || process.env.PORTA || 3000;
// Em produção defina JWT_SEGREDO no ambiente; sem ele, um segredo aleatório é
// gerado a cada reinício (os logins caem quando o servidor reinicia).
const SEGREDO = process.env.JWT_SEGREDO || crypto.randomBytes(32).toString('hex');

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'publico')));

const agora = () => new Date().toISOString();
// Express 4 não captura erros de funções async — este envelope encaminha ao tratador
const rota = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function notificarGestao(texto) {
  await run('INSERT INTO notificacoes (texto, criada_em) VALUES (?, ?)', [texto, agora()]);
}

// ---------- Autenticação ----------
function exigirLogin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.usuario = jwt.verify(token, SEGREDO);
    next();
  } catch {
    res.status(401).json({ erro: 'Sessão inválida ou expirada. Entre novamente.' });
  }
}
function exigirGestao(req, res, next) {
  if (req.usuario.perfil !== 'gestao') return res.status(403).json({ erro: 'Acesso restrito à gestão.' });
  next();
}
function exigirProfessor(req, res, next) {
  if (req.usuario.perfil !== 'professor') return res.status(403).json({ erro: 'Acesso restrito a professores.' });
  next();
}

// Lista pública de professores (para o seletor da tela de login)
app.get('/api/professores', rota(async (_req, res) => {
  res.json(await all(
    "SELECT id, nome, materia FROM usuarios WHERE perfil='professor' AND ativo=1 ORDER BY nome"
  ));
}));

app.get('/api/salas', (_req, res) => res.json(SALAS));
app.get('/api/horarios', (_req, res) => res.json({ slots: SLOTS, turmas: TURMAS }));

app.post('/api/login', rota(async (req, res) => {
  const { perfil, professorId, email, senha } = req.body || {};
  if (!senha) return res.status(400).json({ erro: 'Informe a senha.' });

  let usuario;
  if (perfil === 'professor') {
    if (!professorId) return res.status(400).json({ erro: 'Selecione seu nome na lista.' });
    usuario = await get("SELECT * FROM usuarios WHERE id=? AND perfil='professor' AND ativo=1", [professorId]);
  } else {
    if (!email) return res.status(400).json({ erro: 'Informe o e-mail institucional.' });
    usuario = await get("SELECT * FROM usuarios WHERE email=? AND perfil='gestao' AND ativo=1",
      [String(email).trim().toLowerCase()]);
  }
  if (!usuario || !bcrypt.compareSync(String(senha), usuario.senha_hash)) {
    return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  }
  const token = jwt.sign({ id: usuario.id, nome: usuario.nome, perfil: usuario.perfil }, SEGREDO, { expiresIn: '12h' });
  res.json({
    token,
    usuario: {
      id: usuario.id, nome: usuario.nome, perfil: usuario.perfil,
      materia: usuario.materia, trocarSenha: !!usuario.troca_senha,
    },
  });
}));

app.post('/api/trocar-senha', exigirLogin, rota(async (req, res) => {
  const { senhaAtual, novaSenha } = req.body || {};
  if (!novaSenha || String(novaSenha).length < 6) {
    return res.status(400).json({ erro: 'A nova senha deve ter pelo menos 6 caracteres.' });
  }
  const usuario = await get('SELECT * FROM usuarios WHERE id=?', [req.usuario.id]);
  // No primeiro acesso (troca obrigatória) a senha atual não é exigida de novo
  if (!usuario.troca_senha) {
    if (!senhaAtual || !bcrypt.compareSync(String(senhaAtual), usuario.senha_hash)) {
      return res.status(401).json({ erro: 'Senha atual incorreta.' });
    }
  }
  await run('UPDATE usuarios SET senha_hash=?, troca_senha=0 WHERE id=?',
    [bcrypt.hashSync(String(novaSenha), 10), req.usuario.id]);
  res.json({ ok: true });
}));

// ---------- Estações ----------
app.get('/api/estacoes', exigirLogin, rota(async (req, res) => {
  const linhas = await all(`
    SELECT e.*, u.nome AS professor_nome
    FROM estacoes e LEFT JOIN usuarios u ON u.id = e.professor_id
    ORDER BY e.id
  `);

  if (req.usuario.perfil === 'gestao') {
    return res.json(linhas.map(e => ({
      id: e.id, capacidade: e.capacidade, qtd: e.qtd,
      emUso: !!e.em_uso, divergencia: !!e.divergencia,
      local: e.local, professorNome: e.professor_nome, sala: e.sala,
    })));
  }
  // Professor: SEM qtd real e SEM divergência — o servidor não envia esses campos
  res.json(linhas.map(e => ({
    id: e.id, capacidade: e.capacidade,
    emUso: !!e.em_uso, local: e.local,
    professorNome: e.professor_nome,
    minha: e.professor_id === req.usuario.id,
  })));
}));

app.post('/api/estacoes/:id/retirada', exigirLogin, exigirProfessor, rota(async (req, res) => {
  const e = await get('SELECT * FROM estacoes WHERE id=?', [req.params.id]);
  if (!e) return res.status(404).json({ erro: 'Estação não encontrada.' });

  const { sala, obs } = req.body || {};
  const qtd = Number(req.body?.qtd);

  const jaTenho = await get('SELECT id FROM estacoes WHERE professor_id=?', [req.usuario.id]);
  if (jaTenho) {
    return res.status(409).json({ erro: `Devolva primeiro a Estação ${jaTenho.id} para retirar outra.` });
  }
  if (!SALAS.some(s => s.id === sala)) return res.status(400).json({ erro: 'Selecione a sala/turma da aula.' });
  if (!Number.isInteger(qtd) || qtd < 0 || qtd > e.capacidade) {
    return res.status(400).json({ erro: `Informe um número inteiro entre 0 e ${e.capacidade}.` });
  }

  // Reserva atômica: só o primeiro professor consegue (WHERE em_uso=0)
  const mudou = await run(
    'UPDATE estacoes SET em_uso=1, professor_id=?, sala=?, local=?, qtd=?, qtd_retirada=? WHERE id=? AND em_uso=0',
    [req.usuario.id, sala, sala, qtd, qtd, e.id]);
  if (!mudou) return res.status(409).json({ erro: 'Esta estação já está em uso.' });

  // Divergência: registrada em silêncio — a resposta ao professor é idêntica
  if (qtd !== e.qtd) {
    await run('UPDATE estacoes SET divergencia=1 WHERE id=?', [e.id]);
    await notificarGestao(`Estação ${e.id} — retirada por Prof. ${req.usuario.nome} (${sala}): encontrou ${qtd}, o sistema esperava ${e.qtd}.`);
  }
  await run('INSERT INTO registros (usuario_id, estacao_id, sala, qtd_ret, data_ret, obs) VALUES (?,?,?,?,?,?)',
    [req.usuario.id, e.id, sala, qtd, agora(), obs || null]);
  if (obs) await notificarGestao(`Observação — Estação ${e.id} (Prof. ${req.usuario.nome}, ${sala}): ${obs}`);

  res.json({ ok: true, mensagem: `Retirada registrada — Estação ${e.id} na ${sala}. Boa aula!` });
}));

app.post('/api/estacoes/:id/devolucao', exigirLogin, exigirProfessor, rota(async (req, res) => {
  const e = await get('SELECT * FROM estacoes WHERE id=?', [req.params.id]);
  if (!e) return res.status(404).json({ erro: 'Estação não encontrada.' });
  if (!e.em_uso || e.professor_id !== req.usuario.id) {
    return res.status(409).json({ erro: 'Esta estação não está em uso por você.' });
  }
  const { obs } = req.body || {};
  const qtd = Number(req.body?.qtd);
  if (!Number.isInteger(qtd) || qtd < 0 || qtd > e.capacidade) {
    return res.status(400).json({ erro: `Informe um número inteiro entre 0 e ${e.capacidade}.` });
  }

  // Divergência: silenciosa para o professor
  if (qtd !== e.qtd_retirada) {
    await run('UPDATE estacoes SET divergencia=1 WHERE id=?', [e.id]);
    await notificarGestao(`Estação ${e.id} — devolução por Prof. ${req.usuario.nome} (${e.sala}): retirou ${e.qtd_retirada}, devolveu ${qtd}.`);
  }
  const reg = await get(
    'SELECT id, obs FROM registros WHERE usuario_id=? AND estacao_id=? AND qtd_dev IS NULL ORDER BY id DESC',
    [req.usuario.id, e.id]);
  if (reg) {
    const obsFinal = obs ? (reg.obs ? reg.obs + ' | ' + obs : obs) : reg.obs;
    await run('UPDATE registros SET qtd_dev=?, data_dev=?, obs=? WHERE id=?', [qtd, agora(), obsFinal, reg.id]);
  }
  await run(
    'UPDATE estacoes SET em_uso=0, professor_id=NULL, sala=NULL, local=?, qtd=?, qtd_retirada=NULL WHERE id=?',
    [LOCAL_PADRAO, qtd, e.id]);
  if (obs) await notificarGestao(`Observação — Estação ${e.id} (Prof. ${req.usuario.nome}): ${obs}`);

  res.json({ ok: true, mensagem: 'Devolução registrada. Obrigado!' });
}));

// ---------- Painel da gestão ----------
app.get('/api/registros', exigirLogin, exigirGestao, rota(async (_req, res) => {
  res.json(await all(`
    SELECT r.*, u.nome AS professor_nome
    FROM registros r JOIN usuarios u ON u.id = r.usuario_id
    ORDER BY r.id DESC LIMIT 200
  `));
}));

app.get('/api/notificacoes', exigirLogin, exigirGestao, rota(async (_req, res) => {
  res.json(await all('SELECT * FROM notificacoes ORDER BY id DESC LIMIT 100'));
}));

// Gestão pode encerrar uma divergência depois de conferir o gabinete
app.post('/api/estacoes/:id/resolver-divergencia', exigirLogin, exigirGestao, rota(async (req, res) => {
  const e = await get('SELECT * FROM estacoes WHERE id=?', [req.params.id]);
  if (!e) return res.status(404).json({ erro: 'Estação não encontrada.' });
  const qtd = Number(req.body?.qtd);
  if (!Number.isInteger(qtd) || qtd < 0 || qtd > e.capacidade) {
    return res.status(400).json({ erro: `Informe a contagem conferida (0 a ${e.capacidade}).` });
  }
  await run('UPDATE estacoes SET divergencia=0, qtd=? WHERE id=?', [qtd, e.id]);
  await notificarGestao(`Estação ${e.id} — divergência resolvida pela gestão. Contagem conferida: ${qtd}.`);
  res.json({ ok: true });
}));

// ---------- Agendamento da Sala de Informática ----------
app.get('/api/agenda', exigirLogin, rota(async (req, res) => {
  const data = String(req.query.data || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ erro: 'Data inválida.' });
  const linhas = await all(`
    SELECT a.*, u.nome AS professor_nome
    FROM agendamentos a JOIN usuarios u ON u.id = a.usuario_id
    WHERE a.data = ?
  `, [data]);
  res.json(linhas.map(a => ({
    id: a.id, slot: a.slot, turma: a.turma,
    professorNome: a.professor_nome,
    minha: a.usuario_id === req.usuario.id,
  })));
}));

// Visão consolidada de todas as reservas — apenas gestão
app.get('/api/agenda/todas', exigirLogin, exigirGestao, rota(async (_req, res) => {
  const linhas = await all(`
    SELECT a.*, u.nome AS professor_nome, u.materia AS professor_materia
    FROM agendamentos a JOIN usuarios u ON u.id = a.usuario_id
    ORDER BY a.data ASC, a.slot ASC
    LIMIT 300
  `);
  res.json(linhas.map(a => ({
    id: a.id, data: a.data, slot: a.slot, turma: a.turma,
    professorNome: a.professor_nome, professorMateria: a.professor_materia,
    criadoEm: a.criado_em,
  })));
}));

app.post('/api/agenda', exigirLogin, exigirProfessor, rota(async (req, res) => {
  const { data, slot, turma } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) return res.status(400).json({ erro: 'Escolha a data.' });
  const hoje = new Date().toLocaleDateString('en-CA');
  if (data < hoje) return res.status(400).json({ erro: 'Não é possível agendar em uma data que já passou.' });
  if (!SLOTS.some(s => s.id === slot)) return res.status(400).json({ erro: 'Escolha o horário da aula.' });
  if (!TURMAS.includes(turma)) return res.status(400).json({ erro: 'Escolha a turma.' });

  try {
    await run('INSERT INTO agendamentos (usuario_id, data, slot, turma, criado_em) VALUES (?,?,?,?,?)',
      [req.usuario.id, data, slot, turma, agora()]);
  } catch (err) {
    // Violação de UNIQUE(data, slot): outro professor reservou primeiro
    if (/UNIQUE|23505|duplicate/i.test(String(err.message) + String(err.code || ''))) {
      return res.status(409).json({ erro: 'Este horário acabou de ser reservado por outro professor.' });
    }
    throw err;
  }
  const s = SLOTS.find(x => x.id === slot);
  res.json({ ok: true, mensagem: `Sala de Informática reservada — ${s.aula} (${s.horario}).` });
}));

app.post('/api/agenda/:id/cancelar', exigirLogin, rota(async (req, res) => {
  const a = await get('SELECT * FROM agendamentos WHERE id=?', [req.params.id]);
  if (!a) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  if (req.usuario.perfil !== 'gestao' && a.usuario_id !== req.usuario.id) {
    return res.status(403).json({ erro: 'Você só pode cancelar os seus próprios agendamentos.' });
  }
  await run('DELETE FROM agendamentos WHERE id=?', [a.id]);
  if (req.usuario.perfil === 'gestao' && a.usuario_id !== req.usuario.id) {
    const u = await get('SELECT nome FROM usuarios WHERE id=?', [a.usuario_id]);
    await notificarGestao(`Agendamento de Prof. ${u ? u.nome : '?'} (${a.data}, ${a.slot}) cancelado pela gestão.`);
  }
  res.json({ ok: true, mensagem: 'Agendamento cancelado.' });
}));

// ---------- Administração (gestão) ----------
// Professor esqueceu a senha → gestão redefine para a inicial; a troca volta a ser obrigatória
app.post('/api/usuarios/:id/resetar-senha', exigirLogin, exigirGestao, rota(async (req, res) => {
  const u = await get("SELECT * FROM usuarios WHERE id=? AND perfil='professor'", [req.params.id]);
  if (!u) return res.status(404).json({ erro: 'Professor não encontrado.' });
  await run('UPDATE usuarios SET senha_hash=?, troca_senha=1 WHERE id=?',
    [bcrypt.hashSync('mudar123', 10), u.id]);
  await notificarGestao(`Senha de Prof. ${u.nome} redefinida pela gestão (volta a ser a inicial).`);
  res.json({ ok: true, mensagem: `Senha de Prof. ${u.nome} redefinida para "mudar123". No próximo acesso será obrigatório criar uma nova.` });
}));

// Ajuste de capacidade (e opcionalmente da contagem atual) de uma estação
app.post('/api/estacoes/:id/capacidade', exigirLogin, exigirGestao, rota(async (req, res) => {
  const e = await get('SELECT * FROM estacoes WHERE id=?', [req.params.id]);
  if (!e) return res.status(404).json({ erro: 'Estação não encontrada.' });
  const capacidade = Number(req.body?.capacidade);
  if (!Number.isInteger(capacidade) || capacidade < 1 || capacidade > 60) {
    return res.status(400).json({ erro: 'Informe uma capacidade entre 1 e 60.' });
  }
  let qtd = req.body?.qtd === undefined || req.body?.qtd === '' ? Math.min(e.qtd, capacidade) : Number(req.body.qtd);
  if (!Number.isInteger(qtd) || qtd < 0 || qtd > capacidade) {
    return res.status(400).json({ erro: `A contagem atual deve ficar entre 0 e ${capacidade}.` });
  }
  await run('UPDATE estacoes SET capacidade=?, qtd=? WHERE id=?', [capacidade, qtd, e.id]);
  await notificarGestao(`Estação ${e.id} — capacidade ajustada pela gestão: ${e.capacidade} → ${capacidade} notebooks (contagem atual: ${qtd}).`);
  res.json({ ok: true, mensagem: `Estação ${e.id} atualizada: capacidade ${capacidade}, contagem atual ${qtd}.` });
}));

// Tratador de erros: nunca vaza detalhes internos para o navegador
app.use((err, _req, res, _next) => {
  console.error('[erro]', err.message);
  res.status(500).json({ erro: 'Erro interno no servidor. Tente novamente.' });
});

inicializar()
  .then(() => {
    app.listen(PORTA, () => {
      console.log('Organização Estação Notebooks — E.E Anna Maria');
      console.log(`Servidor no ar: http://localhost:${PORTA}`);
    });
  })
  .catch(err => {
    console.error('Falha ao iniciar o banco de dados:', err.message);
    process.exit(1);
  });
