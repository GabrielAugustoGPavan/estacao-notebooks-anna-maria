# Organização Estação Notebooks — E.E Anna Maria

Sistema para controle das 3 estações (gabinetes TES Guardian) de notebooks da escola.
Funciona no navegador do computador e do celular.

## Como rodar

```bash
cd sistema
npm install
npm start
```

Depois abra **http://localhost:3000** no navegador.
Para acessar do celular, use o endereço IP do computador na mesma rede Wi-Fi
(ex.: `http://192.168.0.10:3000`).

## Acessos iniciais

| Perfil | Acesso | Senha inicial |
|---|---|---|
| Professor | selecionar o nome na lista | `mudar123` |
| Gestão | `gestao@eeannamaria.sp.gov.br` | `gestao123` |

**Todos são obrigados a criar uma senha nova no primeiro acesso.**

## Regras do sistema (aplicadas no servidor)

- Professor **nunca** recebe dados de divergência nem a contagem real — os alertas
  vão somente para o painel da gestão;
- Professor só retira uma nova estação **após devolver** a que está usando;
- Estação em uso mostra a **sala da aula** como localização; devolvida, volta a
  constar na **Sala de Informática**;
- Toda observação do professor chega à gestão;
- A gestão pode **encerrar uma divergência** após conferir o gabinete fisicamente
  (botão "Ver detalhes" na estação).

## Arquivos

```
sistema/
├── package.json          dependências e scripts
├── src/
│   ├── servidor.js       API (Express) + regras de negócio
│   └── banco.js          banco SQLite + carga inicial
├── publico/
│   └── index.html        interface (celular e computador)
└── escola.db             banco de dados (criado no primeiro start)
```

## Produção (hospedagem)

- Defina a variável de ambiente `JWT_SEGREDO` com um valor longo e aleatório
  (sem ela, os logins caem a cada reinício do servidor);
- `PORTA` define a porta (padrão 3000);
- O banco SQLite atende bem o volume da escola; para migrar a PostgreSQL
  (Supabase/Neon), troque apenas o módulo `src/banco.js`.

## Para zerar o sistema

Apague o arquivo `escola.db` e reinicie o servidor — a carga inicial
(professores, estações e senhas iniciais) é recriada automaticamente.
