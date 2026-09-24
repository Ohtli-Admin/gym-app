// Bucle de intentos de generate-routine (modelo -> forma -> validación ->
// reintento corrector). Puro: la llamada al modelo y la evaluación del
// candidato (traducción de referencias + validarRutina) se inyectan, así
// que se prueba con `node --test` sin red — ver reintentos.test.mjs.
//
// Regla clave: cuando el modelo SÍ hizo la llamada a la herramienta (hay
// tool_use con id e input) pero el input no sirve — falta `dias`, o
// `dias` no es arreglo, o es absurdo — el reintento recibe
// retroalimentación explícita vía tool_result, igual que ya ocurría con
// los errores de validación. Antes ese caso reintentaba "a ciegas" con la
// misma conversación. Solo el truncado real (stop_reason=max_tokens) y la
// ausencia total de tool_use siguen reintentando sin corrección: ahí no
// hay una llamada completa que se pueda reproducir.
import {
  MAX_DIAS_CORDURA,
  RESULTADO,
  clasificarFormaRespuesta,
  describirIntento,
  textoAcotado,
  type ErrorValidacion,
  type IntentoDiagnostico,
} from "./diagnostico.ts";

export type RespuestaModelo = {
  input: any;
  stopReason: string | null;
  toolUseId: string | null;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
};

export type EvaluacionCandidato = { errores: ErrorValidacion[]; resultado?: any; parcial?: boolean };

export type ResultadoIntentos = {
  resultado: any | null;
  parcial: boolean;
  motivoFallo: string | null;
  errores: ErrorValidacion[];
};

const NOMBRE_HERRAMIENTA = "generar_rutina";
const CAMPOS_OBLIGATORIOS = ["dias", "resumen"];

// Texto del tool_result corrector para una llamada con forma inválida.
// Solo nombra campos/estructura — nunca repite contenido del usuario.
export function mensajeCorreccionForma(input: any, falloForma: string): string {
  const esObjeto = input !== null && typeof input === "object";
  const faltantes = esObjeto ? CAMPOS_OBLIGATORIOS.filter((c) => !(c in input)) : CAMPOS_OBLIGATORIOS;
  let problema: string;
  if (falloForma === RESULTADO.DIAS_DEGENERADOS) {
    problema = `el campo \`dias\` trae ${input.dias.length} días; el máximo razonable es ${MAX_DIAS_CORDURA} y nunca más de "dias_disponibles".`;
  } else if (faltantes.length > 0) {
    problema = `omitió ${faltantes.length === 1 ? "el campo obligatorio" : "los campos obligatorios"} ${faltantes.map((c) => `\`${c}\``).join(" y ")}.`;
  } else {
    problema = "el campo `dias` no es un arreglo de días.";
  }
  return `Tu llamada anterior a "${NOMBRE_HERRAMIENTA}" no es utilizable: ${problema} ` +
    `Vuelve a llamar a "${NOMBRE_HERRAMIENTA}" con una rutina completa que incluya AMBOS campos \`dias\` (arreglo de días con sus ejercicios) y \`resumen\`. ` +
    `No respondas con texto fuera de la llamada a la herramienta.`;
}

// ¿Se puede responder a esta llamada con un tool_result corrector? Solo si
// el modelo hizo una llamada completa (id + input objeto) y el fallo no es
// un truncado real por max_tokens.
export function admiteCorreccionForma(respuesta: RespuestaModelo, falloForma: string): boolean {
  return falloForma !== RESULTADO.TRUNCADO_MAX_TOKENS &&
    falloForma !== RESULTADO.SIN_TOOL_INPUT &&
    Boolean(respuesta.toolUseId) &&
    respuesta.input !== null && typeof respuesta.input === "object";
}

// Añade el turno del asistente (su tool_use TAL CUAL lo emitió — el input
// original, sin traducir ni mutar) y el tool_result con la corrección.
function agregarCorreccion(mensajes: any[], toolUseId: string, input: any, contenido: string, esError: boolean): void {
  mensajes.push({
    role: "assistant",
    content: [{ type: "tool_use", id: toolUseId, name: NOMBRE_HERRAMIENTA, input }],
  });
  mensajes.push({
    role: "user",
    content: [{ type: "tool_result", tool_use_id: toolUseId, content: contenido, ...(esError ? { is_error: true } : {}) }],
  });
}

