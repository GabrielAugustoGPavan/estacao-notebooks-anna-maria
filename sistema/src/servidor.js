// Servidor — Organização Estação Notebooks E.E Anna Maria
// API + interface no mesmo servidor. Regras de negócio aplicadas AQUI (não na tela):
//   1. Professor nunca recebe dados de divergência nem contagem real.
//   2. Professor só retira nova estação após devolver a atual.
//   3. Localização: em uso = sala da aula; devolvida = Sala de Informática.
//   4. Contas administrativas (Gestão, Diretor, Vice-Diretor, CGPAC, Estagiário)
//      têm as mesmas permissões de gestão — diferenciadas apenas pelo "cargo" exibido.
//   5. Redefinição de senha nunca é automática por e-mail (a escola não tem esse
//      serviço configurado): o pedido cai numa fila e a gestão atende manualmente,
//      gerando uma senha temporária para repassar ao professor.
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  inicializar, all, get, run,
  SALAS, CARGOS_ADMIN, LOCAL_PADRAO, DIAS_SEMANA, PERIODOS, DATA_FIM_INDEFINIDA,
  gerarSenhaTemporaria, montarRecursos,
} = require('./banco');

const app = express();
// Render/Railway definem PORT; localmente usamos 3000
const PORTA = process.env.PORT || process.env.PORTA || 3000;
// Em produção defina JWT_SEGREDO no ambiente; sem ele, um segredo aleatório é
// gerado a cada reinício (os logins caem quando o servidor reinicia).
const SEGREDO = process.env.JWT_SEGREDO || crypto.randomBytes(32).toString('hex');

app.use(express.json({ limit: '2mb' })); // limite maior: permite colar planilhas CSV no corpo
app.use(express.static(path.join(__dirname, '..', 'publico')));

const agora = () => new Date().toISOString();
const hojeISO = () => new Date().toISOString().slice(0, 10);
const DIA_SEMANA_POR_INDICE = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
function diaSemanaDeData(dataStr) {
  const [ano, mes, dia] = dataStr.split('-').map(Number);
  return DIA_SEMANA_POR_INDICE[new Date(ano, mes - 1, dia).getDay()];
}
function limitesMes(mesStr) {
  const [ano, mes] = mesStr.split('-').map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  return { inicio: `${mesStr}-01`, fim: `${mesStr}-${String(ultimoDia).padStart(2, '0')}` };
}
// Horário atual no formato HH:MM, para achar em qual período/aula estamos agora
function horaAgoraHM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function periodoAtual() {
  const hm = horaAgoraHM();
  return PERIODOS.find(p => hm >= p.inicio && hm < p.fim) || null;
}
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
app.get('/api/recursos', rota(async (_req, res) => res.json(await montarRecursos())));
app.get('/api/cargos', (_req, res) => res.json(CARGOS_ADMIN));
app.get('/api/dias-semana', (_req, res) => res.json(DIAS_SEMANA));
app.get('/api/periodos', (_req, res) => res.json(PERIODOS));

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
      materia: usuario.materia, cargo: usuario.cargo, trocarSenha: !!usuario.troca_senha,
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

// ---------- Recuperação de senha (usuário deslogado) ----------
// Sem serviço de e-mail configurado na escola: o pedido entra numa fila e a
// gestão atende manualmente, gerando uma senha temporária para repassar.
app.post('/api/recuperar-senha', rota(async (req, res) => {
  const { perfil, professorId, email } = req.body || {};
  let usuario = null;
  if (perfil === 'professor' && professorId) {
    usuario = await get("SELECT * FROM usuarios WHERE id=? AND perfil='professor' AND ativo=1", [professorId]);
  } else if (email) {
    usuario = await get("SELECT * FROM usuarios WHERE email=? AND perfil='gestao' AND ativo=1",
      [String(email).trim().toLowerCase()]);
  }
  // Resposta genérica sempre — não revela se o usuário existe ou não
  if (usuario) {
    await run('INSERT INTO redefinicoes_senha (usuario_id, criado_em) VALUES (?, ?)', [usuario.id, agora()]);
    await notificarGestao(`Pedido de redefinição de senha — ${usuario.nome} (${usuario.perfil === 'gestao' ? usuario.cargo || 'Gestão' : 'Professor(a)'}).`);
  }
  res.json({ ok: true, mensagem: 'Pedido enviado. Procure a gestão/direção para receber sua nova senha temporária.' });
}));

