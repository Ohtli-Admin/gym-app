# Extensión de Spec Kit: relevo

Hace que Claude y Codex sean intercambiables. El estado del trabajo vive en el repo
(`ESTADO.md`, `specs/*/tasks.md`, la rama y su PR), así que cualquiera retoma donde
quedó el otro, sin que el dueño explique nada.

Instalar (desde la raíz de un repo con Spec Kit):

    specify extension add --dev <ruta>/spec-kit-relevo

Comandos: `/speckit-relevo-retomar`, `/speckit-relevo-cerrar`, `/speckit-relevo-estado`.
Se disparan solos como hooks de specify, clarify, plan, tasks, analyze, implement y converge.
