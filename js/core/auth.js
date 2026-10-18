/* Better Auth client: only public user information is kept in JavaScript. */
G.Auth = (() => {
  const CACHE = 'ps.last-account';
  let user = null, state = 'loading', capabilities = { email: false, google: false };
  const listeners = new Set();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('ps.auth') : null;
  const callback = () => location.origin + location.pathname;
  function cached() {
    try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch { return null; }
  }
  function update(next, status = next ? 'authenticated' : 'anonymous') {
    user = next; state = status;
    if (next) try { localStorage.setItem(CACHE, JSON.stringify({ id: next.id, name: next.name, email: next.email })); } catch { /* storage unavailable */ }
    for (const fn of listeners) fn(user);
  }
  async function request(route, body) {
    let response;
    try {
      response = await fetch('/api/auth/' + route, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000)
      });
    } catch { throw Object.assign(new Error('Sin conexión con el servidor.'), { code: 'NETWORK_ERROR' }); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.message || 'No se pudo completar la operación.'), { code: data.code || (response.status === 429 ? 'TOO_MANY_REQUESTS' : 'AUTH_ERROR') });
    return data;
  }
  async function refresh() {
    try {
      const data = await request('get-session');
      update(data?.user?.emailVerified ? data.user : null);
      return user;
    } catch (error) {
      if (error.code === 'NETWORK_ERROR') { update(null, 'offline'); return null; }
      throw error;
    }
  }
  async function ready() {
    // Old bearer tokens and browser passwords are no longer credentials. Saves stay intact.
    try { for (const key of ['psfb.auth', 'ps.accounts', 'ps.session']) localStorage.removeItem(key); } catch { /* storage unavailable */ }
    try {
      const response = await fetch('/api/account/config', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (response.ok) capabilities = await response.json();
      return await refresh();
    } catch { update(null, 'offline'); return null; }
  }
  async function signIn(email, password) {
    await request('sign-in/email', { email: email.trim(), password });
    await refresh(); channel?.postMessage('changed');
    return user;
  }
  async function signUp(name, email, password) {
    await request('sign-up/email', { name: name.trim(), email: email.trim(), password, callbackURL: callback() + '?auth=verified' });
  }
  async function signOut() {
    await request('sign-out', {});
    try { localStorage.removeItem(CACHE); } catch { /* storage unavailable */ }
    update(null); channel?.postMessage('changed');
  }
  async function google(link = false) {
    const result = await request(link ? 'link-social' : 'sign-in/social', {
      provider: 'google', callbackURL: callback(), errorCallbackURL: callback() + '?auth=error'
    });
    if (result.url) location.assign(result.url);
  }
  function errorMessage(error) {
    const messages = {
      INVALID_EMAIL_OR_PASSWORD: 'Correo o contraseña incorrectos.',
      EMAIL_NOT_VERIFIED: 'Verifica tu correo antes de entrar. Revisa tu bandeja de entrada.',
      USER_ALREADY_EXISTS: 'No se pudo crear la cuenta. Prueba a entrar o recuperar el acceso.',
      USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'No se pudo crear la cuenta. Prueba a entrar o recuperar el acceso.',
      PASSWORD_TOO_SHORT: 'Usa una contraseña de al menos 15 caracteres.',
      PASSWORD_TOO_LONG: 'La contraseña puede tener hasta 128 caracteres.',
      INVALID_TOKEN: 'El enlace ha caducado o ya se ha usado. Solicita otro.',
      TOKEN_EXPIRED: 'El enlace ha caducado o ya se ha usado. Solicita otro.',
      ACCOUNT_NOT_LINKED: 'Verifica tu correo o recupera el acceso antes de vincular Google.',
      OAUTH_EMAIL_NOT_VERIFIED: 'Google no ha confirmado ese correo. Usa una cuenta verificada.',
      ACCESS_DENIED: 'Se canceló el acceso con Google. Puedes volver a intentarlo.',
      STATE_MISMATCH: 'La sesión de acceso ha caducado. Pulsa Google para empezar de nuevo.',
      STATE_NOT_FOUND: 'La sesión de acceso ha caducado. Pulsa Google para empezar de nuevo.',
      INVALID_CODE: 'No se pudo validar el acceso con Google. Inténtalo de nuevo.',
      EMAIL_DOES_NOT_MATCH: 'Elige la cuenta de Google con el mismo correo que tu cuenta del juego.',
      TOO_MANY_REQUESTS: 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.',
      NETWORK_ERROR: 'Sin conexión con el servidor.',
      SESSION_EXPIRED: 'Vuelve a iniciar sesión para continuar.',
      UNAUTHORIZED: 'Vuelve a iniciar sesión para continuar.',
      SIGNUP_DISABLED: 'El registro aún no está disponible.'
    };
    return messages[String(error?.code || '').toUpperCase()] || 'No se pudo completar la operación. Inténtalo de nuevo.';
  }
  if (channel) channel.onmessage = () => refresh().catch(() => {});
  addEventListener('focus', () => { if (state !== 'loading') refresh().catch(() => {}); });
  return {
    ready, refresh, signIn, signUp, signOut, google, errorMessage, cached,
    recover: email => request('request-password-reset', { email: email.trim(), redirectTo: callback() + '?auth=reset' }),
    async reset(token, newPassword) {
      await request('reset-password', { token, newPassword });
      await refresh(); channel?.postMessage('changed');
    },
    verify: email => request('send-verification-email', { email: email.trim(), callbackURL: callback() + '?auth=verified' }),
    deleteAccount: () => request('delete-user', { callbackURL: callback() + '?auth=deleted' }),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    expire() { update(null); },
    get user() { return user; }, get state() { return state; }, get capabilities() { return capabilities; }
  };
})();
