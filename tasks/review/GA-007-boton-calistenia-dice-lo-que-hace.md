# [GA-007] El botón de Calistenia dice lo que hace

- **Status:** REVIEW
- **Agent/Owner:** Claude (skill `cierre-de-tarea`)

## Objective

En el hub de Entrenamiento, el botón de Calistenia dice "Ver rutina" cuando
ya hay una rutina de Calistenia preparada, en vez de "Crear sesión" (que
hoy reanuda, no crea).

## Context

Hallazgo menor de la aceptación manual de GA-006
(`tasks/done/GA-006-exercise-library-provider-v0.1.md`, escenario 2, y
`specs/001-ga006-closure/tasks.md` T010): "Crear sesión" reanuda la sesión
existente. Las tarjetas de planes ya usan "Ver plan" / "Crear plan".

## Scope

- La etiqueta del botón `#btn-calistenia` en `renderEntrenamiento()`
  depende de `reanudar.preparedOrigin === 'calistenia'`.
- Una prueba de regresión sobre el texto de `app.js`.

## Out of scope

- Cambiar a dónde navega el botón.
- Los banners "Sesión en curso" / "Rutina preparada".
- El botón de Entrenamiento especial y cualquier otro texto.

## Acceptance criteria

- [x] Sin rutina de Calistenia preparada, el botón dice "Crear sesión".
- [x] Con rutina de Calistenia preparada, el botón dice "Ver rutina".
- [x] `node --test` pasa completo.
- [ ] Aceptación manual en el navegador por el usuario.

## Allowed files/areas

`app.js` (sólo la tarjeta de Calistenia en `renderEntrenamiento`),
`tools/app-hub-calistenia.test.mjs`, este archivo.

## Dependencies

GA-006 (session slots y `getResumeState`).

## Required validations

Prueba nueva `tools/app-hub-calistenia.test.mjs`, suite completa
`node --test`, `node --check app.js`, `git diff --check`. Después, la
aceptación manual del usuario.

## Result

**Archivos modificados:**
- `app.js`: la etiqueta de `#btn-calistenia` es
  `reanudar.preparedOrigin === 'calistenia' ? 'Ver rutina' : 'Crear sesión'`
  (una línea).
- `tools/app-hub-calistenia.test.mjs`: prueba nueva (2 casos). Falló antes
  del cambio (1 de 2) y pasa después.
- Este archivo.

**Validaciones:** `node --test` 128/128 (126 existentes + 2 nuevas).
`node --check app.js` y `git diff --check` limpios.

**Riesgos:** ninguno conocido. El botón sigue navegando igual
(`irAPantalla('calistenia')`); sólo cambia el texto.

**Pendiente del usuario (aceptación manual, 3 pasos):**
1. Entrenamiento → Calistenia → genera una rutina y vuelve al hub sin empezarla.
2. El botón de Calistenia dice "Ver rutina" y la tarjeta "Rutina preparada".
3. Empieza y termina esa sesión; al volver al hub el botón dice "Crear sesión".