app.get('/api/redefinicoes-pendentes', exigirLogin, exigirGestao, rota(async (_req, res) => {
  res.json(await all(`
    SELECT rs.id, rs.criado_em, u.id AS usuario_id, u.nome, u.perfil, u.cargo
    FROM redefinicoes_senha rs JOIN usuarios u ON u.id = rs.usuario_id
    WHERE rs.atendida = 0
    ORDER BY rs.id DESC
  `));
}));

app.post('/api/redefinicoes/:id/atender', exigirLogin, exigirGestao, rota(async (req, res) => {
  const pedido = await get('SELECT * FROM redefinicoes_senha WHERE id=?', [req.params.id]);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (pedido.atendida) return res.status(409).json({ erro: 'Este pedido já foi atendido.' });

  const usuario = await get('SELECT * FROM usuarios WHERE id=?', [pedido.usuario_id]);
  const senhaTemp = gerarSenhaTemporaria();
  await run('UPDATE usuarios SET senha_hash=?, troca_senha=1 WHERE id=?',
    [bcrypt.hashSync(senhaTemp, 10), usuario.id]);
  await run('UPDATE redefinicoes_senha SET atendida=1, atendida_em=? WHERE id=?', [agora(), pedido.id]);

  res.json({ ok: true, nome: usuario.nome, senhaTemp });
}));

// ---------- Contas de usuários (gestão) ----------
app.get('/api/usuarios', exigirLogin, exigirGestao, rota(async (_req, res) => {
  res.json(await all(
    'SELECT id, nome, email, perfil, materia, cargo, ativo FROM usuarios ORDER BY perfil DESC, nome'
  ));
}));

// Criar conta administrativa: Diretor(a), Vice-Diretor(a), CGPAC, Estagiário(a), Gestão
app.post('/api/usuarios/admin', exigirLogin, exigirGestao, rota(async (req, res) => {
  const { nome, email, cargo } = req.body || {};
  if (!nome || !String(nome).trim()) return res.status(400).json({ erro: 'Informe o nome.' });
  if (!email || !String(email).includes('@')) return res.status(400).json({ erro: 'Informe um e-mail institucional válido.' });
  if (!CARGOS_ADMIN.includes(cargo)) {
    return res.status(400).json({ erro: `Cargo inválido. Use um de: ${CARGOS_ADMIN.join(', ')}.` });
  }
  const existe = await get('SELECT id FROM usuarios WHERE email=?', [String(email).trim().toLowerCase()]);
  if (existe) return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });

  const senhaTemp = gerarSenhaTemporaria();
  await run(
    'INSERT INTO usuarios (nome, email, senha_hash, perfil, materia, cargo) VALUES (?, ?, ?, ?, ?, ?)',
    [String(nome).trim(), String(email).trim().toLowerCase(), bcrypt.hashSync(senhaTemp, 10), 'gestao', null, cargo]
  );
  res.json({ ok: true, senhaTemp });
}));

// Criar conta de professor(a) — a lista inicial já vem pronta com os horários
// 2026, mas a gestão pode cadastrar novos professores a qualquer momento.
app.post('/api/usuarios/professor', exigirLogin, exigirGestao, rota(async (req, res) => {
  const { nome, materia } = req.body || {};
  if (!nome || !String(nome).trim()) return res.status(400).json({ erro: 'Informe o nome do(a) professor(a).' });

  const existe = await get('SELECT id FROM usuarios WHERE nome=?', [String(nome).trim()]);
  if (existe) return res.status(409).json({ erro: 'Já existe um(a) professor(a) cadastrado(a) com esse nome.' });

  const senhaTemp = gerarSenhaTemporaria();
  await run(
    'INSERT INTO usuarios (nome, email, senha_hash, perfil, materia, cargo) VALUES (?, ?, ?, ?, ?, ?)',
    [String(nome).trim(), null, bcrypt.hashSync(senhaTemp, 10), 'professor', (materia || '').trim() || null, null]
  );
  await notificarGestao(`👤 Novo(a) professor(a) cadastrado(a): ${String(nome).trim()}.`);
  res.json({ ok: true, senhaTemp });
}));

