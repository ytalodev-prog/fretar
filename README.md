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

Requisito: [Node.js](https://nodejs.org) 18 ou superior. **Não há dependências para instalar.**

```bash
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
│   ├── store.js     # armazenamento em data/db.json
│   └── config.js    # configurações e leitor de .env
├── public/          # frontend (HTML, CSS e JS puro)
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   └── img/fretar-logo.png
├── test/api.test.js
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

Copie `.env.example` para `.env` para trocar a porta, o login/senha da Portaria ou o segredo das sessões. Sem configuração, o acesso local da Portaria usa a senha padrão acima. O servidor recusa essa senha em produção. O `.env` é ignorado pelo Git.

## Preparar deploy com Docker

O projeto inclui `Dockerfile` e `compose.yaml`. A imagem usa Node.js 24, roda sem usuário root e executa `npm test` durante o build.

1. Copie `.env.example` para `.env` e preencha `PORTARIA_PASSWORD` com uma senha exclusiva de pelo menos 12 caracteres.
2. Gere um segredo de sessão com:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Cole o resultado em `SESSION_SECRET`. Não reutilize a senha da Portaria.
3. Inicie o serviço:

   ```bash
   docker compose up --build -d
   docker compose ps
   ```

4. Confirme a saúde em `http://localhost:3000/api/health` e veja logs com `docker compose logs -f`.

O Compose define `NODE_ENV=production`, usa o volume persistente `fretar-data` para `data/db.json` e publica a porta indicada por `PORT` (3000 por padrão). Em hospedagens com proxy HTTPS, configure também um disco persistente montado em `/app/data`, defina os mesmos segredos como variáveis de ambiente e mantenha **uma única instância**. O armazenamento JSON local não suporta múltiplas réplicas; para escalar ou usar armazenamento efêmero, migre `server/store.js` para PostgreSQL ou outro banco gerenciado.

Em produção o servidor recusa iniciar com a senha padrão, senha da Portaria menor que 12 caracteres ou `SESSION_SECRET` menor que 32 bytes. O endpoint `/api/health` pode ser usado como verificação de saúde. Configure HTTPS no provedor: cookies de sessão recebem `Secure` quando `NODE_ENV=production`.

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
- Sem volume persistente, contas e avisos podem ser perdidos ao recriar o contêiner. Faça backups do volume de dados.
- Para uso com muitos usuários ou mais de uma instância, troque `server/store.js` por PostgreSQL mantendo as mesmas funções.
- As fontes (Bricolage Grotesque e Figtree) vêm do Google Fonts; sem internet, o site usa fontes do sistema.
