-- Permite saber cuántas veces has hecho el "Día 1", "Día 2", etc. de tu
-- rutina, y si ya completaste todos los días de la semana actual.
alter table sesiones_entrenamiento add column if not exists dia integer;
