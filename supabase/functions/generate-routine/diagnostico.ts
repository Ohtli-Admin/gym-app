// Validación determinista + diagnóstico acotado de generate-routine.
// -----------------------------------------------------------------------
// Módulo puro (sin Deno/Supabase/red) para poder probarlo con
// `node --test` — ver diagnostico.test.mjs. Solo usa sintaxis TypeScript
// "borrable" (tipos, sin enums) para que Node pueda ejecutarlo tal cual.
//
// Regla de privacidad del diagnóstico: NUNCA incluye el texto médico del
// usuario, su intención libre, el perfil completo ni la respuesta del
// modelo. Solo códigos, conteos, booleanos, stop_reason y tiempos.
// -----------------------------------------------------------------------

// Categorías de error de validación (una por regla determinista).
export const ERROR_VALIDACION = {
  RUTINA_SIN_DIAS: "RUTINA_SIN_DIAS",
  DIAS_EXCEDIDOS: "DIAS_EXCEDIDOS",
  EJERCICIO_ID_INVALIDO: "EJERCICIO_ID_INVALIDO",
  CONTRAINDICADO: "CONTRAINDICADO",
  EQUIPO_NO_DISPONIBLE: "EQUIPO_NO_DISPONIBLE",
  SERIES_FUERA_DE_RANGO: "SERIES_FUERA_DE_RANGO",
  RUTINA_SIN_EJERCICIOS: "RUTINA_SIN_EJERCICIOS",
} as const;

// Resultado de cada intento / motivo final del fallo.
export const RESULTADO = {
  OK: "OK",
  OK_PARCIAL: "OK_PARCIAL", // válida, pero con menos días de los pedidos
  TRUNCADO_MAX_TOKENS: "TRUNCADO_MAX_TOKENS", // stop_reason=max_tokens y sin `dias` utilizable
  SIN_TOOL_INPUT: "SIN_TOOL_INPUT", // el modelo no devolvió bloque tool_use
  DIAS_AUSENTES: "DIAS_AUSENTES", // hay tool input pero `dias` falta o no es arreglo
  DIAS_DEGENERADOS: "DIAS_DEGENERADOS", // más de 10 días: respuesta sin sentido
  VALIDACION_FALLIDA: "VALIDACION_FALLIDA", // ver ERROR_VALIDACION en errores_por_categoria
  ERROR_API_MODELO: "ERROR_API_MODELO", // la API de Claude respondió no-2xx
  PERFIL_NO_ENCONTRADO: "PERFIL_NO_ENCONTRADO",
  CATALOGO_NO_DISPONIBLE: "CATALOGO_NO_DISPONIBLE",
  CATALOGO_ABDOMEN_INSUFICIENTE: "CATALOGO_ABDOMEN_INSUFICIENTE",
  PERSISTENCIA_RUTINA_FALLIDA: "PERSISTENCIA_RUTINA_FALLIDA",
  PERSISTENCIA_EJERCICIOS_FALLIDA: "PERSISTENCIA_EJERCICIOS_FALLIDA",
  ERROR_INESPERADO: "ERROR_INESPERADO",
} as const;

export type ErrorValidacion = { codigo: string; texto: string };

export const MAX_DIAS_CORDURA = 10;