export async function ejecutarIntentos(opts: {
  mensajes: any[]; // conversación; se le AÑADEN los turnos correctores
  llamarModelo: (mensajes: any[]) => Promise<RespuestaModelo>;
  // Traduce + valida una COPIA del candidato; nunca debe mutar `candidato`.
  evaluar: (candidato: any) => EvaluacionCandidato;
  // Devuelve el status HTTP si `err` es un error de la API del modelo;
  // null si es cualquier otro error (que se relanza).
  statusErrorApi: (err: unknown) => number | null;
  registrar: (d: IntentoDiagnostico) => void;
  intentosMaximos?: number;
  ahora?: () => number;
}): Promise<ResultadoIntentos> {
  const { mensajes, llamarModelo, evaluar, statusErrorApi, registrar } = opts;
  const intentosMaximos = opts.intentosMaximos ?? 2;
  const ahora = opts.ahora ?? Date.now;

  let errores: ErrorValidacion[] = [];
  let motivoFallo: string | null = null;

  for (let intento = 1; intento <= intentosMaximos; intento++) {
    const inicio = ahora();
    const hayOtroIntento = intento < intentosMaximos;

    let respuesta: RespuestaModelo;
    try {
      respuesta = await llamarModelo(mensajes);
    } catch (err) {
      const status = statusErrorApi(err);
      if (status === null) throw err;
      registrar(describirIntento({
        intento, resultado: RESULTADO.ERROR_API_MODELO, input: null, stopReason: null,
        httpStatusModelo: status, ms: ahora() - inicio,
      }));
      return {
        resultado: null,
        parcial: false,
        motivoFallo: RESULTADO.ERROR_API_MODELO,
        errores: [{ codigo: RESULTADO.ERROR_API_MODELO, texto: textoAcotado((err as Error)?.message) }],
      };
    }
    const { input: candidato, stopReason, toolUseId, usage } = respuesta;

    const falloForma = clasificarFormaRespuesta(candidato, stopReason);
    if (falloForma) {
      registrar(describirIntento({ intento, resultado: falloForma, input: candidato, stopReason, usage, ms: ahora() - inicio }));
      motivoFallo = falloForma;
      errores = [{ codigo: falloForma, texto: `Respuesta inutilizable del modelo (stop_reason=${stopReason}).` }];
      if (hayOtroIntento && admiteCorreccionForma(respuesta, falloForma)) {
        agregarCorreccion(mensajes, toolUseId as string, candidato, mensajeCorreccionForma(candidato, falloForma), true);
      }
      continue;
    }

    const evaluacion = evaluar(candidato);
    if (evaluacion.errores.length === 0) {
      const parcial = Boolean(evaluacion.parcial);
      registrar(describirIntento({
        intento, resultado: parcial ? RESULTADO.OK_PARCIAL : RESULTADO.OK, input: candidato, stopReason, usage, ms: ahora() - inicio,
      }));
      return { resultado: evaluacion.resultado, parcial, motivoFallo: null, errores: [] };
    }

    errores = evaluacion.errores;
    motivoFallo = RESULTADO.VALIDACION_FALLIDA;
    registrar(describirIntento({
      intento, resultado: RESULTADO.VALIDACION_FALLIDA, input: candidato, stopReason, errores, usage, ms: ahora() - inicio,
    }));
    if (hayOtroIntento && toolUseId) {
      // Retroalimentación real con el `candidato` SIN traducir (referencias
      // numéricas originales) para que el modelo reconozca su respuesta.
      agregarCorreccion(
        mensajes,
        toolUseId,
        candidato,
        `Tu rutina anterior no es válida por lo siguiente:\n${errores.map((e) => `- ${e.texto}`).join("\n")}\n` +
          `Corrige ESTOS problemas específicos y vuelve a llamar a "${NOMBRE_HERRAMIENTA}" con una rutina completa y válida. ` +
          `No repitas la misma referencia de ejercicio inválida ni la misma contraindicación.`,
        false, // igual que antes de este cambio: sin is_error
      );
    }
  }

  return { resultado: null, parcial: false, motivoFallo, errores };
}
