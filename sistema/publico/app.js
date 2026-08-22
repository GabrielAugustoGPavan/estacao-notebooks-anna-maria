/* ================= ESTADO / API ================= */
let token = localStorage.getItem('token') || null;
let usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
let perfilLogin = 'professor';
let perfilRecuperacao = 'professor';
let estacoes = [], salas = [], recursos = [], cargos = [], periodos = [], diasSemana = [];
let estacaoAtiva = null, modoModal = 'retirada', atualizador = null, abaAtual = 'estacoes';
let recursoAgendaGestao = 'sala_informatica', recursoAgendaEstacoesProf = 'estacao_A', agendaCelulaAtiva = null;

async function api(caminho, corpo, metodo){
  const opts = { headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  if (corpo) { opts.method = metodo || 'POST'; opts.body = JSON.stringify(corpo); }
  else if (metodo) { opts.method = metodo; }
  const resp = await fetch('/api' + caminho, opts);
  const dados = await resp.json().catch(() => ({}));
  if (resp.status === 401 && caminho !== '/login') { sair(); throw new Error(dados.erro || 'Sessão expirada.'); }
  if (!resp.ok) throw new Error(dados.erro || 'Erro no servidor.');
  return dados;
}

function hora(iso){
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  const hm = String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  return hoje ? hm : d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})+' '+hm;
}
function dataBr(iso){
  const [a,m,d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/* ================= GABINETE DE RECARGA (SVG) — cor/marca variam por estação ================= */
function svgGabinete(e, visaoGestao){
  const marca = e.marca || 'TES Guardian';
  // Paleta clara (TES Guardian) vs. cinza-escuro (JEYTECH)
  const paleta = marca === 'JEYTECH'
    ? { corpo:'#5a5d62', borda:'#3d3f43', painel:'#65686d', divisor:'#4a4d51',
        porta:'#61646a', portaBorda:'#3d3f43', furo:'#2e3033', pe:'#45474b', peBorda:'#303234' }
    : { corpo:'#d9dcdf', borda:'#b9bec3', painel:'#e8eaec', divisor:'#c2c7cb',
        porta:'#dfe2e5', portaBorda:'#b9bec3', furo:'#9aa0a6', pe:'#a7abaf', peBorda:'#7d8288' };
  const corTexto = marca === 'JEYTECH' ? '#f2f3f4' : '#e8eaee';

  let slots = '';
  const total = 32;
  const cheios = visaoGestao ? Math.round(e.qtd/e.capacidade*total) : 0;
  for(let i=0;i<total;i++){
    const prat = Math.floor(i/16), pos = i%16;
    let classe;
    if(!visaoGestao) classe = 'slot neutro';   // professor não vê a contagem real
    else classe = i < cheios ? (e.emUso ? 'slot cheio' : 'slot cheio carregando') : 'slot vazio';
    slots += `<rect class="${classe}" x="${40+pos*7.2}" y="${prat===0?46:96}" width="4.2" height="34" rx="1"/>`;
  }
  const corLed = visaoGestao && e.divergencia ? 'var(--vermelho)'
               : e.emUso ? 'var(--amarelo)' : 'var(--verde)';
  function furos(x0){
    let f='';
    for(const y0 of [52,92,132])
      for(let l=0;l<4;l++) for(let c=0;c<5;c++)
        f += `<circle cx="${x0+c*7}" cy="${y0+l*6}" r="1.4" fill="${paleta.furo}"/>`;
    return f;
  }
  return `
  <svg class="gabinete" viewBox="-30 0 250 210">
    <rect x="20" y="26" width="150" height="158" rx="4" fill="${paleta.corpo}" stroke="${paleta.borda}" stroke-width="2"/>
    <rect x="28" y="34" width="134" height="144" fill="${paleta.painel}"/>
    <rect x="28" y="82" width="134" height="6" fill="${paleta.divisor}"/>
    <rect x="28" y="132" width="134" height="6" fill="${paleta.divisor}"/>
    ${slots}
    <rect x="28" y="170" width="134" height="8" fill="${paleta.divisor}"/>
    <rect x="12" y="12" width="166" height="16" rx="3" fill="#4a4d52"/>
    <rect x="12" y="12" width="166" height="5" rx="3" fill="#5b5e64"/>
    <circle class="led" cx="170" cy="20" r="4" fill="${corLed}"/>
    <text x="22" y="23" font-size="8" fill="${corTexto}" font-family="sans-serif" font-weight="bold">${marca.toUpperCase()}</text>
    <g class="porta-esq">
      <rect x="20" y="30" width="73" height="152" rx="3" fill="${paleta.porta}" stroke="${paleta.portaBorda}" stroke-width="2"/>
      ${furos(36)}
    </g>
    <g class="porta-dir">
      <rect x="97" y="30" width="73" height="152" rx="3" fill="${paleta.porta}" stroke="${paleta.portaBorda}" stroke-width="2"/>
      ${furos(113)}
      <circle cx="160" cy="106" r="6" fill="${paleta.pe}" stroke="${paleta.peBorda}" stroke-width="1.5"/>
      <rect x="158.6" y="102" width="2.8" height="8" rx="1.2" fill="${paleta.peBorda}"/>
    </g>
    <g fill="${paleta.peBorda}">
      <rect x="30" y="184" width="10" height="8" rx="2"/>
      <rect x="150" y="184" width="10" height="8" rx="2"/>
    </g>
    <circle cx="35" cy="197" r="8" fill="${paleta.pe}" stroke="${paleta.peBorda}" stroke-width="2"/>
    <circle cx="155" cy="197" r="8" fill="${paleta.pe}" stroke="${paleta.peBorda}" stroke-width="2"/>
    <circle cx="35" cy="197" r="2.5" fill="${paleta.peBorda}"/>
    <circle cx="155" cy="197" r="2.5" fill="${paleta.peBorda}"/>
  </svg>`;
}

/* ================= ABAS (gestão) ================= */
function mudarAba(aba){
  abaAtual = aba;
  ['estacoes','agendamentos','contas','admin'].forEach(a=>{
    document.getElementById('sec'+a.charAt(0).toUpperCase()+a.slice(1)).classList.toggle('oculto', a!==aba);
  });
  [...document.getElementById('abas').children].forEach(b=>b.classList.remove('ativo'));
  const idx = {estacoes:0,agendamentos:1,contas:2,admin:3}[aba];
  document.getElementById('abas').children[idx].classList.add('ativo');
  document.getElementById('btnVoltarEstacoes').classList.add('oculto');
  document.getElementById('btnVoltarAgenda').classList.add('oculto');
  document.getElementById('blocoAgendaEstacoesProfessor').classList.add('oculto');
  if(aba==='agendamentos') mostrarAgendamentosGestao().catch(err=>toast('⚠ '+err.message));
  if(aba==='contas') carregarContas().catch(err=>toast('⚠ '+err.message));
  if(aba==='admin') carregarAdminEstacoes().catch(err=>toast('⚠ '+err.message));
}

/* ================= PAINEL: ESTAÇÕES ================= */
async function carregarPainel(){
  const gestao = usuario.perfil === 'gestao';
  estacoes = await api('/estacoes');
  const grade = document.getElementById('gradeEstacoes');
  const minha = !gestao ? estacoes.find(x=>x.minha) : null;

  grade.innerHTML = estacoes.map(e=>{
    const aparelho = e.tipo === 'tablet' ? 'tablets' : 'notebooks';
    let badge;
    if(gestao && e.divergencia) badge = '<span class="badge divergencia">Divergência</span>';
    else if(e.emUso)            badge = `<span class="badge em-uso">Em uso · Prof. ${e.professorNome}</span>`;
    else if(e.reservadaAgora)   badge = `<span class="badge em-uso">Em uso · Prof. ${e.reservadaAgora.professorNome} (reservado)</span>`;
    else                        badge = '<span class="badge disponivel">Disponível</span>';

    const contagem = gestao
      ? `<div class="contagem"><b>${e.qtd}</b> / ${e.capacidade} ${aparelho}</div>`
      : `<div class="contagem">Capacidade: <b>${e.capacidade}</b> ${aparelho}</div>`;

    let botao='';
    if(gestao){
      botao = `<button class="btn secundario" onclick="detalhes('${e.id}')">Ver detalhes</button>`;
    } else if(e.minha){
      botao = `<button class="btn" onclick="abrirModal('${e.id}','devolucao')">Registrar devolução</button>`;
    } else if(e.emUso){
      botao = `<button class="btn secundario" disabled>Em uso — Prof. ${e.professorNome}</button>`;
    } else if(minha){
      botao = `<button class="btn secundario" disabled>Retirar estação</button>
               <div class="aviso-bloqueio">⚠ Devolva primeiro a Estação ${minha.id} para retirar outra.</div>`;
    } else if(e.reservadaAgora){
      botao = `<button class="btn" onclick="abrirModal('${e.id}','retirada')">Retirar estação</button>
               <div class="aviso-bloqueio">🗓 Reservada agora por Prof. ${e.reservadaAgora.professorNome}${e.reservadaAgora.turma?' ('+e.reservadaAgora.turma+')':''}.</div>`;
    } else {
      botao = `<button class="btn" onclick="abrirModal('${e.id}','retirada')">Retirar estação</button>`;
    }

    return `
    <div class="cartao ${e.emUso?'aberto':''}" id="cartao-${e.id}">
      <h3>Estação ${e.id}</h3>
      <div class="local">📍 Localização atual: <b>${e.local}</b></div>
      ${badge}
      ${svgGabinete(e, gestao)}
      ${contagem}
      ${botao}
    </div>`;
  }).join('');

  if(gestao){ await carregarGestao(); }
}

async function carregarGestao(){
  const [notifs, regs] = await Promise.all([api('/notificacoes'), api('/registros')]);
  document.getElementById('listaNotificacoes').innerHTML = notifs.length
    ? notifs.map(n=>`<div class="notificacao"><span class="hora">${hora(n.criada_em)}</span><span>⚠ ${n.texto}</span></div>`).join('')
    : '<div class="sem-notificacao">Nenhuma divergência ou observação registrada. ✅</div>';

  document.getElementById('corpoHistorico').innerHTML = regs.map(r=>{
    let situacao;
    if(r.qtd_dev===null)           situacao = '<td>⏳ Em aula</td>';
    else if(r.qtd_dev===r.qtd_ret) situacao = '<td class="ok">✔ OK</td>';
    else if(r.qtd_dev<r.qtd_ret)   situacao = `<td class="falta">⚠ Falta ${r.qtd_ret-r.qtd_dev}</td>`;
    else                           situacao = `<td class="falta">⚠ Sobra ${r.qtd_dev-r.qtd_ret}</td>`;
    return `<tr>
      <td>Prof. ${r.professor_nome}</td><td>${r.estacao_id}</td>
      <td>${r.sala}${r.obs?'<br><small style="color:#9c7400">📝 '+r.obs+'</small>':''}</td>
      <td>${r.qtd_ret} · ${hora(r.data_ret)}</td>
      <td>${r.qtd_dev===null?'—':r.qtd_dev+' · '+hora(r.data_dev)}</td>
      ${situacao}
    </tr>`;
  }).join('') || '<tr><td colspan="6">Nenhum registro ainda.</td></tr>';
}

/* ================= DETALHES / DIVERGÊNCIA (gestão) ================= */
function detalhes(id){
  const e = estacoes.find(x=>x.id===id);
  document.getElementById('tituloDetalhes').textContent = 'Estação '+e.id;
  document.getElementById('corpoDetalhes').innerHTML =
    `📍 <b>Localização:</b> ${e.local}<br>`
    + `💻 <b>Notebooks:</b> ${e.qtd} / ${e.capacidade}<br>`
    + (e.emUso ? `🧑‍🏫 <b>Em uso por:</b> Prof. ${e.professorNome} (${e.sala})<br>` : '✅ Disponível na Sala de Informática<br>')
    + (e.divergencia ? '<span style="color:var(--vermelho)">⚠ <b>Há divergência de contagem registrada.</b></span>' : '');
  document.getElementById('areaResolver').classList.toggle('oculto', !e.divergencia);
  document.getElementById('inpQtdConferida').value = '';
  estacaoAtiva = e;
  document.getElementById('sombraDetalhes').classList.add('visivel');
}
function fecharDetalhes(){ document.getElementById('sombraDetalhes').classList.remove('visivel'); }

async function resolverDivergencia(){
  try{
    const qtd = Number(document.getElementById('inpQtdConferida').value);
    await api(`/estacoes/${estacaoAtiva.id}/resolver-divergencia`, { qtd });
    fecharDetalhes(); toast('✅ Divergência encerrada.');
    await carregarPainel();
  }catch(err){ toast('⚠ '+err.message); }
}

async function limparNotificacoes(){
  if(!confirm('Apagar todos os alertas e observações? Isso também tira a marcação de "Divergência" das estações. Essa ação não pode ser desfeita.')) return;
  try{
    await api('/notificacoes', {}, 'DELETE');
    toast('Alertas apagados.');
    await carregarPainel();
  }catch(err){ toast('⚠ '+err.message); }
}

async function limparHistorico(){
  if(!confirm('Apagar todo o histórico de retiradas/devoluções? Isso também tira a marcação de "Divergência" das estações. Essa ação não pode ser desfeita.')) return;
  try{
    await api('/registros', {}, 'DELETE');
    toast('Histórico apagado.');
    await carregarPainel();
  }catch(err){ toast('⚠ '+err.message); }
}

/* ================= AGENDAMENTOS: grade semanal fixa ================= */
function nomeRecurso(id){ return (recursos.find(r=>r.id===id)||{}).nome || id; }

function botaoRecurso(r, atual, onclickFn){
  return `<button class="${r.id===atual?'ativo':''}" onclick="${onclickFn}('${r.id}')">${r.nome}</button>`;
}

function montarHtmlGrade(lista, recurso){
  const mapa = {};
  lista.forEach(a=>{
    const chave = a.diaSemana+'|'+a.periodoId;
    (mapa[chave] = mapa[chave] || []).push(a);
  });
  const hoje = new Date().toISOString().slice(0,10);
  // Quando há mais de uma reserva pra mesma célula (ex.: "toda semana" +
  // uma exceção de "só um dia" que não se sobrepõe), mostra a que vale hoje;
  // se nenhuma vale hoje ainda, mostra a próxima que vai valer.
  function escolher(lista){
    if(lista.length===1) return lista[0];
    const vigenteHoje = lista.find(a=>a.dataInicio<=hoje && a.dataFim>=hoje);
    if(vigenteHoje) return vigenteHoje;
    return [...lista].sort((a,b)=>a.dataInicio.localeCompare(b.dataInicio))[0];
  }
  function rotuloTipo(a){
    if(a.tipo==='dia') return `<span class="tag-tipo-agenda">📅 ${dataBr(a.dataInicio)}</span>`;
    if(a.tipo==='mes') return `<span class="tag-tipo-agenda">🗓 ${a.mes}</span>`;
    return '';
  }

  let linhas = '<tr><th></th>' + diasSemana.map(d=>`<th>${d.nome.replace('-feira','')}</th>`).join('') + '</tr>';
  let turnoAnterior = null;
  periodos.forEach(p=>{
    if(p.turno !== turnoAnterior){
      linhas += `<tr class="turno-divisor"><td colspan="${diasSemana.length+1}">${p.turno}</td></tr>`;
      turnoAnterior = p.turno;
    }
    linhas += `<tr><td class="rotulo-periodo">${p.rotulo}<small>${p.inicio}–${p.fim}</small></td>`;
    diasSemana.forEach(d=>{
      const lista2 = mapa[d.id+'|'+p.id];
      if(lista2){
        const ag = escolher(lista2);
        const podeCancelar = ag.minha || usuario.perfil==='gestao';
        linhas += `<td class="cel-agenda cel-ocupada ${ag.minha?'minha':''}">`
          + rotuloTipo(ag)
          + `${ag.turma?ag.turma+'<br>':''}<small>Prof. ${ag.professorNome}</small>`
          + (podeCancelar ? ` <span class="cel-x" title="Cancelar reserva" onclick="cancelarAgendaCelula(${ag.id})">✕</span>` : '')
          + `</td>`;
      } else {
        linhas += `<td class="cel-agenda cel-livre" title="Reservar" onclick="abrirAgendaCelula('${recurso}','${d.id}','${p.id}')">+</td>`;
      }
    });
    linhas += '</tr>';
  });
  return linhas;
}

async function carregarGradeEm(tabelaId, recurso){
  const lista = await api('/agendamentos?recurso='+encodeURIComponent(recurso));
  document.getElementById(tabelaId).innerHTML = montarHtmlGrade(lista, recurso);
}

/* ---- Grade dentro da aba "Agendamentos" da gestão (todos os recursos) ---- */
async function mostrarAgendamentosGestao(){
  document.getElementById('tituloAgendaSecao').textContent = '🗓 Grade semanal de agendamentos';
  document.getElementById('seletorRecursoAgenda').classList.remove('oculto');
  await selecionarRecursoAgendaGestao(recursoAgendaGestao);
}
async function selecionarRecursoAgendaGestao(id){
  recursoAgendaGestao = id;
  document.getElementById('seletorRecursoAgenda').innerHTML =
    recursos.map(r=>botaoRecurso(r, id, 'selecionarRecursoAgendaGestao')).join('');
  await carregarGradeEm('tabelaAgenda', id);
}

/* ---- Grade dentro da opção "Agendamento da Sala de Informática" (professor) ---- */
function abrirAgendaSalaProfessor(){
  abaAtual = 'agenda-sala';
  document.getElementById('homeProfessor').classList.add('oculto');
  document.getElementById('secEstacoes').classList.add('oculto');
  document.getElementById('secAgendamentos').classList.remove('oculto');
  document.getElementById('btnVoltarAgenda').classList.remove('oculto');
  document.getElementById('seletorRecursoAgenda').classList.add('oculto');
  document.getElementById('tituloAgendaSecao').textContent = '🗓 Agendamento da Sala de Informática';
  document.getElementById('subPainel').textContent = 'Clique num horário livre — a reserva vale toda semana, até você cancelar.';
  carregarGradeEm('tabelaAgenda', 'sala_informatica').catch(err=>toast('⚠ '+err.message));
}

/* ---- Grade dentro da opção "Estações de Notebooks e Tablet" (professor) ---- */
async function selecionarRecursoEstacoesProf(id){
  recursoAgendaEstacoesProf = id;
  document.getElementById('seletorRecursoEstacoesProf').innerHTML =
    recursos.filter(r=>r.id!=='sala_informatica').map(r=>botaoRecurso(r, id, 'selecionarRecursoEstacoesProf')).join('');
  await carregarGradeEm('tabelaAgendaEstacoesProfessor', id);
}

/* ---- Reservar/cancelar uma célula da grade ---- */
const MAPA_DIA_INDICE = { segunda:1, terca:2, quarta:3, quinta:4, sexta:5 };
function proximaDataParaDia(diaSemanaId){
  const alvo = MAPA_DIA_INDICE[diaSemanaId];
  const hoje = new Date();
  const diff = (alvo - hoje.getDay() + 7) % 7;
  const data = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + diff);
  return data.toISOString().slice(0,10);
}

let agendaTipoAtual = 'semana';

function abrirAgendaCelula(recurso, dia, periodoId){
  const p = periodos.find(x=>x.id===periodoId);
  const d = diasSemana.find(x=>x.id===dia);
  agendaCelulaAtiva = { recurso, dia, periodoId };
  document.getElementById('tituloAgendaCelula').textContent = `Reservar — ${d.nome}, ${p.rotulo}`;
  document.getElementById('subAgendaCelula').textContent = `${nomeRecurso(recurso)} · ${p.inicio}–${p.fim}`;
  document.getElementById('campoTurmaAgenda2').style.display = recurso==='sala_informatica' ? 'block' : 'none';
  document.getElementById('inpTurmaAgenda2').value='';
  document.getElementById('inpObsAgenda2').value='';
  document.getElementById('erroAgendaCelula').classList.remove('visivel');

  // Data padrão pro tipo "só um dia": a próxima ocorrência desse dia da semana.
  // step=7 trava o seletor nativo pra só aceitar datas nesse mesmo dia da semana.
  const proxima = proximaDataParaDia(dia);
  const inpData = document.getElementById('inpDataAgenda2');
  inpData.min = proxima; inpData.value = proxima; inpData.step = 7;
  document.getElementById('rotuloDataAgenda2').textContent = `Data (só ${d.nome})`;

  const inpMes = document.getElementById('inpMesAgenda2');
  inpMes.min = new Date().toISOString().slice(0,7);
  inpMes.value = new Date().toISOString().slice(0,7);

  escolherTipoAgenda('semana');
  document.getElementById('sombraAgendaCelula').classList.add('visivel');
}
function fecharAgendaCelula(){ document.getElementById('sombraAgendaCelula').classList.remove('visivel'); }

function escolherTipoAgenda(tipo){
  agendaTipoAtual = tipo;
  [...document.getElementById('seletorTipoAgenda').children].forEach(b=>b.classList.toggle('ativo', b.dataset.tipo===tipo));
  document.getElementById('campoDataAgenda2').style.display = tipo==='dia' ? 'block' : 'none';
  document.getElementById('campoMesAgenda2').style.display = tipo==='mes' ? 'block' : 'none';
}

async function confirmarAgendaCelula(){
  const erro = document.getElementById('erroAgendaCelula');
  erro.classList.remove('visivel');
  try{
    await api('/agendamentos', {
      recurso: agendaCelulaAtiva.recurso,
      tipo: agendaTipoAtual,
      diaSemana: agendaTipoAtual === 'dia' ? undefined : agendaCelulaAtiva.dia,
      periodoId: agendaCelulaAtiva.periodoId,
      data: agendaTipoAtual === 'dia' ? document.getElementById('inpDataAgenda2').value : undefined,
      mes: agendaTipoAtual === 'mes' ? document.getElementById('inpMesAgenda2').value : undefined,
      turma: document.getElementById('inpTurmaAgenda2').value.trim() || undefined,
      observacao: document.getElementById('inpObsAgenda2').value.trim() || undefined,
    });
    fecharAgendaCelula();
    toast('✅ Reserva confirmada.');
    await recarregarGradeAtual();
  }catch(err){ erro.textContent = err.message; erro.classList.add('visivel'); }
}


async function cancelarAgendaCelula(id){
  try{
    await api(`/agendamentos/${id}/cancelar`, {}, 'POST');
    toast('Reserva cancelada.');
    await recarregarGradeAtual();
  }catch(err){ toast('⚠ '+err.message); }
}

function recarregarGradeAtual(){
  if(abaAtual==='agendamentos') return carregarGradeEm('tabelaAgenda', recursoAgendaGestao);
  if(abaAtual==='agenda-sala') return carregarGradeEm('tabelaAgenda', 'sala_informatica');
  if(abaAtual==='estacoes-prof') return carregarGradeEm('tabelaAgendaEstacoesProfessor', recursoAgendaEstacoesProf);
  return Promise.resolve();
}

/* ---- Navegação da home do professor ---- */
function abrirEstacoesProfessor(){
  abaAtual = 'estacoes-prof';
  document.getElementById('homeProfessor').classList.add('oculto');
  document.getElementById('secAgendamentos').classList.add('oculto');
  document.getElementById('secEstacoes').classList.remove('oculto');
  document.getElementById('btnVoltarEstacoes').classList.remove('oculto');
  document.getElementById('blocoAgendaEstacoesProfessor').classList.remove('oculto');
  document.getElementById('subPainel').textContent = 'Use o botão de cada estação para registrar a retirada ou devolução dos notebooks/tablets.';
  carregarPainel().catch(err=>toast('⚠ '+err.message));
  selecionarRecursoEstacoesProf(recursoAgendaEstacoesProf).catch(err=>toast('⚠ '+err.message));
}

function voltarHomeProfessor(){
  abaAtual = 'home';
  document.getElementById('secAgendamentos').classList.add('oculto');
  document.getElementById('secEstacoes').classList.add('oculto');
  document.getElementById('homeProfessor').classList.remove('oculto');
  document.getElementById('subPainel').textContent = 'O que você deseja fazer?';
}

/* ================= CONTAS (gestão) ================= */
async function carregarContas(){
  if(!cargos.length){
    cargos = await api('/cargos');
    document.getElementById('selCargoAdmin').innerHTML = cargos.map(c=>`<option>${c}</option>`).join('');
  }
  const [usuarios, pedidos] = await Promise.all([api('/usuarios'), api('/redefinicoes-pendentes')]);

  document.getElementById('listaPedidosSenha').innerHTML = pedidos.length ? pedidos.map(p=>`
    <div class="notificacao" style="background:#fdf3d7; color:#7a5c00;">
      <span style="flex:1"><b>${p.nome}</b><br>${p.perfil==='gestao'?(p.cargo||'Gestão'):'Professor(a)'} · pedido em ${hora(p.criado_em)}</span>
      <button class="btn pequeno" onclick="atenderPedido(${p.id})">Gerar senha</button>
    </div>
  `).join('') : '<div class="sem-notificacao">Nenhum pedido pendente. ✅</div>';

  document.getElementById('corpoUsuarios').innerHTML = usuarios.map(u=>`
    <tr>
      <td>${u.nome}</td>
      <td>${u.perfil==='gestao' ? `<span class="tag-cargo">${u.cargo||'Gestão'}</span>` : 'Professor(a)'}</td>
      <td>${u.email||'—'}</td>
      <td>${u.ativo ? '✅ Ativo' : '<span class="tag-inativo">Inativo</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn secundario pequeno" onclick="resetarSenhaUsuario(${u.id},'${u.nome.replace(/'/g,"\\'")}')">Resetar senha</button>
        <button class="btn secundario pequeno" onclick="alternarAtivo(${u.id})">${u.ativo?'Desativar':'Ativar'}</button>
      </td>
    </tr>
  `).join('');
}

async function criarContaAdmin(){
  const erro = document.getElementById('erroContaAdmin');
  erro.classList.remove('visivel');
  document.getElementById('senhaGeradaAdmin').classList.add('oculto');
  try{
    const r = await api('/usuarios/admin', {
      nome: document.getElementById('inpNomeAdmin').value.trim(),
      email: document.getElementById('inpEmailAdmin').value.trim(),
      cargo: document.getElementById('selCargoAdmin').value,
    });
    document.getElementById('valorSenhaAdmin').textContent = r.senhaTemp;
    document.getElementById('senhaGeradaAdmin').classList.remove('oculto');
    document.getElementById('inpNomeAdmin').value='';
    document.getElementById('inpEmailAdmin').value='';
    await carregarContas();
  }catch(err){ erro.textContent = err.message; erro.classList.add('visivel'); }
}

async function criarContaProfessor(){
  const erro = document.getElementById('erroContaProfessor');
  erro.classList.remove('visivel');
  document.getElementById('senhaGeradaProfessor').classList.add('oculto');
  try{
    const r = await api('/usuarios/professor', {
      nome: document.getElementById('inpNomeProfessor').value.trim(),
      materia: document.getElementById('inpMateriaProfessor').value.trim(),
    });
    document.getElementById('valorSenhaProfessor').textContent = r.senhaTemp;
    document.getElementById('senhaGeradaProfessor').classList.remove('oculto');
    document.getElementById('inpNomeProfessor').value='';
    document.getElementById('inpMateriaProfessor').value='';
    await carregarContas();
  }catch(err){ erro.textContent = err.message; erro.classList.add('visivel'); }
}

async function atenderPedido(id){
  try{
    const r = await api(`/redefinicoes/${id}/atender`, {}, 'POST');
    alert(`Senha temporária de ${r.nome}: ${r.senhaTemp}\n\nAnote e entregue pessoalmente — ela será obrigada a trocar no próximo acesso.`);
    await carregarContas();
  }catch(err){ toast('⚠ '+err.message); }
}

async function resetarSenhaUsuario(id, nome){
  if(!confirm(`Gerar uma nova senha temporária para ${nome}?`)) return;
  try{
    const r = await api(`/usuarios/${id}/resetar-senha`, {}, 'POST');
    alert(`Senha temporária de ${r.nome}: ${r.senhaTemp}\n\nAnote e entregue pessoalmente.`);
  }catch(err){ toast('⚠ '+err.message); }
}

async function alternarAtivo(id){
  try{
    await api(`/usuarios/${id}/alternar-ativo`, {}, 'POST');
    await carregarContas();
  }catch(err){ toast('⚠ '+err.message); }
}

/* ================= ADMIN DE ESTAÇÕES (gestão) ================= */
async function criarEstacao(){
  const erro = document.getElementById('erroNovaEstacao');
  erro.classList.remove('visivel');
  try{
    const id = document.getElementById('inpIdNovaEstacao').value.trim().toUpperCase();
    const capacidade = Number(document.getElementById('inpCapNovaEstacao').value);
    const tipo = document.getElementById('selTipoNovaEstacao').value;
    const marca = document.getElementById('inpMarcaNovaEstacao').value.trim();
    await api('/estacoes', { id, capacidade, tipo, marca });
    toast(`✅ Estação ${id} criada.`);
    document.getElementById('inpIdNovaEstacao').value='';
    document.getElementById('inpCapNovaEstacao').value='';
    document.getElementById('inpMarcaNovaEstacao').value='';
    // a lista de recursos agendáveis mudou (nova estação = novo recurso) — recarrega
    recursos = await api('/recursos');
    document.getElementById('selEstacaoEditar').innerHTML = '';
    await carregarAdminEstacoes();
    await carregarPainel();
  }catch(err){ erro.textContent = err.message; erro.classList.add('visivel'); }
}

async function carregarAdminEstacoes(){
  const [ests, relatorio] = await Promise.all([api('/estacoes'), api('/relatorios/uso-professores')]);
  const sel = document.getElementById('selEstacaoEditar');
  if(!sel.options.length){
    sel.innerHTML = ests.map(e=>`<option value="${e.id}">Estação ${e.id}</option>`).join('');
    preencherEdicaoEstacao(ests);
  }
  document.getElementById('corpoRelatorio').innerHTML = relatorio.length ? relatorio.map(p=>`
    <tr><td>${p.nome}</td><td>${p.total}</td><td>${p.estacaoMaisUsada?'Estação '+p.estacaoMaisUsada:'—'}</td></tr>
  `).join('') : '<tr><td colspan="3">Ainda não há registros suficientes.</td></tr>';
}

function preencherEdicaoEstacao(listaEstacoes){
  const lista = listaEstacoes || estacoes;
  const id = document.getElementById('selEstacaoEditar').value;
  const e = lista.find(x=>x.id===id);
  if(!e) return;
  document.getElementById('inpCapEditar').value = e.capacidade;
  document.getElementById('inpQtdEditar').value = e.qtd ?? '';
}

async function salvarEdicaoEstacao(){
  const erro = document.getElementById('erroEditar');
  erro.classList.remove('visivel');
  try{
    const id = document.getElementById('selEstacaoEditar').value;
    await api(`/estacoes/${id}`, {
      capacidade: Number(document.getElementById('inpCapEditar').value),
      qtd: Number(document.getElementById('inpQtdEditar').value),
    }, 'PUT');
    toast('✅ Estação atualizada.');
    await carregarAdminEstacoes();
    await carregarPainel();
  }catch(err){ erro.textContent = err.message; erro.classList.add('visivel'); }
}

async function importarPlanilha(){
  const erro = document.getElementById('erroImportar');
  erro.classList.remove('visivel');
  try{
    const r = await api('/estacoes/importar', { csv: document.getElementById('txtImportar').value });
    document.getElementById('resultadoImportar').innerHTML =
      `✅ Atualizadas: ${r.atualizadas.join(', ') || 'nenhuma'}`
      + (r.ignoradas.length ? `<br>⚠ Ignoradas:<br>${r.ignoradas.join('<br>')}` : '');
    toast('Importação concluída.');
    await carregarAdminEstacoes();
    await carregarPainel();
  }catch(err){ erro.textContent = err.message; erro.classList.add('visivel'); }
}

/* ================= LOGIN / SESSÃO ================= */
function escolherPerfil(p){
  perfilLogin = p;
  document.getElementById('btnProf').classList.toggle('ativo', p==='professor');
  document.getElementById('btnGestao').classList.toggle('ativo', p==='gestao');
  document.getElementById('loginProfessor').classList.toggle('oculto', p!=='professor');
  document.getElementById('loginGestao').classList.toggle('oculto', p!=='gestao');
  document.getElementById('erroLogin').classList.remove('visivel');
}

async function entrar(){
  const erro = document.getElementById('erroLogin');
  const btn = document.getElementById('btnEntrar');
  erro.classList.remove('visivel');
  btn.disabled = true; btn.textContent = 'Entrando…';
  try{
    const corpo = { perfil: perfilLogin, senha: document.getElementById('inpSenha').value };
    if(perfilLogin==='professor') corpo.professorId = Number(document.getElementById('selProfessor').value)||null;
    else corpo.email = document.getElementById('inpEmailGestao').value;
    const r = await api('/login', corpo);
    token = r.token; usuario = r.usuario;
    localStorage.setItem('token', token);
    localStorage.setItem('usuario', JSON.stringify(usuario));
    document.getElementById('inpSenha').value='';
    if(usuario.trocarSenha) mostrarTelaSenha(); else abrirPainel();
  }catch(err){
    erro.textContent = err.message; erro.classList.add('visivel');
  }finally{
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

function mostrarTelaSenha(){
  document.getElementById('telaLogin').classList.add('oculto');
  document.getElementById('telaSenha').classList.remove('oculto');
}

async function salvarNovaSenha(){
  const erro = document.getElementById('erroSenha');
  erro.classList.remove('visivel');
  const s1 = document.getElementById('inpNovaSenha').value;
  const s2 = document.getElementById('inpConfirmaSenha').value;
  if(s1.length < 6){ erro.textContent='A senha deve ter pelo menos 6 caracteres.'; erro.classList.add('visivel'); return; }
  if(s1 !== s2){ erro.textContent='As senhas não conferem.'; erro.classList.add('visivel'); return; }
  try{
    await api('/trocar-senha', { novaSenha: s1 });
    usuario.trocarSenha = false;
    localStorage.setItem('usuario', JSON.stringify(usuario));
    document.getElementById('telaSenha').classList.add('oculto');
    toast('✅ Senha alterada com sucesso!');
    abrirPainel();
  }catch(err){ erro.textContent = err.message; erro.classList.add('visivel'); }
}

/* ---- Recuperação de senha (deslogado) ---- */
function abrirRecuperacao(){
  document.getElementById('erroRecuperacao').classList.remove('visivel');
  document.getElementById('okRecuperacao').classList.remove('visivel');
  document.getElementById('sombraRecuperacao').classList.add('visivel');
}
function fecharRecuperacao(){ document.getElementById('sombraRecuperacao').classList.remove('visivel'); }
function escolherPerfilRecuperacao(p){
  perfilRecuperacao = p;
  document.getElementById('btnRecProf').classList.toggle('ativo', p==='professor');
  document.getElementById('btnRecGestao').classList.toggle('ativo', p==='gestao');
  document.getElementById('recProfessor').classList.toggle('oculto', p!=='professor');
  document.getElementById('recGestao').classList.toggle('oculto', p!=='gestao');
}
async function enviarRecuperacao(){
  const erro = document.getElementById('erroRecuperacao');
  const ok = document.getElementById('okRecuperacao');
  erro.classList.remove('visivel'); ok.classList.remove('visivel');
  const corpo = { perfil: perfilRecuperacao };
  if(perfilRecuperacao==='professor'){
    const id = Number(document.getElementById('selRecProfessor').value);
    if(!id){ erro.textContent='Selecione seu nome.'; erro.classList.add('visivel'); return; }
    corpo.professorId = id;
  } else {
    const email = document.getElementById('inpRecEmail').value.trim();
    if(!email){ erro.textContent='Informe o e-mail institucional.'; erro.classList.add('visivel'); return; }
    corpo.email = email;
  }
  try{
    const r = await api('/recuperar-senha', corpo);
    ok.textContent = r.mensagem; ok.classList.add('visivel');
  }catch(err){ erro.textContent = err.message; erro.classList.add('visivel'); }
}

async function abrirPainel(){
  document.getElementById('telaLogin').classList.add('oculto');
  document.getElementById('telaPainel').classList.remove('oculto');
  const gestao = usuario.perfil==='gestao';
  document.getElementById('rotuloPerfil').textContent = gestao
    ? `🏫 ${usuario.cargo||'Gestão Escolar'} · sair` : `🧑‍🏫 Prof. ${usuario.nome} · sair`;
  document.getElementById('tituloPainel').textContent = gestao
    ? 'Painel das estações' : `Olá, Prof. ${usuario.nome}!`;
  document.getElementById('subPainel').textContent = gestao
    ? 'Acompanhe em tempo real o estado de cada estação.'
    : 'O que você deseja fazer?';
  document.getElementById('blocoNotificacoes').classList.toggle('oculto', !gestao);
  document.getElementById('blocoHistorico').classList.toggle('oculto', !gestao);
  document.getElementById('abaContas').classList.toggle('oculto', !gestao);
  document.getElementById('abaAdmin').classList.toggle('oculto', !gestao);
  document.getElementById('abas').classList.toggle('oculto', !gestao);
  document.getElementById('homeProfessor').classList.toggle('oculto', gestao);
  document.getElementById('secEstacoes').classList.add('oculto');
  document.getElementById('secAgendamentos').classList.add('oculto');
  document.getElementById('secContas').classList.add('oculto');
  document.getElementById('secAdmin').classList.add('oculto');
  document.getElementById('btnVoltarEstacoes').classList.add('oculto');
  document.getElementById('btnVoltarAgenda').classList.add('oculto');
  document.getElementById('blocoAgendaEstacoesProfessor').classList.add('oculto');
  try{
    if(!salas.length) salas = await api('/salas');
    const sel = document.getElementById('selSala');
    sel.innerHTML = '<option value="">— selecione a sala —</option>'
      + salas.map(s=>`<option value="${s.id}">${s.id} — ${s.turmas}</option>`).join('');
    if(!recursos.length) recursos = await api('/recursos');
    if(!periodos.length) periodos = await api('/periodos');
    if(!diasSemana.length) diasSemana = await api('/dias-semana');
    if(gestao){ abaAtual='estacoes'; mudarAba('estacoes'); await carregarPainel(); }
    else { abaAtual='home'; }
  }catch(err){ toast('⚠ '+err.message); }
  document.getElementById('btnFAQ').classList.remove('oculto');
  clearInterval(atualizador);
  atualizador = setInterval(()=>{
    if(abaAtual==='estacoes' || abaAtual==='estacoes-prof') carregarPainel().catch(()=>{});
    if(abaAtual==='estacoes-prof') carregarGradeEm('tabelaAgendaEstacoesProfessor', recursoAgendaEstacoesProf).catch(()=>{});
    if(abaAtual==='agendamentos') carregarGradeEm('tabelaAgenda', recursoAgendaGestao).catch(()=>{});
    if(abaAtual==='agenda-sala') carregarGradeEm('tabelaAgenda', 'sala_informatica').catch(()=>{});
  }, 15000);
}

function sair(){
  clearInterval(atualizador);
  token = null; usuario = null;
  localStorage.removeItem('token'); localStorage.removeItem('usuario');
  document.getElementById('telaPainel').classList.add('oculto');
  document.getElementById('telaSenha').classList.add('oculto');
  document.getElementById('telaLogin').classList.remove('oculto');
  document.getElementById('btnFAQ').classList.add('oculto');
  document.getElementById('painelFAQ').classList.add('oculto');
}

function alternarFAQ(){
  document.getElementById('painelFAQ').classList.toggle('oculto');
}

/* ================= MODAL RETIRADA / DEVOLUÇÃO ================= */
function abrirModal(id, modo){
  estacaoAtiva = estacoes.find(x=>x.id===id);
  modoModal = modo;
  const retirada = modo==='retirada';
  document.getElementById('tituloModal').textContent = (retirada?'Retirada':'Devolução')+' — Estação '+id;
  document.getElementById('subModal').textContent = retirada
    ? 'Conte os notebooks no gabinete e informe a quantidade encontrada.'
    : 'Ao final da aula, conte e informe quantos notebooks foram devolvidos ao gabinete.';
  document.getElementById('rotuloQtd').textContent = retirada
    ? 'Quantidade de notebooks encontrados na estação'
    : 'Quantidade de notebooks devolvidos à estação';
  document.getElementById('campoSala').style.display = retirada?'block':'none';
  document.getElementById('btnConfirmar').textContent = retirada?'Confirmar retirada':'Confirmar devolução';
  document.getElementById('inpQtd').value=''; document.getElementById('inpObs').value='';
  document.getElementById('inpQtd').max = estacaoAtiva.capacidade;
  document.getElementById('selSala').value='';
  document.getElementById('alertaModal').classList.remove('visivel');
  document.getElementById('sombraModal').classList.add('visivel');
  document.getElementById(retirada?'selSala':'inpQtd').focus();
}
function fecharModal(){ document.getElementById('sombraModal').classList.remove('visivel'); }

async function confirmar(){
  const alerta = document.getElementById('alertaModal');
  alerta.classList.remove('visivel');
  const corpo = {
    qtd: Number(document.getElementById('inpQtd').value),
    obs: document.getElementById('inpObs').value.trim() || undefined,
  };
  if(document.getElementById('inpQtd').value===''){
    alerta.textContent='Informe a quantidade de notebooks para continuar.';
    alerta.classList.add('visivel'); return;
  }
  if(modoModal==='retirada') corpo.sala = document.getElementById('selSala').value;
  try{
    const r = await api(`/estacoes/${estacaoAtiva.id}/${modoModal}`, corpo);
    fecharModal();
    toast('✅ '+r.mensagem);
    await carregarPainel();
  }catch(err){
    alerta.textContent = err.message; alerta.classList.add('visivel');
  }
}

/* ================= UTILIDADES ================= */
let toastTimer = null;
function toast(msg){
  const t = document.getElementById('toast');
  clearTimeout(toastTimer);
  t.textContent = msg; t.classList.add('visivel');
  toastTimer = setTimeout(()=>t.classList.remove('visivel'), 3200);
}

/* ================= INICIALIZAÇÃO ================= */
(async function iniciar(){
  document.addEventListener('keydown', ev=>{
    if(ev.key==='Escape'){ fecharModal(); fecharDetalhes(); fecharRecuperacao(); fecharAgendaCelula(); }
  });
  try{
    const profs = await api('/professores');
    ['selProfessor','selRecProfessor'].forEach(idSel=>{
      const sel = document.getElementById(idSel);
      profs.forEach(p=>{
        const o = document.createElement('option');
        o.value = p.id; o.textContent = `${p.nome} — ${p.materia}`;
        sel.appendChild(o);
      });
    });
  }catch{ /* servidor fora do ar: a tela de login ainda aparece */ }
  // Sessão salva: volta direto ao painel
  if(token && usuario){
    if(usuario.trocarSenha) mostrarTelaSenha(); else abrirPainel();
  }
})();