// Movida sin cambios de reglas desde index.ts; ahora cada error lleva su
// categoría para poder contarla en el diagnóstico. El `texto` sigue siendo
// el mismo mensaje que se le devuelve al modelo en el reintento corrector.
export function validarRutina(rutina: any, catalogo: any[], perfil: any): ErrorValidacion[] {
  const errores: ErrorValidacion[] = [];
  const catalogoPorId = new Map(catalogo.map((e) => [e.exercise_id, e]));
  const lesiones = new Set(perfil.lesiones || []);
  const equipoDisponible = new Set(perfil.equipo_disponible || []);

  const dias = rutina?.dias || [];
  if (dias.length === 0) {
    errores.push({ codigo: ERROR_VALIDACION.RUTINA_SIN_DIAS, texto: "La rutina no tiene ningún día definido." });
  }

  // El día-contrato es: exactamente `dias_disponibles` es lo preferido y lo
  // que se sigue pidiendo explícitamente en el prompt. Generar MÁS días de
  // los pedidos sigue siendo un error duro. Generar MENOS no se rechaza
  // aquí, pero el llamador lo marca explícitamente como PARCIAL (ver
  // `rutinaEsParcial` en index.ts) — nunca como éxito normal silencioso.
  if (perfil.dias_disponibles && dias.length > perfil.dias_disponibles) {
    errores.push({
      codigo: ERROR_VALIDACION.DIAS_EXCEDIDOS,
      texto: `Se esperaban máximo ${perfil.dias_disponibles} días, la rutina trae ${dias.length}.`,
    });
  }

  let vistos = 0;
  for (const dia of dias) {
    for (const ej of dia.ejercicios || []) {
      vistos++;
      const catEj = catalogoPorId.get(ej.exercise_id);
      if (!catEj) {
        errores.push({
          codigo: ERROR_VALIDACION.EJERCICIO_ID_INVALIDO,
          texto: `Día ${dia.dia}: '${ej.exercise_id}' no existe en el catálogo.`,
        });
        continue;
      }
      // Determinista en código, pero solo activo cuando el catálogo trae
      // `contraindicaciones` poblado — hoy prácticamente nunca (ver
      // "LÍMITES DE SEGURIDAD" en index.ts). No encontrar nada aquí NO es
      // evidencia de que la rutina sea segura para la condición del usuario.
      const contraindicado = (catEj.contraindicaciones || []).filter((c: string) => lesiones.has(c));
      if (contraindicado.length > 0) {
        errores.push({
          codigo: ERROR_VALIDACION.CONTRAINDICADO,
          texto: `Día ${dia.dia}: '${catEj.nombre}' contraindicado para: ${contraindicado.join(", ")}.`,
        });
      }
      if (equipoDisponible.size > 0 && !equipoDisponible.has(catEj.equipo)) {
        errores.push({
          codigo: ERROR_VALIDACION.EQUIPO_NO_DISPONIBLE,
          texto: `Día ${dia.dia}: '${catEj.nombre}' requiere equipo no disponible (${catEj.equipo}).`,
        });
      }
      if (typeof ej.series !== "number" || ej.series < 1 || ej.series > 6) {
        errores.push({
          codigo: ERROR_VALIDACION.SERIES_FUERA_DE_RANGO,
          texto: `Día ${dia.dia}: series fuera de rango para '${ej.exercise_id}' (${ej.series}).`,
        });
      }
    }
  }
  if (vistos === 0) {
    errores.push({ codigo: ERROR_VALIDACION.RUTINA_SIN_EJERCICIOS, texto: "La rutina no incluye ningún ejercicio." });
  }

  return errores;
}

// ¿La respuesta del modelo tiene la forma mínima para siquiera validarla?
// Devuelve null si sí, o el código RESULTADO que explica por qué no.
export function clasificarFormaRespuesta(input: any, stopReason: string | null): string | null {
  const diasUsables = input && Array.isArray(input.dias) && input.dias.length <= MAX_DIAS_CORDURA;
  if (diasUsables) return null;
  if (stopReason === "max_tokens") return RESULTADO.TRUNCADO_MAX_TOKENS;
  if (!input) return RESULTADO.SIN_TOOL_INPUT;
  if (!Array.isArray(input.dias)) return RESULTADO.DIAS_AUSENTES;
  return RESULTADO.DIAS_DEGENERADOS;
}

export function contarPorCategoria(errores: ErrorValidacion[]): Record<string, number> {
  const conteo: Record<string, number> = {};
  for (const e of errores) conteo[e.codigo] = (conteo[e.codigo] || 0) + 1;
  return conteo;
}

export type IntentoDiagnostico = {
  intento: number;
  resultado: string;
  stop_reason: string | null;
  tiene_tool_input: boolean;
  claves_tool_input: string[]; // solo NOMBRES de campos, nunca valores
  dias_generados: number | null;
  truncado: boolean;
  total_errores: number;
  errores_por_categoria: Record<string, number>;
  input_tokens: number | null;
  output_tokens: number | null;
  http_status_modelo: number | null;
  ms: number;
};

export function describirIntento(params: {
  intento: number;
  resultado: string;
  input: any;
  stopReason: string | null;
  errores?: ErrorValidacion[];
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  httpStatusModelo?: number | null;
  ms: number;
}): IntentoDiagnostico {
  const { input, errores = [] } = params;
  const esObjeto = input !== null && typeof input === "object";
  return {
    intento: params.intento,
    resultado: params.resultado,
    stop_reason: params.stopReason ?? null,
    tiene_tool_input: esObjeto,
    claves_tool_input: esObjeto ? Object.keys(input).slice(0, 10) : [],
    dias_generados: esObjeto && Array.isArray(input.dias) ? input.dias.length : null,
    truncado: params.stopReason === "max_tokens",
    total_errores: errores.length,
    errores_por_categoria: contarPorCategoria(errores),
    input_tokens: params.usage?.input_tokens ?? null,
    output_tokens: params.usage?.output_tokens ?? null,
    http_status_modelo: params.httpStatusModelo ?? null,
    ms: params.ms,
  };
}

// Id corto para correlacionar la consola del navegador con los logs de la
// Edge Function. No derivado de ningún dato del usuario.
export function nuevoIdDiagnostico(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function textoAcotado(texto: unknown, max = 200): string {
  return String(texto ?? "").slice(0, max);
}
