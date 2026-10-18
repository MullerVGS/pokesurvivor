/* Login, verified email and recovery through Better Auth. */
G.LoginUI = (() => {
  const $ = id => document.getElementById(id);
  let mode = 'login', busy = false, resetToken = null, needsVerification = false;
  const note = text => { $('login-note').textContent = G.T(text); };
  const error = text => { $('login-err').textContent = G.T(text); };
  function options() {
    const showGoogle = G.Auth.capabilities.google && ['login', 'register'].includes(mode);
    $('btn-google').classList.toggle('hidden', !showGoogle);
    $('auth-divider').classList.toggle('hidden', !showGoogle);
    $('btn-verify').classList.toggle('hidden', !G.Auth.capabilities.email || !needsVerification);
    $('f-forgot').classList.toggle('hidden', !G.Auth.capabilities.email || mode !== 'login');
    document.querySelector('#scr-login [data-tab=register]').classList.toggle('hidden', !G.Auth.capabilities.email);
  }
  function setMode(next) {
    mode = next;
    document.querySelectorAll('#scr-login [data-tab]').forEach(button => {
      button.classList.toggle('on', button.dataset.tab === mode);
      button.setAttribute('aria-pressed', String(button.dataset.tab === mode));
    });
    $('auth-name').classList.toggle('hidden', mode !== 'register');
    $('auth-email').classList.toggle('hidden', mode === 'reset');
    $('auth-password').classList.toggle('hidden', mode === 'recover');
    $('f-user').disabled = mode !== 'register';
    $('f-email').disabled = mode === 'reset';
    $('f-pass').disabled = mode === 'recover';
    $('f-user').required = mode === 'register';
    $('f-email').required = mode !== 'reset';
    $('f-pass').required = mode !== 'recover';
    $('f-pass').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('f-pass').minLength = mode === 'login' ? 1 : 15;
    $('btn-auth').textContent = G.T({ login: 'Entrar', register: 'Crear cuenta', recover: 'Enviar enlace', reset: 'Guardar contraseña' }[mode]);
    $('auth-password-help').classList.toggle('hidden', !['register', 'reset'].includes(mode));
    $('f-pass').value = ''; needsVerification = false; options(); error(''); note('');
  }
  async function perform(action) {
    if (busy) return;
    busy = true; $('login-form').setAttribute('aria-busy', 'true');
    document.querySelectorAll('#scr-login button').forEach(button => { button.disabled = true; });
    error(''); note('');
    try { await action(); }
    catch (e) {
      if (e.code === 'EMAIL_NOT_VERIFIED') { needsVerification = true; options(); }
      error(G.Auth.errorMessage(e));
    }
    finally {
      busy = false; $('login-form').removeAttribute('aria-busy');
      document.querySelectorAll('#scr-login button').forEach(button => { button.disabled = false; });
    }
  }
  function init() {
    const params = new URLSearchParams(location.search);
    if (params.get('auth') === 'reset' && params.get('token')) resetToken = params.get('token');
    const result = params.get('auth'), failed = params.get('error');
    if (result || failed) {
      params.delete('auth'); params.delete('token'); params.delete('error'); params.delete('error_description');
      history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
    }
    document.querySelectorAll('#scr-login [data-tab]').forEach(button => { button.onclick = () => { if (!busy) setMode(button.dataset.tab); }; });
    $('login-form').onsubmit = event => {
      event.preventDefault();
      perform(async () => {
        const email = $('f-email').value, password = $('f-pass').value;
        if (mode === 'register') {
          await G.Auth.signUp($('f-user').value, email, password);
          setMode('login'); needsVerification = true; options(); note('Revisa tu correo y verifica tu dirección para entrar.');
        } else if (mode === 'recover') {
          await G.Auth.recover(email);
          note('Si existe una cuenta con ese correo, recibirás un enlace para elegir una contraseña nueva.');
        } else if (mode === 'reset') {
          await G.Auth.reset(resetToken, password);
          resetToken = null; setMode('login'); note('Contraseña guardada. Ya puedes entrar.');
        } else {
          const user = await G.Auth.signIn(email, password);
          await G.DB.openAccount(user);
          $('f-pass').value = ''; G.Flow.afterLogin();
        }
      });
    };
    $('f-forgot').onclick = () => setMode('recover');
    $('btn-verify').onclick = () => {
      if (!$('f-email').reportValidity() || !$('f-email').value) return;
      perform(async () => { await G.Auth.verify($('f-email').value); note('Si hace falta verificar esa cuenta, recibirás un correo.'); });
    };
    $('btn-google').onclick = () => perform(() => G.Auth.google());
    $('btn-guest').onclick = () => { if (!busy) { G.DB.playAsGuest(); G.Flow.afterLogin(); } };
    $('btn-offline').onclick = () => { if (!busy && G.DB.playOffline()) G.Flow.afterLogin(); };
    $('btn-import').onclick = () => { location.href = '/importar/'; };
    setMode(resetToken ? 'reset' : 'login');
    if (failed || result === 'error') error(G.Auth.errorMessage({ code: failed }));
    else if (result === 'verified') note('Correo verificado. Ya puedes entrar.');
    else if (result === 'deleted') note('Cuenta borrada.');
  }
  function open() {
    G.UI.chrome(false); G.UI.show('scr-login');
    options();
    const cached = G.Auth.cached();
    let hasCopy = false;
    try { hasCopy = !!(cached && localStorage.getItem('ps.cloud.' + cached.id)); } catch { /* storage unavailable */ }
    $('btn-offline').classList.toggle('hidden', !hasCopy);
    $('login-mode').textContent = G.T(G.Auth.state === 'offline'
      ? 'Sin conexión. Puedes jugar como invitado o continuar con una copia local.'
      : 'Entra para guardar tu progreso y jugar con amigos. Como invitado no se guarda.');
    try {
      const imported = JSON.parse(localStorage.getItem('ps.import') || 'null');
      if (imported?.save?.name) {
        $('f-user').value = imported.save.name.slice(0, 16);
        note('Hay una partida importada. Se añadirá a la cuenta con la que entres.');
      }
    } catch { /* no import */ }
    setTimeout(() => (mode === 'reset' ? $('f-pass') : $('f-email')).focus(), 50);
  }
  return { init, open, get pendingReset() { return !!resetToken; } };
})();
