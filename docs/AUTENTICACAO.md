# Autenticação do fork

Better Auth 1.7.10 é a única implementação de autenticação. O jogo usa e-mail
verificado e senha; Google pode ser habilitado por configuração. Os adapters de
documentos e salas continuam compatíveis com Firestore/Realtime Database, mas
não implementam Firebase Auth nem carregam o SDK de autenticação do Firebase.

## Desenvolvimento

```sh
cd server
npm ci
PORT=3097 BETTER_AUTH_URL=http://localhost:3097 AUTH_EMAIL_MODE=outbox node index.js
```

Se as variáveis já estiverem no `.env` privado da raiz, inicie a partir de
`server/` com `node --env-file=../.env index.js`. O processo não carrega esse
arquivo automaticamente sem a flag. O `.env` local deve usar origem localhost,
`NODE_ENV=development`, `AUTH_EMAIL_MODE=outbox` e um DATA_DIR de teste.

Abra `http://localhost:3097/dev.html`. Nesse modo os e-mails ficam como JSON em
`server/data/mail/`, privados, com permissão 600; o segredo de desenvolvimento
fica em `server/data/auth-secret`. Não são enviados e-mails reais. O modo outbox
é ignorado em produção. Os links e arquivos contêm credenciais temporárias:
nunca os publique ou inclua em screenshots/logs compartilhados.

## Configuração publicada

Copie `.env.example` para `.env` no host. `docker compose` passa o arquivo ao
container. Defina:

- `BETTER_AUTH_URL`: origem HTTPS exata, sem caminho; o domínio do jogo.
- `BETTER_AUTH_SECRET`: segredo aleatório de pelo menos 32 caracteres. Gere com
  `openssl rand -base64 48` e guarde só no `.env`, com permissão 600. Preserve-o
  entre deploys.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM` e, quando exigidos pelo
  provedor, `SMTP_USER`/`SMTP_PASS`. Porta 587 usa STARTTLS obrigatório; 465 usa
  `SMTP_SECURE=true`. Configure SPF/DKIM do remetente conforme o provedor.
- `AUTH_TRUSTED_PROXIES`: IPs exatos dos peers do proxy que entregam tráfego ao
  container. Vazio usa o IP do socket, que pode agrupar jogadores no mesmo limite.
  Não confie em headers fornecidos diretamente pela internet.

Sem envio de e-mail configurado, cadastro por senha, recuperação pela tela e
confirmação de exclusão ficam indisponíveis. Login Google funciona sem SMTP,
inclusive no primeiro acesso das contas migradas com e-mail associado.

Google é opcional: crie um cliente OAuth do tipo aplicação web e configure
`GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. A origem JavaScript é a origem do
jogo; o redirect URI é `https://SEU-DOMINIO/api/auth/callback/google`.
O botão só aparece com as duas variáveis. Google precisa confirmar o e-mail.
Uma conta existente com e-mail já verificado pode ser vinculada ao entrar com
esse mesmo e-mail Google. Também existe Ajustes > Cuenta > Vincular Google.

Para o primeiro acesso dos testers migrados, `auth_migration_claims` registra
somente os UIDs/e-mails associados pelo operador. O hook `validateUserInfo`
permite o vínculo dessa conta ainda não verificada apenas quando o Google
comprova o mesmo e-mail e não existe nenhuma credencial associada ao UID.
Um cadastro comum não verificado, sobretudo com senha, não recebe essa exceção.
O vínculo mantém o UID, nome do jogo e documentos; senhas antigas nunca entram
no processo. O fluxo é coberto por callback OAuth completo com provedor simulado.

Better Auth está fixado em 1.7.10. `requireLocalEmailVerified: false` é usado
somente porque a regra equivalente é aplicada no hook com a exceção acima.
Esse parâmetro está depreciado na biblioteca: ao atualizar Better Auth, execute
os testes de migração/Google e revise a integração antes de publicar.

## Backup e migração única

A migração preserva UIDs e todos os documentos de jogo. Não importa senhas,
hashes ou sessões antigas. As tabelas `users` e `sessions` antigas são removidas;
Better Auth usa `user`, `account`, `session` e `verification`.

