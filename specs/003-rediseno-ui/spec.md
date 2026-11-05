# Feature Specification: Rediseño de la interfaz después del login

**Feature Branch**: `003-rediseno-ui`
**Created**: 2026-11-05
**Status**: Aprobado por el dueño (diseño unificado elegido en el hilo del proyecto el 2026-11-05)
**Input**: "Una vez que haces login todo está apeñuzcado y difícil de entender… me da flojera ir a ver
las rutinas; además debería estar tomando los ejercicios de la librería." El dueño eligió el diseño
unificado (maqueta: https://claude.ai/artifact/YYcjtVqFbuXxvAtxAiv2Di) y pidió hacerlo completo.

## Alcance

El login y todas las funciones actuales se conservan. Cambia la presentación y la navegación, y la
librería (`Gym-Exercise-Library`) se vuelve visible y utilizable en la app.

## User Stories

### US1 — Estilo y navegación nueva (P1)
Al entrar, el usuario cae en **Hoy**: su semana, lo que le toca hoy y un botón para empezar. La barra
de abajo tiene **Hoy · Plan · Progreso · Perfil** (Librería se agrega en US2). **Plan** reúne Fuerza,
Core, Cardio, Calistenia y Especial como pestañas de arriba; los ajustes del plan van en un menú "⋯".
**Progreso** reúne historial, actividad extra y peso corporal.

**Aceptación**: post-login abre Hoy; desde Hoy se llega a registrar la primera serie del día con un
toque; ninguna función de la tabla "Dónde queda cada función" de la maqueta se pierde; pruebas
existentes en verde.

### US2 — Librería en la app (P2)
Nombres en español para todos los ejercicios de la librería, láminas donde existan, sección
**Librería** (buscar y filtrar por músculo y equipo) y ficha del ejercicio.

### US3 — Modo entrenando (P3)
Un ejercicio a la vez a pantalla completa, series para palomear, descanso grande con ±15 s y
alternativas a la vista. Usa el mismo guardado de series que hoy.

### US4 — Rutinas con ejercicios de la librería (P4, requiere aprobación de producción)
Cambiar un ejercicio por uno de la librería y que Fuerza/Core generen desde la librería. Requiere
cambio de esquema en producción: **no se aplica sin el "sí" explícito del dueño** (AGENTS.md).

## Fuera de alcance
Cambiar el login, los generadores de Cardio, o borrar/reemplazar IDs legacy de ejercicios.