// Resetar a senha de qualquer usuário (iniciado pela gestão, sem pedido prévio)
app.post('/api/usuarios/:id/resetar-senha', exigirLogin, exigirGestao, rota(async (req, res) => {
  const usuario = await get('SELECT * FROM usuarios WHERE id=?', [req.params.id]);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  const senhaTemp = gerarSenhaTemporaria();
  await run('UPDATE usuarios SET senha_hash=?, troca_senha=1 WHERE id=?',
    [bcrypt.hashSync(senhaTemp, 10), usuario.id]);
  res.json({ ok: true, nome: usuario.nome, senhaTemp });
}));

// Ativar/desativar conta (bloqueia login sem apagar o histórico)
app.post('/api/usuarios/:id/alternar-ativo', exigirLogin, exigirGestao, rota(async (req, res) => {
  const usuario = await get('SELECT * FROM usuarios WHERE id=?', [req.params.id]);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (usuario.id === req.usuario.id) return res.status(400).json({ erro: 'Você não pode desativar a própria conta.' });
  await run('UPDATE usuarios SET ativo=? WHERE id=?', [usuario.ativo ? 0 : 1, usuario.id]);
  res.json({ ok: true, ativo: !usuario.ativo });
}));

// ---------- Estações ----------
app.get('/api/estacoes', exigirLogin, rota(async (req, res) => {
  const linhas = await all(`
    SELECT e.*, u.nome AS professor_nome
    FROM estacoes e LEFT JOIN usuarios u ON u.id = e.professor_id
    ORDER BY e.id
  `);

  // Reservas da grade que valem "agora" (dia da semana de hoje + aula do horário atual).
  // Serve pra mostrar a estação como "Em uso" pelo professor que a reservou,
  // mesmo que ele ainda não tenha feito a retirada física.
  const diaAgora = DIA_SEMANA_POR_INDICE[new Date().getDay()];
  const periodoAgora = periodoAtual();
  const reservasAgora = {};
  if (periodoAgora && diaAgora !== 'sabado' && diaAgora !== 'domingo') {
    const hoje = hojeISO();
    const linhasReserva = await all(`
      SELECT ag.recurso, u.nome AS professor_nome, ag.turma
      FROM agendamentos ag JOIN usuarios u ON u.id = ag.usuario_id
      WHERE ag.status='confirmado' AND ag.dia_semana=? AND ag.periodo_id=?
        AND ag.data_inicio <= ? AND ag.data_fim >= ?
    `, [diaAgora, periodoAgora.id, hoje, hoje]);
    for (const r of linhasReserva) reservasAgora[r.recurso] = r;
  }
  const reservaDe = e => {
    if (e.em_uso) return null; // já em uso de verdade — não precisa do aviso de reserva
    const r = reservasAgora['estacao_' + e.id];
    return r ? { professorNome: r.professor_nome, turma: r.turma } : null;
  };

  if (req.usuario.perfil === 'gestao') {
    return res.json(linhas.map(e => ({
      id: e.id, capacidade: e.capacidade, qtd: e.qtd,
      emUso: !!e.em_uso, divergencia: !!e.divergencia,
      local: e.local, professorNome: e.professor_nome, sala: e.sala,
      tipo: e.tipo, marca: e.marca, reservadaAgora: reservaDe(e),
    })));
  }
  // Professor: SEM qtd real e SEM divergência — o servidor não envia esses campos
  res.json(linhas.map(e => ({
    id: e.id, capacidade: e.capacidade,
    emUso: !!e.em_uso, local: e.local,
    professorNome: e.professor_nome,
    minha: e.professor_id === req.usuario.id,
    tipo: e.tipo, marca: e.marca, reservadaAgora: reservaDe(e),
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

// Criar uma nova estação móvel (ex.: Estação D). O id vira uma letra/código
// curto; a partir daí ela passa a existir também como recurso agendável.
app.post('/api/estacoes', exigirLogin, exigirGestao, rota(async (req, res) => {
  const idBruto = String(req.body?.id || '').trim().toUpperCase();
  const capacidade = Number(req.body?.capacidade);
  const local = String(req.body?.local || '').trim() || LOCAL_PADRAO;
  const tipo = req.body?.tipo === 'tablet' ? 'tablet' : 'notebook';
  const marca = String(req.body?.marca || '').trim() || 'TES Guardian';

  if (!idBruto || !/^[A-Z0-9]{1,10}$/.test(idBruto)) {
    return res.status(400).json({ erro: 'Use um identificador curto (ex.: D), só letras/números, sem espaços.' });
  }
  if (!Number.isInteger(capacidade) || capacidade < 1) {
    return res.status(400).json({ erro: `Informe a capacidade (quantidade de ${tipo === 'tablet' ? 'tablets' : 'notebooks'}) da nova estação.` });
  }
  const existe = await get('SELECT id FROM estacoes WHERE id=?', [idBruto]);
  if (existe) return res.status(409).json({ erro: `Já existe uma Estação ${idBruto}.` });

  await run('INSERT INTO estacoes (id, capacidade, qtd, local, tipo, marca) VALUES (?, ?, ?, ?, ?, ?)',
    [idBruto, capacidade, capacidade, local, tipo, marca]);
  await notificarGestao(`🆕 Nova estação criada: Estação ${idBruto} (${tipo === 'tablet' ? 'tablets' : 'notebooks'}, capacidade ${capacidade}).`);
  res.json({ ok: true, id: idBruto });
}));

// Edição direta de capacidade/quantidade pela gestão (fora do fluxo de divergência)
app.put('/api/estacoes/:id', exigirLogin, exigirGestao, rota(async (req, res) => {
  const e = await get('SELECT * FROM estacoes WHERE id=?', [req.params.id]);
  if (!e) return res.status(404).json({ erro: 'Estação não encontrada.' });
  if (e.em_uso) return res.status(409).json({ erro: 'Não é possível editar uma estação em uso. Aguarde a devolução.' });

  const capacidade = Number(req.body?.capacidade);
  const qtd = Number(req.body?.qtd);
  if (!Number.isInteger(capacidade) || capacidade < 1) {
    return res.status(400).json({ erro: 'Capacidade deve ser um número inteiro maior que zero.' });
  }
  if (!Number.isInteger(qtd) || qtd < 0 || qtd > capacidade) {
    return res.status(400).json({ erro: `Quantidade deve ser um número inteiro entre 0 e ${capacidade}.` });
  }
  await run('UPDATE estacoes SET capacidade=?, qtd=?, divergencia=0 WHERE id=?', [capacidade, qtd, e.id]);
  await notificarGestao(`Estação ${e.id} — capacidade/quantidade ajustadas manualmente pela gestão para ${qtd}/${capacidade}.`);
  res.json({ ok: true });
}));

// Importação de planilha (CSV colado como texto): id,capacidade,qtd
// Ex.:
//   id,capacidade,qtd
//   A,32,30
//   B,32,32
//   C,30,28
app.post('/api/estacoes/importar', exigirLogin, exigirGestao, rota(async (req, res) => {
  const csv = String(req.body?.csv || '').trim();
  if (!csv) return res.status(400).json({ erro: 'Cole o conteúdo da planilha (CSV) no campo indicado.' });

  const linhas = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (linhas[0] && /^id[,;]/i.test(linhas[0])) linhas.shift(); // remove cabeçalho, se houver

  const atualizadas = [];
  const ignoradas = [];
  for (const linha of linhas) {
    const [idBruto, capBruta, qtdBruta] = linha.split(/[,;]/).map(v => (v || '').trim());
    const id = (idBruto || '').toUpperCase();
    const capacidade = Number(capBruta);
    const qtd = Number(qtdBruta);
    const estacao = await get('SELECT * FROM estacoes WHERE id=?', [id]);
    if (!estacao) { ignoradas.push(`${linha} (estação "${id}" não existe)`); continue; }
    if (estacao.em_uso) { ignoradas.push(`${linha} (Estação ${id} está em uso — pulei)`); continue; }
    if (!Number.isInteger(capacidade) || capacidade < 1 || !Number.isInteger(qtd) || qtd < 0 || qtd > capacidade) {
      ignoradas.push(`${linha} (capacidade/quantidade inválidas)`); continue;
    }
    await run('UPDATE estacoes SET capacidade=?, qtd=?, divergencia=0 WHERE id=?', [capacidade, qtd, id]);
    atualizadas.push(id);
  }
  if (atualizadas.length) {
    await notificarGestao(`Importação de planilha — estações atualizadas: ${atualizadas.join(', ')}.`);
  }
  res.json({ ok: true, atualizadas, ignoradas });
}));

// ---------- Relatórios ----------
app.get('/api/relatorios/uso-professores', exigirLogin, exigirGestao, rota(async (_req, res) => {
  const linhas = await all(`
    SELECT r.usuario_id, u.nome, r.estacao_id, COUNT(*) AS qtd
    FROM registros r JOIN usuarios u ON u.id = r.usuario_id
    GROUP BY r.usuario_id, u.nome, r.estacao_id
    ORDER BY u.nome
  `);
  const porProfessor = new Map();
  for (const l of linhas) {
    if (!porProfessor.has(l.usuario_id)) {
      porProfessor.set(l.usuario_id, { professorId: l.usuario_id, nome: l.nome, total: 0, porEstacao: {} });
    }
    const p = porProfessor.get(l.usuario_id);
    p.porEstacao[l.estacao_id] = Number(l.qtd);
    p.total += Number(l.qtd);
  }
  const resultado = [...porProfessor.values()].map(p => {
    let estacaoMaisUsada = null, max = -1;
    for (const [est, n] of Object.entries(p.porEstacao)) if (n > max) { max = n; estacaoMaisUsada = est; }
    return { ...p, estacaoMaisUsada };
  }).sort((a, b) => b.total - a.total);
  res.json(resultado);
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

// Limpa os alertas (notificações) — ação irreversível, só gestão.
// Também tira a bandeira de "Divergência" das estações: sem o alerta que
// explicava o motivo, não faz sentido a estação continuar presa nesse status.
app.delete('/api/notificacoes', exigirLogin, exigirGestao, rota(async (_req, res) => {
  await run('DELETE FROM notificacoes');
  await run('UPDATE estacoes SET divergencia=0');
  res.json({ ok: true });
}));

// Limpa o histórico de retiradas/devoluções — ação irreversível, só gestão.
// Também tira a bandeira de "Divergência", pelo mesmo motivo acima.
// Não afeta em_uso/quantidade — só o log e o status de divergência.
app.delete('/api/registros', exigirLogin, exigirGestao, rota(async (_req, res) => {
  await run('DELETE FROM registros');
  await run('UPDATE estacoes SET divergencia=0');
  res.json({ ok: true });
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

// ---------- Agendamentos: dia único, semana fixa ou mês inteiro ----------
// Cada reserva tem uma "vigência" (data_inicio..data_fim) que define quando
// ela vale de fato: um dia específico, indefinidamente (toda semana) ou só
// dentro de um mês. Duas reservas do mesmo recurso/dia/aula só conflitam se
// as vigências se sobrepõem — assim dá pra reservar "1º de outubro" mesmo
// que outro professor já tenha a "sexta-feira" fixa em outro mês, por ex.

app.get('/api/agendamentos', exigirLogin, rota(async (req, res) => {
  const { recurso } = req.query;
  const condicoes = ["a.status='confirmado'", 'a.data_fim >= ?'];
  const params = [hojeISO()];
  if (recurso) { condicoes.push('a.recurso=?'); params.push(recurso); }
  const linhas = await all(`
    SELECT a.*, u.nome AS professor_nome
    FROM agendamentos a JOIN usuarios u ON u.id = a.usuario_id
    WHERE ${condicoes.join(' AND ')}
  `, params);
  res.json(linhas.map(a => ({
    id: a.id, recurso: a.recurso, tipo: a.tipo, diaSemana: a.dia_semana, periodoId: a.periodo_id,
    mes: a.mes, dataInicio: a.data_inicio, dataFim: a.data_fim,
    turma: a.turma, observacao: a.observacao,
    professorNome: a.professor_nome, minha: a.usuario_id === req.usuario.id,
  })));
}));

app.post('/api/agendamentos', exigirLogin, rota(async (req, res) => {
  const { recurso, tipo, diaSemana, periodoId, data, mes, turma, observacao } = req.body || {};
  const recursos = await montarRecursos();
  if (!recursos.some(r => r.id === recurso)) return res.status(400).json({ erro: 'Selecione o que deseja agendar.' });
  if (!PERIODOS.some(p => p.id === periodoId)) return res.status(400).json({ erro: 'Selecione a aula/horário.' });
  if (!['dia', 'semana', 'mes'].includes(tipo)) return res.status(400).json({ erro: 'Selecione o tipo de reserva: dia, semana ou mês.' });

  let diaSemanaFinal, dataInicio, dataFim, mesFinal = null;

  if (tipo === 'dia') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) return res.status(400).json({ erro: 'Selecione uma data válida.' });
    if (data < hojeISO()) return res.status(400).json({ erro: 'Não é possível reservar uma data passada.' });
    diaSemanaFinal = diaSemanaDeData(data);
    if (diaSemanaFinal === 'sabado' || diaSemanaFinal === 'domingo') {
      return res.status(400).json({ erro: 'Não é possível reservar sábado ou domingo — não há aula nesses dias.' });
    }
    dataInicio = data; dataFim = data;
  } else if (tipo === 'mes') {
    if (!/^\d{4}-\d{2}$/.test(mes || '')) return res.status(400).json({ erro: 'Selecione o mês.' });
    if (!DIAS_SEMANA.some(d => d.id === diaSemana)) return res.status(400).json({ erro: 'Selecione o dia da semana.' });
    diaSemanaFinal = diaSemana;
    mesFinal = mes;
    ({ inicio: dataInicio, fim: dataFim } = limitesMes(mes));
    if (dataFim < hojeISO()) return res.status(400).json({ erro: 'Selecione um mês atual ou futuro.' });
  } else {
    if (!DIAS_SEMANA.some(d => d.id === diaSemana)) return res.status(400).json({ erro: 'Selecione o dia da semana.' });
    diaSemanaFinal = diaSemana;
    dataInicio = hojeISO();
    dataFim = DATA_FIM_INDEFINIDA;
  }

  if (recurso === 'sala_informatica' && !turma) {
    return res.status(400).json({ erro: 'Informe a turma que usará a Sala de Informática.' });
  }

  const conflito = await get(`
    SELECT a.id, u.nome FROM agendamentos a JOIN usuarios u ON u.id = a.usuario_id
    WHERE a.recurso=? AND a.dia_semana=? AND a.periodo_id=? AND a.status='confirmado'
      AND a.data_inicio <= ? AND a.data_fim >= ?
  `, [recurso, diaSemanaFinal, periodoId, dataFim, dataInicio]);
  if (conflito) {
    return res.status(409).json({ erro: `Esse horário já está reservado por Prof. ${conflito.nome} nesse período. Escolha outro horário.` });
  }

  await run(
    `INSERT INTO agendamentos (usuario_id, recurso, tipo, dia_semana, periodo_id, mes, data_inicio, data_fim, turma, observacao, status, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'confirmado', ?)`,
    [req.usuario.id, recurso, tipo, diaSemanaFinal, periodoId, mesFinal, dataInicio, dataFim, turma || null, observacao || null, agora()]
  );

  const mensagem = tipo === 'dia' ? 'Reserva confirmada para essa data.'
    : tipo === 'mes' ? 'Reserva confirmada para todo o mês selecionado.'
    : 'Horário reservado — vale para todas as semanas, até você cancelar.';
  res.json({ ok: true, mensagem });
}));

app.post('/api/agendamentos/:id/cancelar', exigirLogin, rota(async (req, res) => {
  const ag = await get('SELECT * FROM agendamentos WHERE id=?', [req.params.id]);
  if (!ag) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  if (ag.usuario_id !== req.usuario.id && req.usuario.perfil !== 'gestao') {
    return res.status(403).json({ erro: 'Você só pode cancelar os próprios agendamentos.' });
  }
  await run("UPDATE agendamentos SET status='cancelado' WHERE id=?", [ag.id]);
  res.json({ ok: true });
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
