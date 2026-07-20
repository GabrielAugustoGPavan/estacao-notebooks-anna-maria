# Plano do Projeto — Organização Estação Notebooks E.E Anna Maria

> Sistema web responsivo para organizar a distribuição e o controle das estações
> (carrinhos/gabinetes de recarga) de notebooks da escola estadual E.E Anna Maria.
> Acessível pelo **celular** e pelo **computador** através do navegador.

---

## 1. Visão Geral

| Item | Decisão |
|---|---|
| Tipo de aplicação | Aplicação Web Responsiva (PWA) — funciona no celular e no PC sem instalar nada |
| Usuários | Professores e Gestão Escolar |
| Estações | 3 gabinetes: **Estação A**, **Estação B** e **Estação C** |
| Equipamento | Gabinete de Recarga **TES Guardian** (cor cinza) — representado com modelo animado |
| Hospedagem | Servidor em nuvem (camada gratuita) ou servidor local da escola |

**Por que uma aplicação web (PWA) e não um aplicativo nativo?**
- Um único código funciona em Android, iPhone, Windows e Linux;
- Não precisa publicar na Play Store / App Store;
- O professor pode "instalar" o atalho na tela inicial do celular (recurso PWA);
- Manutenção muito mais simples para a escola.

---

## 2. Funcionalidades

### 2.1 Login (dois perfis)

| Perfil | Permissões |
|---|---|
| **Professor** | Fazer login, reservar/retirar uma estação, registrar a quantidade de notebooks na retirada e na devolução, ver o histórico das próprias aulas |
| **Gestão Escolar** | Tudo do professor **+** cadastrar/editar/desativar professores, ver painel com o estado das 3 estações em tempo real, ver relatórios e histórico completo, registrar notebooks em manutenção, corrigir lançamentos |

- Autenticação com e-mail (ou matrícula) + senha;
- Senhas criptografadas (bcrypt) — nunca salvas em texto puro;
- Sessão via token (JWT) com expiração;
- Gestão pode redefinir a senha de um professor.

### 2.2 Estações A, B e C

Cada estação possui:
- **Identificação**: A, B ou C;
- **Capacidade total** de notebooks (configurável pela gestão, ex.: 32);
- **Status**: `Disponível` · `Em uso` (mostra qual professor/turma) · `Em manutenção`;
- **Quantidade atual** de notebooks no gabinete;
- **Localização** (ex.: sala em que o carrinho está guardado).

### 2.3 Fluxo do Professor (conferência de notebooks)

**Regras de negócio importantes:**
- ⛔ **Uma estação por vez**: o professor só pode retirar uma nova estação após devolver a que está usando;
- 🤫 **Divergência é sigilosa**: o professor **nunca** vê alertas ou contagens de divergência — o registro é silencioso e o alerta vai **somente para a gestão** (evita constrangimento e não influencia a contagem do professor);
- 📍 **Localização dinâmica**: enquanto em uso, a estação consta na **sala da aula** (ex.: "Sala 1"); ao ser devolvida, volta a constar na **Sala de Informática** (local padrão de guarda e recarga).

1. **Chegada / retirada da estação**
   - O professor faz login, escolhe a estação (A, B ou C);
   - Preenche o campo **"Quantidade de notebooks encontrados na estação"**;
   - Informa turma/sala e horário da aula (horário sugerido automaticamente);

   **Salas e turmas da escola:**

   | Sala | Turmas |
   |---|---|
   | Sala 1 | 8º B e 3º TA EM (Técnico de Vendas) |
   | Sala 2 | 8º A e 3º A EM |
   | Sala 3 | 7º B e 2º TA EM |
   | Sala 4 | 7º A e 2º A |
   | Sala 5 | 6º B e 1º B |
   | Sala 6 | 6º A e 1º A |
   | Sala 8 | 9º B |
   | Sala 9 | 9º A |

   **Professores cadastrados (horários 2026 — Anos Finais e Ensino Médio):**

   | Professor(a) | Matéria(s) |
   |---|---|
   | Alex | Geografia / Filosofia / Projeto de Vida |
   | Caroline | Língua Portuguesa / Inglês |
   | Cynthian | Téc. Vendas — Marketing / Mat. Básica |
   | Daniela | História / Atualidades |
   | Dimas | História / Projeto de Vida |
   | Gabão | Matemática |
   | Jane | Inglês |
   | Laércio | Ciências / Matemática / Ed. Financeira |
   | Layla | Arte |
   | Letícia | Matemática |
   | Lucas | Ciências / Biologia |
   | Magali | Matemática / Tecnologia / Ed. Financeira |
   | Marcos | Téc. Vendas — Tecnologia / Planejamento / Carreira |
   | Maria V. | Geografia |
   | Melanie | Física / Química |
   | Ranif | Língua Portuguesa / Redação |
   | Robson | Sociologia / Filosofia / História |
   | Rosana | Língua Portuguesa / Redação e Leitura |
   | Sandra | Matemática / Ed. Financeira |
   | Vinícius | Téc. Vendas — Proc. Comercial / Comunicação |
   | Viviane | Língua Portuguesa / Redação e Leitura |
   | Yago | Educação Física |


   - Se a quantidade for diferente da esperada, o sistema registra a divergência e notifica **somente a gestão** — nada é exibido ao professor.
2. **Final da aula / devolução**
   - O professor abre o registro em andamento;
   - Preenche o campo **"Quantidade de notebooks devolvidos à estação"**;
   - O sistema compara retirada × devolução **silenciosamente**:
     - ✅ Quantidades iguais → registro fechado normalmente;
     - ⚠️ Quantidade diferente → alerta imediato **apenas para a gestão** (o professor recebe a mesma confirmação normal);
   - Campo opcional de **observações** (ex.: "notebook 14 não liga", "carregador danificado").
