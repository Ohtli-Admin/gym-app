# Plan: Rediseño de la interfaz (003)

- **Código**: `app.js` (script clásico), `styles.css`, `index.html`; módulos de `src/` sin cambios de
  lógica en US1.
- **US1**: la pantalla `entrenamiento` pasa a ser **Hoy** (se conserva el nombre interno porque
  `src/today-experience` navega a ella al salir de una sesión). `encabezadoProducto()` deja de ser
  "‹ Entrenamiento" y pinta el encabezado de Plan con pestañas de producto. Historial/extra/peso
  corporal comparten encabezado de Progreso. Estilo: tokens nuevos + Barlow / Barlow Condensed
  (Google Fonts, con respaldo del sistema).
- **US2**: `names.es` se agrega en la librería (repo canónico); `tools/sync-exercise-library.mjs`
  trae el catálogo; láminas reducidas como snapshot propio de GymApp.
- **US3**: reemplaza la vista de `renderRegistro()` sin tocar las escrituras a `series_registradas`.
- **US4**: columna nueva aditiva para el id canónico; migración en archivo, sin aplicar.
- **Validación**: `node --test` sobre tools/, src/ y supabase/functions; prueba manual en navegador con
  Supabase simulado (tools/dev-server.mjs).
- **Riesgos**: US1 no toca datos. US3 toca la pantalla que guarda series (se conservan las mismas
  consultas). US4 toca producción (bloqueado hasta aprobación).
