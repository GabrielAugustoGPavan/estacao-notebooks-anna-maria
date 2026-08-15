# O que foi adicionado

Substitua estes 3 arquivos no seu repositório pelos anexados:

- `sistema/src/banco.js`
- `sistema/src/servidor.js`
- `sistema/publico/index.html`

Nenhuma outra dependência nova foi adicionada — continua usando só `express`,
`bcryptjs`, `jsonwebtoken` e `pg` (já estavam no `package.json`).

> ⚠️ Se você já tem um `escola.db` com dados reais, ele continua funcionando —
> o sistema roda uma pequena migração automática na inicialização (adiciona a
> coluna `cargo` e as tabelas novas) sem apagar nada.

## 1. Login com recuperação de senha
- Botão "Esqueci minha senha" na tela de login.
- Como a escola não tem servidor de e-mail configurado, o pedido cai numa fila
  (`Pedidos de redefinição de senha`, visível só pra gestão). A gestão clica em
  "Gerar senha" e entrega a senha temporária pessoalmente ao professor/conta.

## 2. Contas administrativas (Diretor, Vice-Diretor, CGPAC, Estagiário)
- Nova aba **Contas** (só gestão) permite criar essas contas — todas com as
  mesmas permissões de gestão, diferenciadas apenas pelo "cargo" exibido.
- A aba também lista todas as contas, permite **resetar senha** de qualquer
  uma e **ativar/desativar** acesso sem apagar o histórico.

## 3. Agendamento (Sala de Informática e reserva antecipada de Estação)
- Nova aba **Agendamentos**, disponível para professor e gestão.
- Permite reservar com antecedência a Sala de Informática (turma inteira) ou
  uma Estação específica (A/B/C) para um horário futuro.
- O servidor **bloqueia conflitos de horário** automaticamente (dois
  professores não conseguem reservar o mesmo recurso no mesmo horário).
- Isso é separado do fluxo de retirada/devolução imediata, que continua igual.

## 4. Ferramentas administrativas das estações
Nova aba **Estações (admin)**, só gestão:
- **Importar planilha**: cole os dados em formato `id,capacidade,qtd` (uma
  linha por estação) e o sistema atualiza tudo de uma vez.
- **Editar estação**: ajustar capacidade/quantidade diretamente, sem precisar
  passar pelo fluxo de divergência.
- **Relatório de uso por professor(a)**: quantas vezes cada um usou as
  estações e qual foi a mais usada por ele.

## O que eu testei
Rodei o servidor localmente e testei via API real (não só leitura de código):
login, troca de senha, criação de conta admin, pedido + atendimento de
recuperação de senha, importação de planilha, edição de estação, criação de
agendamento com **detecção de conflito de horário funcionando**, e o
relatório de uso agregando registros reais de retirada/devolução. Também
validei que toda função e todo `id` referenciados no HTML existem no
JavaScript (sem botões quebrados).

## Como testar você mesmo
```bash
cd sistema
npm install
npm start
# abra http://localhost:3000
```
Login inicial da gestão: `gestao@eeannamaria.sp.gov.br` / `gestao123`
(ele vai pedir para trocar a senha no primeiro acesso).