3. Todo registro guarda: professor, estação, turma, data/hora de retirada e devolução, quantidades e observações — formando o **histórico auditável**.

### 2.4 Modelo animado do Gabinete TES Guardian (cinza)

- Ilustração vetorial (SVG) do gabinete TES Guardian na cor **cinza**, com animações em CSS:
  - **Porta abrindo** quando a estação é retirada;
  - **Slots dos notebooks** preenchidos/vazios conforme a quantidade informada (ex.: 28/32 slots acesos);
  - **LED de status**: verde (disponível), amarelo (em uso), vermelho (divergência/manutenção);
  - Animação sutil de "carregando" (pulso nos slots) quando o gabinete está recarregando.
- O modelo aparece no painel principal — a gestão vê os 3 gabinetes lado a lado com o estado real de cada um.

### 2.5 Painel da Gestão

- Visão em tempo real das 3 estações (com os modelos animados);
- Relatórios: uso por professor, por turma, por período; divergências de contagem;
- Exportação de relatórios em planilha (CSV/Excel);
- Cadastro de professores e configuração das estações.

---

## 3. Tecnologias Recomendadas

### 3.1 Linguagem de programação → **JavaScript/TypeScript**

**Recomendação: TypeScript** (JavaScript com tipos) em todo o projeto.

| Camada | Tecnologia |
|---|---|
| Frontend (telas) | **React** + Vite, com Tailwind CSS (layout responsivo) e animações CSS/SVG para o gabinete |
| Backend (servidor) | **Node.js** com **Express** (ou NestJS, se quiser mais estrutura) |

**Por quê?**
- Uma única linguagem no frontend e no backend → mais fácil de manter;
- Maior comunidade e material de estudo em português;
- Ideal para telas interativas/animadas como o modelo do gabinete;
- Roda em qualquer hospedagem barata ou gratuita.

*Alternativa válida:* Python (Django) no backend — bom se a equipe já conhece Python, mas exigiria duas linguagens no projeto.

### 3.2 Banco de dados → **PostgreSQL**

**Recomendação: PostgreSQL** — gratuito, robusto, padrão de mercado.

- Dados relacionais se encaixam perfeitamente: professores → registros → estações;
- Garante integridade (um registro de retirada sempre pertence a um professor e a uma estação);
- Disponível gratuitamente em serviços como **Supabase** ou **Neon**.

*Alternativa para começar simples:* **SQLite** (um único arquivo, zero configuração) — suficiente para o volume de uma escola e fácil de migrar para PostgreSQL depois.

**Tabelas principais:**

```
usuarios      (id, nome, email, senha_hash, perfil [professor|gestao], ativo)
estacoes      (id, nome [A|B|C], capacidade, status, localizacao, qtd_atual)
registros     (id, usuario_id, estacao_id, turma,
               qtd_retirada, data_hora_retirada,
               qtd_devolucao, data_hora_devolucao,
               divergencia, observacoes, status [aberto|fechado])
notebooks_manutencao (id, estacao_id, identificacao, problema, data_entrada, data_saida)
```

### 3.3 Servidor / Hospedagem

Sim, **a aplicação correta é um servidor web com banco de dados** — sua intuição está certa. Duas opções:

**Opção 1 — Nuvem (recomendada): custo zero para começar**

| Serviço | Função | Custo |
|---|---|---|
| **Render** ou **Railway** | Hospeda o backend Node.js | Gratuito (camada free) |
| **Vercel** ou **Netlify** | Hospeda o frontend React | Gratuito |
| **Supabase** ou **Neon** | Banco PostgreSQL gerenciado | Gratuito até o volume de uma escola |

- Acessível de qualquer lugar (professor pode consultar de casa);
- Sem manutenção de máquina física;
- HTTPS automático (segurança das senhas).

**Opção 2 — Servidor local na escola**

- Um computador da escola rodando Node.js + PostgreSQL, acessível pela rede Wi-Fi interna;
- Vantagem: funciona mesmo sem internet externa;
- Desvantagem: exige que o computador fique ligado e alguém o mantenha; sem acesso de fora da escola.

> **Recomendação final:** começar na **nuvem (Opção 1)** pela simplicidade e custo zero.

---

## 4. Etapas de Desenvolvimento

| Fase | Entrega | Descrição |
|---|---|---|
| **1** | Estrutura do projeto | Configurar frontend (React), backend (Node/Express) e banco (PostgreSQL/SQLite) |
| **2** | Login e perfis | Cadastro, autenticação JWT, perfis professor/gestão |
| **3** | Estações A, B e C | Cadastro das estações, status e capacidade |
| **4** | Fluxo de registro | Telas de retirada e devolução com os campos de quantidade + detecção de divergência |
| **5** | Modelo animado | SVG animado do gabinete TES Guardian cinza integrado ao painel |
| **6** | Painel da gestão | Tempo real, relatórios, exportação CSV, gestão de professores |
| **7** | PWA e ajustes | Instalação na tela inicial do celular, testes com professores, correções |
| **8** | Publicação | Deploy na nuvem, cadastro dos usuários reais, treinamento rápido da equipe |

---

## 5. Resumo das Decisões

- **Linguagem:** TypeScript (React no frontend, Node.js/Express no backend)
- **Banco de dados:** PostgreSQL (ou SQLite para começar)
- **Servidor:** Nuvem com camadas gratuitas (Render/Railway + Vercel + Supabase) — sim, servidor web com banco de dados é a aplicação correta
- **Acesso:** Navegador do celular e do computador (PWA instalável)
- **Segurança:** Senhas com bcrypt, sessões JWT, HTTPS
