/* ============ firebase-config.js — conexión con tu proyecto de Firebase ============
 * Pega aquí la configuración de tu app web de Firebase (Consola de Firebase >
 * Configuración del proyecto > Tus apps > SDK setup and configuration > Config).
 * Los pasos completos están en docs/FIREBASE.md.
 *
 * Estos datos NO son secretos: Firebase los diseña para ir en la web. Lo que
 * protege las partidas son las reglas de Firestore (firestore.rules).
 *
 * Si se pone a null, el juego funciona en modo local (sólo en el navegador).
 */
// Servidor propio (server/, en la pessoal-vps) en lugar de Firebase: `sdk` hace
// que js/core/db.js cargue js/fb/, que habla con /api del mismo dominio. Sin
// Google: las cuentas son de nombre y contraseña. (El de pokesurvivor.com era
// el proyecto de Firebase pokesurvivor-free.)
G.FIREBASE_CONFIG = {
  apiKey: 'servidor-propio',
  projectId: 'pokesurvivor-duenas',
  databaseURL: 'servidor-propio',
  sdk: '/js/fb/',
  apiBase: '/api',
  google: false
};

/* Ejemplo de cómo debe quedar:
G.FIREBASE_CONFIG = {
  apiKey: 'AIza...',
  authDomain: 'tu-proyecto.firebaseapp.com',
  projectId: 'tu-proyecto',
  storageBucket: 'tu-proyecto.firebasestorage.app',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abc123'
};
*/
