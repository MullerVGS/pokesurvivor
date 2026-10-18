/* A separate page keeps a new Google identity from creating a second game save. */
(() => {
  const token = location.hash.slice(1), oauthError = new URLSearchParams(location.search).get('error');
  history.replaceState(null, '', location.pathname);
  const language = navigator.language.startsWith('pt') ? 'pt' : navigator.language.startsWith('es') ? 'es' : 'en';
  const text = {
    pt: { title:'Ativar conta da beta',description:'Recupere sua conta e continue de onde parou.',checking:'Conferindo seu link…',
      google:'Continuar com Google',other:'Escolher outra conta Google',activate:'Ativar {name}',account:'Conta: {name}',
      signed:'Você está conectado como {email}.',ready:'Confira a conta Google acima e confirme para recuperar seu progresso.',
      start:'Entre com Google para vincular essa conta e recuperar seu progresso.',back:'Voltar ao jogo',footer:'Este link é pessoal e só pode ser usado uma vez.',
      invalid:'Este link venceu, já foi usado ou foi substituído. Peça um novo link ao Arthur.',
      expired:'Esta etapa expirou. Abra novamente o link que você recebeu.',
      progress:'Essa conta Google já está ligada a outra partida. Escolha outra conta Google ou fale com o Arthur.',
      changed:'A conta mudou em outra aba. Confira os dados novamente antes de confirmar.',
      fresh:'Entre com Google novamente para confirmar que a conta é sua.',
      required:'Use uma conta Google verificada para ativar sua partida.',
      unavailable:'O login Google não está disponível agora. Tente novamente mais tarde.',
      cancelled:'O login Google não foi concluído. Você pode tentar novamente.',
      rate:'Muitas tentativas. Aguarde um minuto e tente novamente.',network:'Sem conexão com o servidor. Tente novamente.',
      failed:'Não foi possível concluir. Tente novamente.',done:'Conta ativada! Abrindo seu jogo…' },
    es: { title:'Activar cuenta de la beta',description:'Recupera tu cuenta y continúa donde lo dejaste.',checking:'Comprobando tu enlace…',
      google:'Continuar con Google',other:'Elegir otra cuenta de Google',activate:'Activar {name}',account:'Cuenta: {name}',
      signed:'Has entrado como {email}.',ready:'Comprueba la cuenta de Google y confirma para recuperar tu progreso.',
      start:'Entra con Google para vincular esta cuenta y recuperar tu progreso.',back:'Volver al juego',footer:'Este enlace es personal y solo se puede usar una vez.',
      invalid:'Este enlace ha caducado, ya se ha usado o se ha sustituido. Pide otro a Arthur.',
      expired:'Esta sesión ha caducado. Abre de nuevo el enlace que recibiste.',
      progress:'Esta cuenta de Google ya tiene otra partida. Elige otra cuenta de Google o contacta con Arthur.',
      changed:'La cuenta cambió en otra pestaña. Comprueba los datos antes de confirmar.',fresh:'Vuelve a entrar con Google para confirmar tu cuenta.',
      required:'Usa una cuenta de Google verificada para activar tu partida.',unavailable:'Google no está disponible ahora. Inténtalo más tarde.',
      cancelled:'No se completó el acceso con Google. Puedes volver a intentarlo.',rate:'Demasiados intentos. Espera un minuto.',
      network:'Sin conexión con el servidor. Inténtalo de nuevo.',failed:'No se pudo completar. Inténtalo de nuevo.',done:'¡Cuenta activada! Abriendo el juego…' },
    en: { title:'Activate your beta account',description:'Recover your account and pick up where you left off.',checking:'Checking your link…',
      google:'Continue with Google',other:'Choose another Google account',activate:'Activate {name}',account:'Account: {name}',
      signed:'You are signed in as {email}.',ready:'Check the Google account above and confirm to recover your progress.',
      start:'Sign in with Google to link this account and recover your progress.',back:'Back to the game',footer:'This link is personal and can only be used once.',
      invalid:'This link expired, was already used or was replaced. Ask Arthur for a new link.',
      expired:'This step expired. Open the link you received again.',
      progress:'This Google account already has another save. Choose another Google account or contact Arthur.',
      changed:'The account changed in another tab. Check the details again before confirming.',fresh:'Sign in with Google again to confirm your account.',
      required:'Use a verified Google account to activate your save.',unavailable:'Google sign-in is currently unavailable. Try again later.',
      cancelled:'Google sign-in was not completed. You can try again.',rate:'Too many attempts. Wait a minute and try again.',
      network:'Cannot reach the server. Try again.',failed:'Could not complete this action. Try again.',done:'Account activated! Opening your game…' }
  }[language];
  const $ = id => document.getElementById(id);
  const format = (key, values) => text[key].replace(/\{(\w+)\}/g, (_, name) => values[name]);
  let current = null, busy = false, pendingInit = null;
  document.documentElement.lang = language;
  document.title = 'PokéSurvivor · ' + text.title;
  for (const id of ['title','description','back','footer']) $(id).textContent = text[id];
  $('status').textContent = text.checking;
  function message(value, error = false) { $('status').textContent = value; $('status').classList.toggle('error', error); }
  function errorText(code) {
    return text[({ACTIVATION_LINK_INVALID:'invalid',ACTIVATION_SESSION_EXPIRED:'expired',ACCOUNT_HAS_PROGRESS:'progress',
      ACTIVATION_CHANGED:'changed',SESSION_NOT_FRESH:'fresh',UNAUTHORIZED:'fresh',GOOGLE_REQUIRED:'required',
      GOOGLE_UNAVAILABLE:'unavailable',TOO_MANY_REQUESTS:'rate',NETWORK_ERROR:'network'})[code] || 'failed'];
  }
  async function request(route, body) {
    let response;
    try {
      response = await fetch('/api/auth/' + route, { method:body===undefined?'GET':'POST', credentials:'same-origin', cache:'no-store',
        headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000) });
    } catch { throw {code:'NETWORK_ERROR'}; }
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw {code:response.status===429?'TOO_MANY_REQUESTS':data.code};
    return data;
  }
  async function refresh() {
    current = await request('beta-activation/status');
    $('title').textContent = format('account',{name:current.account.name});
    $('identity').hidden = !current.user;
    $('identity').textContent = current.user ? format('signed',{email:current.user.email}) : '';
    $('google').hidden = false; $('google').textContent = text[current.user?'other':'google'];
    $('activate').textContent = format('activate',{name:current.account.name});
    $('activate').hidden = !current.canActivate;
    message(current.canActivate ? text.ready : current.user ? errorText(current.code) : text.start, !!current.user && !current.canActivate);
  }
  async function perform(action) {
    if (busy) return;
    busy = true; $('google').disabled = $('activate').disabled = true;
    try { await action(); }
    catch (error) {
      if (error.code === 'ACTIVATION_CHANGED') { try { await refresh(); } catch { /* keep the original explanation */ } }
      if (['ACTIVATION_LINK_INVALID','ACTIVATION_SESSION_EXPIRED'].includes(error.code)) $('google').hidden = $('activate').hidden = true;
      if (['SESSION_NOT_FRESH','UNAUTHORIZED','ACCOUNT_HAS_PROGRESS'].includes(error.code)) $('activate').hidden = true;
      message(errorText(error.code),true);
    } finally {
      busy = false; $('google').disabled = $('activate').disabled = false;
      if (pendingInit) { const next = pendingInit; pendingInit = null; initialize(next.token, next.error); }
    }
  }
  $('google').onclick = () => perform(async () => {
    const callback = location.origin + '/ativar/';
    const result = await request('sign-in/social',{provider:'google',callbackURL:callback,errorCallbackURL:callback,additionalParams:{prompt:'select_account'}});
    if (!result.url) throw {};
    location.assign(result.url);
  });
  $('activate').onclick = () => perform(async () => {
    await request('beta-activation/complete',{accountId:current.account.id,userId:current.user.id});
    message(text.done); location.replace('/');
  });
  function initialize(linkToken, error) {
    if (busy) { pendingInit = {token:linkToken,error}; return; }
    current = null; $('google').hidden = $('activate').hidden = $('identity').hidden = true;
    $('title').textContent = text.title; message(text.checking);
    perform(async () => {
      if (linkToken) await request('beta-activation/begin',{token:linkToken});
      await refresh();
      if (error) message(text.cancelled,true);
    });
  }
  addEventListener('hashchange', () => {
    const next = location.hash.slice(1);
    history.replaceState(null, '', location.pathname);
    if (next) initialize(next);
  });
  initialize(token, oauthError);
})();