Prepare um JSON privado que associe os apelidos atuais aos e-mails informados
pelos donos. Exemplo fictício:

```json
{"Tester": "tester@example.com"}
```

Contas sem e-mail ficam em `pending_accounts`, com UID, nome e data de criação.
Seus saves, nomes reservados e amizades continuam preservados; não podem entrar
até o operador associar um e-mail. Para ativá-las posteriormente, execute o mesmo
comando com um JSON contendo apenas os apelidos pendentes desejados.

Sequência operacional, depois de configurar as variáveis e preparar a imagem:

1. Guarde uma tag da imagem anterior para rollback e uma cópia externa do banco.
2. Pare o servidor antigo. Não execute a migração com jogadores gravando dados.
3. Disponibilize o JSON privado em `/data/account-emails.json` no volume.
4. Execute `docker compose run --rm --no-deps app node migrate-auth.mjs /data/account-emails.json`.
5. O comando faz backup consistente antes de modificar o banco, verifica
   integridade, migra as contas em transação e informa caminho/hash do backup e
   contagens. Copie esse backup também para fora do volume.
6. Suba o servidor com `docker compose up -d` e confira saúde e login.
7. Os testers entram com **Continuar con Google**, usando o e-mail associado,
   ou usam **Recuperar acceso** para escolher uma senha nova quando SMTP estiver
   configurado. Google ou o link de recuperação comprovam a posse do e-mail.
   Senhas e sessões do sistema anterior deixam de funcionar.

O servidor recusa um banco com autenticação antiga; iniciar a imagem nova não
migra silenciosamente as contas. Para um backup avulso:
`docker compose exec app node backup.mjs`.

Rollback: pare o servidor novo, restaure uma cópia do SQLite indicada pelo
comando de migração, remova apenas os arquivos WAL/SHM correspondentes com todos
os processos parados e volte à imagem anterior. Preserve o banco novo para
investigação. O rollback do banco perde gravações posteriores à migração: use
uma janela curta de validação sem jogadores.

## Sessão e comportamento offline

- Cookie HttpOnly, SameSite=Lax, host-only e Secure em HTTPS. Nenhum token é
  persistido em localStorage. A sessão vence após sete dias, sem extensão
  indefinida, e o cookie não usa cache de sessão.
- Cada operação HTTP e WebSocket valida a sessão. Logout e recuperação de senha
  revogam sessões e fecham sockets; conexões ociosas também são verificadas a
  cada 30 segundos. Upgrade exige a origem exata do jogo.
- Better Auth controla verificação, recuperação, confirmação por e-mail para
  excluir a conta, CSRF, hashing e limites de tentativas. A aplicação mantém as
  permissões sobre saves, amigos e salas. A exclusão confirmada remove os dados
  de jogo no servidor, inclusive participações em rankings compartilhados.
- O service worker nunca armazena `/api/`. Respostas de autenticação não podem
  receber cache do proxy/CDN.
- `ps.last-account` guarda apenas metadados da última conta; `ps.cloud.<uid>`
  continua guardando o save. Continuar offline é uma escolha explícita e não
  concede acesso ao servidor. Sair dessa cópia funciona sem rede e não revoga
  a sessão remota; o logout de uma sessão online exige confirmação do servidor.
  Convidado continua sem persistência.
- Abas com código antigo mantêm a política antiga até o jogador atualizar. A
  troca de autenticação invalida o acesso online antigo, mas não remove saves
  locais. A atualização do jogo continua manual.

## Validação

`cd server && npm test` verifica contas, autorização, cookies, logout com
WebSocket aberto, recuperação, exclusão, limites e migração.

Com servidor local em outbox e Playwright disponível:

```sh
AUTH_TEST_URL=http://localhost:3097/dev.html \
AUTH_TEST_MAIL_DIR=/caminho/privado/data/mail \
node tools/test-auth.cjs
```

O teste de navegador usa somente contas artificiais e exige localhost.

Referências: [Better Auth](https://better-auth.com/docs/installation),
[sessões](https://better-auth.com/docs/concepts/session-management),
[segurança](https://better-auth.com/docs/reference/security) e
[Google](https://better-auth.com/docs/authentication/google).
