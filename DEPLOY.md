# Guia de Publicação na Nuvem — Estação Notebooks E.E Anna Maria

O sistema já está preparado para a nuvem. São **3 passos**, todos com plano
gratuito, feitos pelo navegador. Tempo estimado: 15–20 minutos.

```
[GitHub]  guarda o código  →  [Neon]  banco PostgreSQL  →  [Render]  servidor no ar
```

---

## Passo 1 — Publicar o código no GitHub

O repositório git local já está pronto (commit feito). Falta enviá-lo ao GitHub:

1. Crie uma conta (ou entre) em https://github.com
2. Clique em **New repository**
   - Nome sugerido: `estacao-notebooks-anna-maria`
   - Deixe **Private** (recomendado para projeto da escola)
   - **Não** marque "Add a README" (o projeto já tem)
3. Copie os comandos que o GitHub mostrar em *"push an existing repository"* e
   rode no terminal, dentro de `d:\projetoClaudeCode`:

```bash
git remote add origin https://github.com/SEU_USUARIO/estacao-notebooks-anna-maria.git
git push -u origin main
```

> O GitHub vai pedir login na primeira vez. Se pedir senha, use um
> *Personal Access Token* (Settings → Developer settings → Tokens) — a senha
> comum não funciona no git.

---

## Passo 2 — Criar o banco PostgreSQL no Neon

1. Acesse https://neon.tech e crie a conta (pode entrar com o GitHub)
2. Crie um projeto — nome sugerido: `estacao-notebooks`
   - Região: **AWS São Paulo (sa-east-1)** se disponível (menor latência no Brasil)
3. Na tela do projeto, clique em **Connect** e copie a **connection string**
   (começa com `postgresql://...`). Guarde-a para o Passo 3.

> Plano gratuito do Neon: 0,5 GB — muito além do necessário para a escola.

---

## Passo 3 — Publicar o servidor no Render

1. Acesse https://render.com e crie a conta (entre com o GitHub — facilita)
2. Clique em **New → Blueprint**
3. Conecte/aponte o repositório `estacao-notebooks-anna-maria`
   - O Render lê o arquivo `render.yaml` do projeto e configura quase tudo sozinho
4. Ele vai pedir o valor de **DATABASE_URL** → cole a connection string do Neon
   (o `JWT_SEGREDO` é gerado automaticamente)
5. Clique em **Apply** e aguarde o primeiro deploy (2–5 minutos)
6. Ao final, o Render mostra o endereço público, algo como:

```
https://estacao-notebooks-anna-maria.onrender.com
```

**Pronto!** Esse endereço funciona em qualquer celular ou computador, dentro ou
fora da escola, já com HTTPS (cadeado de segurança).

---

## Depois de publicar — checklist da primeira vez

1. Abra o endereço e entre como **Gestão** (`gestao@eeannamaria.sp.gov.br` /
   senha inicial `gestao123`) → o sistema exige criar a senha definitiva
2. Confira as 3 estações no painel
3. Peça a cada professor que faça o primeiro acesso (senha inicial `mudar123`
   → cada um cria a sua senha pessoal)
4. Compartilhe o endereço com a equipe (dica: gerem um QR code e colem um
   adesivo em cada gabinete TES Guardian!)

---

## Avisos importantes do plano gratuito

- **Servidor "dorme"**: no plano free do Render, após ~15 min sem acessos o
  servidor hiberna; o primeiro acesso seguinte demora ~30–60 s para acordar.
  Os acessos seguintes são rápidos. Para a rotina da escola isso costuma ser
  aceitável; se incomodar, o plano pago do Render (7 US$/mês) elimina isso.
- **Dados ficam no Neon**: o banco fica fora do Render, então os dados **nunca
  se perdem** quando o servidor hiberna ou reinicia.
- **Backup**: o Neon guarda o histórico do banco por 24 h no plano free
  (restauração point-in-time). Para backup extra, a gestão pode exportar os
  dados periodicamente (posso criar um botão de exportação se quiserem).

## Atualizações futuras do sistema

Qualquer mudança no código publicada com `git push` faz o Render reimplantar
automaticamente a nova versão em ~2 minutos.
