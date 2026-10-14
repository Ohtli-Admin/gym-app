---
name: speckit-relevo-retomar
description: Lee ESTADO.md, ramas y PRs en curso y decide si continuar o empezar
compatibility: Requires spec-kit project structure with .specify/ directory
metadata:
  author: Ohtli-Admin
  source: relevo:commands/speckit.relevo.retomar.md
---

# Retomar (relevo)

Corre antes de `specify` y de `implement`. Sirve igual para Claude que para Codex.

1. `git fetch origin` y `git status`. Si hay cambios sin commit que no son tuyos, detente y
   dilo en una línea.
2. Lee `ESTADO.md` en la raíz.
3. Busca trabajo en curso: PRs abiertos (`gh pr list` o `gh api repos/{owner}/{repo}/pulls`)
   y su bloque **Relevo** en la descripción. Si no hay `gh`, usa `git branch -r` y el
   `ESTADO.md` de esas ramas. En repos que trabajan directo en `main`, lo en curso está en
   la sección "En curso" de `ESTADO.md`.
4. Decide sin preguntar:
   - **Hay una tarea en curso** (PR abierto con "Siguiente paso"): cámbiate a esa rama,
     `git pull`, y continúa desde el siguiente paso. Nunca dupliques una rama.
   - **No hay nada en curso**: toma la primera tarea de "Sigue" en `ESTADO.md` cuyo
     prerrequisito esté hecho. Crea la rama según las reglas de `AGENTS.md`.
   - **Antes de `specify`**: si ya hay una funcionalidad sin terminar en `specs/`, avísalo en
     una línea; abrir otra en paralelo exige que el dueño lo pida.
5. Si la tarea está marcada **Requiere aprobación** y no hay un "sí" del dueño en el PR o
   en el chat, prepárala hasta antes del paso irreversible y detente ahí.
6. Di en máximo 3 líneas: qué tarea tomas, en qué rama y cuál es tu criterio de terminado.