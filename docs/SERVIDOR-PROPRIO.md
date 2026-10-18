# Servidor próprio (no lugar do Firebase)

Este fork não usa Firebase. O jogo continua chamando a API compat do Firebase
(`firebase.firestore()`, `firebase.database()`), mas quem
responde é `js/fb/firebase-app-compat.js`, que fala com o servidor de `server/`
no mesmo domínio. Por isso o resto do código do jogo quase não muda, e os
merges com o upstream continuam simples.

| Firebase | Aqui |
| --- | --- |
| Autenticação | Better Auth: e-mail verificado, sessão em cookie e recuperação |
| Firestore (saves, ranking, amigos, perfis, convites) | SQLite (`/data/pokesurvivor.sqlite`), `POST /api/fs/*`, `onSnapshot` por WebSocket |
| Realtime Database (salas e sinalização do coop) | memória do servidor, WebSocket `/api/ws` |
| `firestore.rules` / `database.rules.json` | `server/rules.js` e `server/live.js` (donos e permissões; sem o anti-trapaça do ranking) |

Autenticação, configuração de Google/SMTP, backup e migração estão em
[AUTENTICACAO.md](AUTENTICACAO.md). Não há emulação de Firebase Auth.
O adapter de dados usa a sessão do Better Auth nas requisições HTTP e WebSocket.

## Integração com o jogo

- `js/core/auth.js`: cliente dos endpoints do Better Auth, sem tokens persistidos no JavaScript.
- `js/core/db.js`: saves e sincronização; contas com senha locais foram removidas.
- `js/fb/firebase-app-compat.js`: adapter de documentos e salas com cookies.
- `js/ui/login.js`: cadastro, verificação, login e recuperação por e-mail.
- `server/auth.mjs`: configuração do Better Auth e entrega de e-mails.

## Trazer o save do pokesurvivor.com

`importar/` traz um favorito (bookmarklet). Ele roda no pokesurvivor.com, lê a
cópia do save que o próprio jogo guarda em `localStorage` (`ps.cloud.<uid>`) e a
manda por `postMessage` para `importar/`. A página guarda o save em
`ps.import`, e a próxima conta que entrar neste navegador o recebe: conta nova
fica igual à oficial, conta com progresso junta os dois (`G.DB.merge`). Também
dá para colar o JSON ou escolher um arquivo.

## Rodar

```sh
cd server && npm install && PORT=3000 BETTER_AUTH_URL=http://localhost:3000 AUTH_EMAIL_MODE=outbox DATA_DIR=./data STATIC_DIR=.. node index.js
# abrir http://localhost:3000/dev.html (os scripts soltos) ou / (depois de node tools/build.js --sin-seo)
```

Imagem: `docker compose up -d --build`. Ela roda `tools/build.js --sin-seo`,
serve o resultado e guarda os dados no volume `pokesurvivor-data`. `ADMINS`
(uids separados por vírgula) dá permissão de moderação no servidor; a tela de
moderação do jogo só aparece para os uids de `ADMINS` em `js/net/ranking.js`.
