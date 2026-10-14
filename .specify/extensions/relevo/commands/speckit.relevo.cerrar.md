---
description: "Actualiza tasks.md y ESTADO.md, hace commit y push y deja el siguiente paso escrito"
---

# Cerrar turno (relevo)

Corre después de cada comando de Spec Kit y **siempre antes de terminar tu turno**, aunque
la tarea no esté acabada o te estés quedando sin cuota. El siguiente agente sólo verá lo que
quede subido.

1. **tasks.md**: marca `- [x]` sólo las tareas cuyo criterio comprobaste (prueba, build o paso
   manual con resultado). Lo que quedó a medias sigue en `- [ ]`.
2. **Descripción del PR** de la rama (créalo en borrador si no existe) con este bloque, que
   reemplaza al anterior:

   ```
   ## Relevo
   - Agente: claude | codex · Fecha: AAAA-MM-DD
   - Hecho: T0XX, T0YY (pruebas: <comando> → <resultado real>)
   - Siguiente paso: <acción concreta, archivo y comando>
   - Ojo: <lo que falló o la duda abierta>
   ```
   Si el repo trabaja directo en `main` (lo dice su `AGENTS.md`), este bloque va en la
   sección "En curso" de `ESTADO.md` en vez del PR.
3. **ESTADO.md** (en la misma rama; llega a `main` con el merge): actualiza "Último cierre",
   "Sigue" y "Esperando al dueño". Máximo 40 líneas; la historia vive en git.
4. `git add` sólo los archivos de la tarea (revisa `git status`), commit con mensaje real y
   `git push -u origin <rama>`. Nunca a `main` salvo que `AGENTS.md` lo permita.
5. Responde en máximo 8 líneas: resultado, pruebas, riesgos, lo que necesitas del dueño y
   el link del PR.

Nunca marques hecho algo sin comprobar ni escribas secretos o datos de terceros en
`ESTADO.md` o en el PR.
