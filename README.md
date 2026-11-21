# Fretar · Mural de avisos

Mural de avisos com duas partes:

- **Notificante**: cria uma conta e escolhe um *nome de login* que indica o setor/local (ex.: "Almoxarifado Bloco B"). Esse nome aparece em cada aviso que ele enviar. Pode acompanhar se a portaria já viu ou concluiu.
- **Recebedor (Portaria)**: conta única, já criada pelo sistema. Vê todos os avisos, filtra por andamento/origem, busca, marca como visto, conclui, reabre e apaga os concluídos.

| Conta da Portaria | |
|---|---|
| Login local (padrão) | `Portaria` |
| Senha local (padrão) | `Fretar#2026` — apenas desenvolvimento |
| Produção | configure `PORTARIA_LOGIN` e `PORTARIA_PASSWORD` como variáveis secretas |

## Como rodar no VS Code

Requisito: [Node.js](https://nodejs.org) 24.

```bash
npm ci           # instala o driver do Neon
npm start        # sobe em http://localhost:3000
npm run dev      # igual, reiniciando ao salvar arquivos
npm test         # testes da API
```

No VS Code, também dá para apertar **F5** (já existe uma configuração em `.vscode/launch.json`).

## Estrutura

```
fretar/
├── server/
│   ├── index.js     # servidor HTTP, rotas da API e arquivos estáticos
│   ├── auth.js      # senhas (scrypt) e sessão (cookie assinado)
│   ├── store.js     # JSON local ou PostgreSQL Neon
│   └── config.js    # configurações e leitor de .env
├── api/             # função Node para Vercel
├── public/          # frontend (HTML, CSS e JS puro)
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   └── img/fretar-logo.png
├── test/api.test.js
├── vercel.json
├── Dockerfile
├── compose.yaml
├── .env.example
└── package.json
```

## API

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| POST | `/api/register` | público | Cria conta de notificante |
| POST | `/api/login` | público | Entra (notificante ou portaria) |
| POST | `/api/logout` | logado | Sai |
| GET | `/api/me` | logado | Dados da sessão |
| GET | `/api/avisos` | logado | Portaria: todos. Notificante: só os seus |
| POST | `/api/avisos` | notificante | Envia aviso |
| PATCH | `/api/avisos/:id` | portaria | Muda status: `novo`, `visto`, `concluido` |
| DELETE | `/api/avisos/:id` | dono (se `novo`) ou portaria (se `concluido`) | Apaga aviso |

## Configuração local

Copie `.env.example` para `.env` para configurar a porta e a conta da Portaria. Sem `DATABASE_URL`, o desenvolvimento local usa `data/db.json`; com `DATABASE_URL`, usa Neon. O `.env` é ignorado pelo Git.

## Deploy na Vercel com Neon

Vercel fornece HTTPS automaticamente para os domínios `*.vercel.app` e para domínios personalizados configurados no projeto. O navegador usa cookies `Secure` nas implantações Vercel. O backend usa uma função Node e Neon PostgreSQL, pois o disco de uma função Vercel não é persistente.

1. Crie um projeto PostgreSQL no Neon (pode ser pela integração Neon do Marketplace da Vercel) e conecte-o ao projeto Vercel.
2. Importe este repositório na Vercel usando a raiz do projeto. O [vercel.json](./vercel.json) seleciona `public` como saída estática e `api/[...path].js` como função Node; `npm run build` executa os testes.
3. Configure estas variáveis no projeto Vercel, em **Production** e também em **Preview** se for testar prévias:

   - `DATABASE_URL`: URL de conexão PostgreSQL do Neon. A integração Neon da Vercel com o prefixo `DATABASE` fornece `DATABASE_POSTGRES_PRISMA_URL`; o backend também reconhece essa variável automaticamente.
   - `PORTARIA_LOGIN`: normalmente `Portaria`.
   - `PORTARIA_PASSWORD`: senha exclusiva de 12 a 72 caracteres, diferente da senha padrão.
   - `SESSION_SECRET`: segredo aleatório de pelo menos 32 bytes. Gere localmente com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` e cadastre como variável secreta.

   Não coloque esses valores no Git. A aplicação cria as tabelas no Neon no primeiro acesso; confirme em `https://seu-dominio/api/health`.

4. Faça o deploy pela Vercel. HTTPS e certificado do domínio são gerenciados pela Vercel; no domínio personalizado, conclua a configuração DNS solicitada no painel.

### Trazer os dados do Docker atual (opcional)

Se quiser preservar notificantes e avisos já existentes, pare temporariamente o serviço para evitar novas gravações, copie o banco do volume para `data/db.json` e configure `DATABASE_URL` no `.env` local:

```bash
docker compose stop fretar
docker compose cp fretar:/app/data/db.json data/db.json
npm run migrate:neon
```

O importador exige um banco Neon vazio. Ele copia hashes de senha (não senhas em texto puro), avisos e IDs. Depois, configure a mesma `DATABASE_URL`, `PORTARIA_LOGIN`, `PORTARIA_PASSWORD` e `SESSION_SECRET` na Vercel e faça o deploy. Não envie `data/db.json` ao Git.

## Deploy local com Docker

O projeto também inclui `Dockerfile` e `compose.yaml`. A imagem usa Node.js 24, executa `npm ci` e os testes durante o build, roda sem usuário root e mantém `data/db.json` no volume `fretar-data`. Sem `DATABASE_URL`, use:

```bash
docker compose up --build -d
docker compose ps
```

Confira `http://localhost:3000/api/health`. Para usar Neon também no Docker, defina `DATABASE_URL` no `.env`; a persistência passa então para o PostgreSQL.

Em produção o servidor recusa iniciar com a senha padrão, senha da Portaria menor que 12 caracteres ou `SESSION_SECRET` menor que 32 bytes. O endpoint `/api/health` verifica também a inicialização do armazenamento.

## Publicar o código no Git

```bash
git init
git add .
git commit -m "Fretar: mural de avisos"
git branch -M main
git remote add origin <URL-DO-SEU-REPOSITORIO>
git push -u origin main
```

O `.gitignore` exclui `data/` (banco e segredo) e `.env`; `.dockerignore` também impede que esses arquivos entrem na imagem.

## Observações

- O fluxo completo de cadastro, login, envio, recebimento, acompanhamento e conclusão é coberto pelos testes da API: execute `npm test`.
- Em Docker sem Neon, contas e avisos dependem do volume `fretar-data`; faça backups regulares.
- Na Vercel, configure `DATABASE_URL` ou conecte a integração Neon (que fornece `DATABASE_POSTGRES_PRISMA_URL`) para que os dados persistam entre execuções e instâncias.
- As fontes (Bricolage Grotesque e Figtree) vêm do Google Fonts; sem internet, o site usa fontes do sistema.
