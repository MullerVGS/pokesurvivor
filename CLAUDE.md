# PokéSurvivor — cómo se trabaja y se publica

Normas fijas del dueño del proyecto. Se aplican SIEMPRE.

## Publicar una versión
1. Se edita `dev.html` (nunca `index.html`, que se genera).
2. `node tools/build.js && node tools/export_data.js && python tools/make_seo_pages.py`
   - `build.js` genera `index.html`, `js/app.min.js` y **`version.json`** (la huella de esta versión).
3. Commit (sin "Co-Authored-By" ni ninguna firma de IA) y `git push origin main` sólo cuando el dueño lo pida.

## Actualización manual de los jugadores (obligatorio)
`js/core/updater.js` consulta `version.json` cada 5 min y al volver a la pestaña:
- Si hay una versión nueva, aparece **Actualizar juego** en el menú principal.
- Sólo se recarga cuando el jugador pulsa ese botón. No hay cuentas atrás,
  recargas automáticas ni actualizaciones forzadas, tampoco en el menú o en cooperativo.
- Antes de recargar se intenta subir a la nube lo pendiente, conservando la copia local.
  Si el jugador sale del menú mientras espera, se cancela la recarga.
No quitar `updater.js` ni la escritura de `version.json` en `tools/build.js`.

## Novedades (changelog)
Cada cambio de juego o arreglo de fallos va también en `js/data/changelog.js`
(español e inglés, en `new` / `chg` / `fix` de la fecha de hoy). Los cambios de
servidores, base de datos o costes NO van ahí.

## Servidores
- Firebase: proyecto **pokesurvivor-free** (autenticación normal: cuentas gratis sin límite).
  **Nunca** activar "Identity Platform" ni nada que lo active (funciones de bloqueo, MFA,
  "Actualizar para habilitar"): cobra por usuario. El proyecto viejo pokesurvivor-jpter se borró el 13-10-2026 (con su facturación).
- Cloudflare: SÓLO el dominio pokesurvivor.com (comprado allí, DNS gratis). El Worker y el TURN
  (Cloudflare Realtime) se quitaron el 15-10-2026: el cooperativo va sólo con conexión directa
  (STUN gratis de Google). No volver a añadir nada de pago.
- Mantenimiento: `MAINTENANCE` en `js/main.js` (con `?dev` se puede entrar para probar).
