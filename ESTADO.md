# Estado — GymApp

Actualizado: 2026-10-14 por claude · Prioridad: activo
Lo mantiene `speckit-relevo-cerrar`. Máximo 40 líneas; la historia vive en git.

## Último cierre
- 2026-10-12 — GA-007: el botón de Calistenia dice "Ver rutina" si ya hay una preparada (PR #4).
- 2026-10-10 — Reglas anti-desperdicio para agentes (PR #3).
- 2026-10-09 — El plan de Fuerza ya no desaparece al recargar (PR #2).

## En curso
- Rama `002-legacy-exercise-census` (sin PR): spec y plan del censo de referencias legacy de ejercicios, del 2 oct; le faltan `tasks.md` y `analyze`. Va 8 commits detrás de `main`.

## Sigue
1. Spec 002 censo legacy: traer `main` a la rama, `speckit-clarify` si quedan dudas, `speckit-tasks`, `speckit-analyze` y abrir PR para que el dueño apruebe spec y plan.
2. Implementar el censo (sólo lectura de la base; no toca producción).
3. (Propuesto, el dueño decide el orden) CI para GymApp (hoy las pruebas no corren solas en cada PR).
4. (Propuesto) Migrar el motor de rutinas a salida JSON Schema antes de subir de modelo (ver skill `motor-ia-confiable`).

## Esperando al dueño
- Aprobar spec y plan de la 002 cuando llegue el PR.
- El conector de Supabase de este proyecto no ve la cuenta de GymApp (segunda cuenta free).

## Avance por funcionalidad
| Spec | Tareas |
|---|---|
| 001 cierre GA-006 | 16/16 |
| 002 censo legacy | spec y plan, sin tareas |
