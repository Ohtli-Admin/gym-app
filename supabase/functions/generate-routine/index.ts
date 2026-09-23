// Edge Function: generate-routine
// -----------------------------------------------------------------------
// Reemplaza al script routine_engine.py que corríamos en Colab. Ahora vive
// en el servidor de Supabase: la API key de Anthropic NUNCA sale de aquí,
// y solo un usuario autenticado (con su propio perfil ya guardado) puede
// pedir una rutina.
//
// Flujo:
// 1. Verifica que quien llama tiene sesión válida (JWT de Supabase Auth).
// 2. Lee su perfil (peso, edad, metas, lesiones, días, equipo) de la tabla
//    'perfiles'.
// 3. Lee el catálogo de 'ejercicios', filtrado por el equipo disponible del
//    usuario, sin imágenes (igual que hacíamos en Python, para ahorrar
//    tokens).
// 4. Le pide la rutina a Claude, forzando salida estructurada (tool use).
// 5. Valida la respuesta contra el catálogo (IDs existen, equipo
//    disponible, series en rango) y contra 'lesiones' vía el campo
//    'contraindicaciones' del catálogo.
// 6. Si es válida, la guarda en 'rutinas' y 'rutina_ejercicios', y desactiva
//    cualquier rutina anterior del usuario.
//
// LÍMITES DE SEGURIDAD — LEER ANTES DE ASUMIR QUE ESTO ES "VALIDACIÓN
// MÉDICA DETERMINISTA":
// - El paso 5 es determinista en código (no depende de que el modelo "diga
//   la verdad"), pero solo es tan bueno como los datos que valida. A la
//   fecha de este comentario, 0 de 1,464 filas de `ejercicios` tienen
//   `contraindicaciones` poblado (ver docs/LEGACY_EXERCISE_CROSSWALK.md).
//   Es decir: hoy, este chequeo es una red de seguridad ESTRUCTURAL para
//   cuando ese dato exista, no una garantía ACTIVA de que la rutina evita
//   las lesiones/condiciones reales del usuario.
// - El campo libre `condiciones_medicas` nunca es una entrada verificada
//   de forma determinista — es contexto que se le pide al modelo respetar
//   como mejor esfuerzo (ver `buildSystemPrompt`). Esta función no
//   diagnostica, no infiere recuperación, y NO produce una prescripción de
//   rehabilitación real: como mucho, adapta una rutina de fuerza/abdomen
//   normal evitando los patrones de movimiento que el usuario describió.
// - "La rutina generada" nunca debe describirse ni mostrarse al usuario
//   como médicamente validada. Ver AGENTS.md ("GymApp no diagnostica
//   condiciones médicas") y el futuro Compatibility Engine
//   (src/compatibility-engine/README.md) para la validación determinista
//   real contra atributos objetivos del ejercicio — ese trabajo no existe
//   todavía en este flujo legado.
// -----------------------------------------------------------------------

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  RESULTADO,
  clasificarFormaRespuesta,
  describirIntento,
  nuevoIdDiagnostico,
  textoAcotado,
  validarRutina,
  type ErrorValidacion,
  type IntentoDiagnostico,
} from "./diagnostico.ts";

// Límite duro para la nota libre "¿Qué necesitas hoy?" que puede mandar el
// cliente (ver app.js renderAjustar). Igual al del cliente.
const INTENCION_HOY_MAX = 500;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Variables ya disponibles automáticamente dentro de cualquier Edge
// Function de Supabase, no hace falta configurarlas a mano:
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Esta SÍ hay que configurarla a mano como "secret" (ver pasos aparte):
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

// IMPORTANT: `dias` is declared BEFORE `resumen` deliberately. Claude
// emits structured tool-call JSON fields in the order the schema declares
// them; `resumen` is a free-text field this prompt demands be clinically
// detailed (see the "condiciones_medicas" reasoning block below), which
// can legitimately run long for a real, complex medical input. With
// `resumen` first, a verbose response risks exhausting max_tokens BEFORE
// `dias` (the actual routine — the part that matters) is ever written,
// producing a response with no usable content at all. Putting `dias`
// first means the routine itself is captured even if `resumen` later gets
// cut short. This was the confirmed root cause of routines failing
// validation twice in a row on real, lengthy medical/restriction input —
// see this file's git history / GA-005 defect report for the analysis.
const ROUTINE_TOOL = {
  name: "generar_rutina",
  description: "Genera una rutina de entrenamiento estructurada por días.",
  input_schema: {
    type: "object",
    properties: {
      dias: {
        type: "array",
        items: {
          type: "object",
          properties: {
            dia: { type: "integer" },
            nombre: { type: "string" },
            ejercicios: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  exercise_id: { type: "string" },
                  series: { type: "integer" },
                  reps_objetivo: { type: "string" },
                  orden: { type: "integer" },
                  alternativas: {
                    type: "array",
                    maxItems: 2,
                    items: {
                      type: "object",
                      properties: {
                        exercise_id: { type: "string" },
                        motivo: { type: "string" },
                      },
                      required: ["exercise_id", "motivo"],
                    },
                  },
                },
                required: ["exercise_id", "series", "reps_objetivo", "orden"],
              },
            },
          },
          required: ["dia", "nombre", "ejercicios"],
        },
      },
      resumen: { type: "string" },
    },
    required: ["dias", "resumen"],
  },
};

function buildSystemPrompt(catalogo: unknown[], tipo: string): string {
  const intro = tipo === "abdominales"
    ? `Eres un entrenador experto en entrenamiento de core/abdomen. Debes
generar una rutina de ABDOMEN (solo core, no una rutina de gimnasio
completa) USANDO EXCLUSIVAMENTE ejercicios del siguiente catálogo (ya
filtrado a solo ejercicios de abdomen/core), referenciándolos por su
"exercise_id" exacto. Nunca inventes ejercicios, nombres o IDs que no
estén en esta lista.`
    : `Eres un entrenador de fuerza experto que diseña rutinas de gimnasio
personalizadas. Debes generar la rutina USANDO EXCLUSIVAMENTE ejercicios del
siguiente catálogo, referenciándolos por su "exercise_id" exacto. Nunca
inventes ejercicios, nombres o IDs que no estén en esta lista.`;

  const reglaVolumen = tipo === "abdominales"
    ? `- Esta es una rutina de ABDOMEN, no de cuerpo completo — no intentes
  cubrir otros grupos musculares. Varía el énfasis dentro del abdomen
  (superior, inferior, oblicuos, transverso/core) entre días.
- Usa repeticiones altas (12-20) o series por tiempo (ej. "30-45 seg") más
  que cargas pesadas — el abdomen responde mejor a volumen y control que a
  progresión de peso agresiva.`
    : `- El usuario puede tener hasta 3 metas en "metas", donde la PRIMERA del
  arreglo es su prioridad principal. Ajusta series y repeticiones dando más
  peso a esa meta principal, sin ignorar las secundarias. Explica brevemente
  ese balance en "resumen".`;

  return `${intro}

CATÁLOGO DISPONIBLE:
${JSON.stringify(catalogo)}

Reglas obligatorias:
- Si el usuario reporta una lesión, NUNCA incluyas un ejercicio cuyo campo
  "contraindicaciones" contenga esa lesión.
- Si "condiciones_medicas" no está vacío, es una condición médica REAL y
  ESPECÍFICA, no una preferencia — sigue este razonamiento ANTES de elegir
  cualquier ejercicio para la zona afectada:
  1. Identifica la estructura/articulación afectada y qué PATRONES DE
     MOVIMIENTO (no ejercicios individuales) la cargan directamente. Ej.: una
     lesión de manguito rotador o inestabilidad acromioclavicular se carga con
     press overhead, press de banca pesado, fondos, dominadas, y cualquier
     abducción/rotación externa del hombro cargada por encima de ~90°. Una
     cirugía lumbar con material (tornillos, fusión) se carga con peso muerto
     convencional pesado, sentadilla con carga axial alta, flexión de tronco
     cargada, y rotación de tronco cargada.
  2. EXCLUYE POR COMPLETO esos patrones de movimiento en la zona afectada —
     no los "aligeres", exclúyelos del todo. "Cuidado" no es una categoría de
     ejercicio válida aquí.
  3. Si la condición suena aguda, inflamatoria, post-quirúrgica reciente, o
     de inestabilidad (tendinopatía, cirugía con material, inestabilidad
     articular), reduce el volumen general de esa zona un 30-50% respecto a
     lo normal, y prioriza estabilización y control de rango de movimiento
     sobre progresión de carga — aunque la rutina resultante sea menos
     intensa de lo que sería sin la condición.
  4. NUNCA sacrifiques esto por "completar el día" — si el catálogo no tiene
     suficientes ejercicios seguros para esa zona, incluye menos ejercicios
     en vez de forzar uno riesgoso. Si de verdad no hay suficientes
     ejercicios seguros para llenar "dias_disponibles" días completos,
     genera MENOS DÍAS en vez de forzar contenido de relleno — un plan de 2
     días bien construido es mejor que uno de 4 días con ejercicios
     riesgosos o inventados.
  5. IMPORTANTE — límites de esta herramienta: NO eres un generador de
     protocolos de rehabilitación, y este texto libre no es un diagnóstico
     que puedas verificar. No inventes un "plan de rehabilitación" a partir
     de él. Tu única tarea aquí es adaptar una rutina de fuerza/abdomen
     NORMAL evitando por completo los patrones de movimiento de la zona
     afectada — nada más.
  6. En "resumen", sé BREVE (máximo 3 oraciones) sobre qué excluiste y por
     qué — una frase basta, ej. "Se excluyó todo empuje sobre la cabeza y
     press pesado por la condición de hombro reportada; el trabajo de
     hombro se limita a estabilización de baja carga." NO repitas el texto
     médico del usuario ni redactes una explicación clínica extensa — esto
     puede truncar tu respuesta antes de terminar "dias", que es la parte
     que realmente importa. Cierra siempre recordando que esto no sustituye
     la valoración de un médico o fisioterapeuta.
- Distribuye los ejercicios en tantos días como "dias_disponibles" indique el
  usuario (o menos, por la regla 4 anterior si aplica), evitando entrenar el
  mismo grupo muscular en días consecutivos cuando sea posible. NUNCA generes
  MÁS días de los que "dias_disponibles" indica.
${reglaVolumen}
- Usa solo equipo presente en "equipo_disponible" del usuario.
- Para CADA ejercicio, sugiere hasta 2 "alternativas" del mismo catálogo —
  pensadas para cuando el equipo esté ocupado, el usuario no domine la
  técnica, o no pueda hacerlo por alguna limitación física del momento.
  Cada alternativa debe: (a) trabajar el mismo grupo muscular o uno muy
  cercano, (b) respetar las mismas lesiones y equipo disponible del
  usuario, (c) traer un "motivo" breve (menos de 10 palabras) explicando
  cuándo usarla, ej. "si la polea está ocupada" o "si te molesta el
  hombro". Si no hay una alternativa razonable, deja el arreglo vacío — no
  inventes una mala solo por rellenar.
- Si el mensaje del usuario incluye "intencion_hoy", es lo que el usuario
  escribió HOY con sus propias palabras sobre qué necesita o qué cambió
  (ej. poco tiempo, un énfasis, molestia en una zona, una meta próxima).
  Úsalo solo como PREFERENCIA/CONTEXTO para orientar la selección y el
  volumen dentro de las reglas anteriores. NO es un diagnóstico, no lo
  interpretes clínicamente, no inventes un protocolo de rehabilitación a
  partir de él, y no sustituye ni anula "lesiones"/"condiciones_medicas".
  Si menciona molestia en una zona, puedes ser más conservador con esa
  zona. Nunca lo repitas textualmente en "resumen".
- Si "evitar_maquinas" es true, PRIORIZA ejercicios con equipo "barra",
  "mancuernas", "polea" o "peso_corporal" sobre los de equipo "maquina" —
  el usuario prefiere esto porque las máquinas suelen tener fila de espera
  en horas pico, mientras que barras/mancuernas/polea suelen tener más
  disponibilidad. Usa "maquina" solo si de verdad no hay una alternativa
  razonable en el catálogo para ese grupo muscular.
- Responde ÚNICAMENTE llamando a la herramienta "generar_rutina".`;
}

// `messages` is owned by the caller so a failed attempt can be turned into
// a proper multi-turn correction (see the retry loop below) instead of
// blindly resending the exact same request — which, for a demanding,
// deterministic-leaning generation task, tends to fail the same way twice.
// Returns `stopReason` and `toolUseId` (not just `input`) so the caller
// can tell a genuine truncation (`stop_reason === "max_tokens"`, `input`
// possibly null) apart from a structurally-invalid-but-complete response,
// and so a corrective follow-up can reference the exact tool_use id.
// La API de Claude respondió no-2xx. Solo lleva el status y un fragmento
// acotado del cuerpo de error de la API (nunca el prompt ni el perfil).
class ErrorApiModelo extends Error {
  status: number;
  constructor(status: number, texto: string) {
    super(`Error de la API de Claude (${status}): ${textoAcotado(texto)}`);
    this.status = status;
  }
}

async function llamarClaude(
  systemPrompt: string,
  messages: unknown[],
): Promise<{
  input: any;
  stopReason: string;
  toolUseId: string | null;
  usage: { input_tokens?: number; output_tokens?: number } | null;
}> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      // Raised from 4096: the medical/restriction reasoning this prompt
      // requires can legitimately produce a long response for a real,
      // detailed case, even with `resumen` now capped to ~3 sentences and
      // placed after `dias` in the schema (see ROUTINE_TOOL's comment).
      max_tokens: 8192,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: [ROUTINE_TOOL],
      tool_choice: { type: "tool", name: "generar_rutina" },
      messages,
    }),
  });

  if (!resp.ok) {
    const texto = await resp.text();
    throw new ErrorApiModelo(resp.status, texto);
  }

  const data = await resp.json();
  const bloque = data.content?.find((b: any) => b.type === "tool_use" && b.name === "generar_rutina");
  return {
    input: bloque?.input ?? null,
    stopReason: data.stop_reason,
    toolUseId: bloque?.id ?? null,
    usage: data.usage ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Diagnóstico acotado de esta petición (ver diagnostico.ts). Se registra
  // en los logs de la función en cada paso — así, si el runtime corta la
  // función por tiempo, el último log dice hasta dónde llegó — y se
  // devuelve en la respuesta como `diagnostico` para la consola del
  // navegador. NUNCA contiene texto médico, la intención libre, el perfil
  // completo ni la respuesta del modelo.
  const inicioMs = Date.now();
  const diagnostico: {
    id: string;
    tipo: string;
    fallo: string | null;
    catalogo_len: number | null;
    dias_solicitados: number | null;
    tiene_condiciones_medicas: boolean | null;
    condiciones_medicas_len: number | null;
    num_lesiones: number | null;
    tiene_intencion_hoy: boolean;
    intentos: IntentoDiagnostico[];
    ms_total: number | null;
  } = {
    id: nuevoIdDiagnostico(),
    tipo: "fuerza",
    fallo: null,
    catalogo_len: null,
    dias_solicitados: null,
    tiene_condiciones_medicas: null,
    condiciones_medicas_len: null,
    num_lesiones: null,
    tiene_intencion_hoy: false,
    intentos: [],
    ms_total: null,
  };
  const log = (evento: string, extra: Record<string, unknown> = {}) =>
    console.log(`[generate-routine] diag ${JSON.stringify({ id: diagnostico.id, tipo: diagnostico.tipo, evento, ms: Date.now() - inicioMs, ...extra })}`);
  const responder = (status: number, cuerpo: Record<string, unknown>, fallo: string | null = null) => {
    diagnostico.fallo = fallo;
    diagnostico.ms_total = Date.now() - inicioMs;
    log("fin", { status, fallo });
    return new Response(JSON.stringify({ ...cuerpo, diagnostico }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  };

  try {
    // "fuerza" por default: así las llamadas existentes (sin body) del
    // botón "Generar mi rutina" original siguen funcionando sin cambios.
    let tipo = "fuerza";
    // Nota libre "¿Qué necesitas hoy?" (opcional). Solo contexto para el
    // modelo, etiquetado como intención — nunca se convierte en filtro,
    // contraindicación ni restricción en código.
    let intencionHoy = "";
    try {
      const body = await req.json();
      if (body?.tipo) tipo = body.tipo;
      if (typeof body?.intencion_hoy === "string") {
        intencionHoy = body.intencion_hoy.replace(/\s+/g, " ").trim().slice(0, INTENCION_HOY_MAX);
      }
    } catch (_e) {
      // sin body — está bien, usa el default
    }
    diagnostico.tipo = tipo;
    diagnostico.tiene_intencion_hoy = intencionHoy.length > 0;
    log("inicio");
    if (!["fuerza", "abdominales"].includes(tipo)) {
      return new Response(JSON.stringify({ error: `Tipo de rutina no soportado todavía: ${tipo}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cliente "como el usuario" — respeta RLS, solo ve sus propios datos.
    const supabaseUsuario = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUsuario.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: perfil, error: perfilError } = await supabaseUsuario
      .from("perfiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (perfilError || !perfil) {
      return responder(400, { error: "No se encontró tu perfil. Guárdalo primero desde la app." }, RESULTADO.PERFIL_NO_ENCONTRADO);
    }

    const { data: catalogoCompleto, error: catalogoError } = await supabaseUsuario
      .from("ejercicios")
      .select("id, nombre, grupo_muscular, equipo, nivel, contraindicaciones");

    if (catalogoError || !catalogoCompleto) {
      return responder(500, { error: "No se pudo cargar el catálogo de ejercicios." }, RESULTADO.CATALOGO_NO_DISPONIBLE);
    }

    const equipoDisponible = new Set(perfil.equipo_disponible || []);
    let catalogoFiltrado = catalogoCompleto.filter(
      (ej) => equipoDisponible.size === 0 || equipoDisponible.has(ej.equipo),
    );
    if (tipo === "abdominales") {
      // Cubrir variantes reales que aparecen en wger/Free Exercise DB:
      // español ("abdomen"/"abdominales"), inglés ("abs"/"abdominals"/"core"),
      // y "oblicuos"/"obliques" para el core lateral.
      catalogoFiltrado = catalogoFiltrado.filter((ej) => {
        const g = (ej.grupo_muscular || "").toLowerCase();
        return g.includes("abdom") || g.includes("abs") || g.includes("core") || g.includes("obli") || g.includes("waist");
      });
      console.log(`[generate-routine] catálogo de abdomen filtrado: ${catalogoFiltrado.length} ejercicios.`);

      // Sin esto, si el catálogo queda vacío Claude no tiene nada real que
      // elegir y puede degenerar en una respuesta larga y sin sentido —
      // mejor cortar aquí, ANTES de gastar la llamada.
      if (catalogoFiltrado.length < 3) {
        diagnostico.catalogo_len = catalogoFiltrado.length;
        return responder(422, {
          error: `Tu catálogo solo tiene ${catalogoFiltrado.length} ejercicios de abdomen etiquetados así — no es suficiente para generar una rutina variada. Revisa cómo está etiquetado el grupo muscular en tu tabla 'ejercicios'.`,
        }, RESULTADO.CATALOGO_ABDOMEN_INSUFICIENTE);
      }
    }

    // Referencias cortas (1, 2, 3...) en vez de los UUID completos: más
    // baratas en tokens y casi imposibles de copiar mal para el modelo.
    // Se traducen de vuelta al exercise_id real antes de validar/guardar.
    const catalogoPorRef = new Map<string, any>();
    const catalogo = catalogoFiltrado.map((ej, i) => {
      const ref = String(i + 1);
      catalogoPorRef.set(ref, ej);
      return {
        exercise_id: ref,
        nombre: ej.nombre,
        grupo_muscular: ej.grupo_muscular,
        equipo: ej.equipo,
        nivel: ej.nivel,
        contraindicaciones: ej.contraindicaciones || [],
      };
    });

    const perfilParaPrompt = {
      peso_kg: perfil.peso_kg,
      edad: perfil.edad,
      nivel: perfil.nivel,
      metas: perfil.metas,
      lesiones: perfil.lesiones,
      condiciones_medicas: perfil.condiciones_medicas || null,
      dias_disponibles: perfil.dias_disponibles,
      equipo_disponible: perfil.equipo_disponible,
      evitar_maquinas: perfil.evitar_maquinas || false,
    };

    // Solo metadatos (longitud/conteos), nunca el contenido.
    diagnostico.catalogo_len = catalogo.length;
    diagnostico.dias_solicitados = perfilParaPrompt.dias_disponibles ?? null;
    diagnostico.tiene_condiciones_medicas = Boolean(perfilParaPrompt.condiciones_medicas);
    diagnostico.condiciones_medicas_len = perfilParaPrompt.condiciones_medicas ? String(perfilParaPrompt.condiciones_medicas).length : 0;
    diagnostico.num_lesiones = Array.isArray(perfilParaPrompt.lesiones) ? perfilParaPrompt.lesiones.length : 0;
    log("contexto", {
      catalogo_len: diagnostico.catalogo_len,
      dias_solicitados: diagnostico.dias_solicitados,
      condiciones_medicas_len: diagnostico.condiciones_medicas_len,
      num_lesiones: diagnostico.num_lesiones,
      tiene_intencion_hoy: diagnostico.tiene_intencion_hoy,
    });

    const systemPrompt = buildSystemPrompt(catalogo, tipo);

    // A veces (sobre todo con perfiles complejos: varias metas + lesiones +
    // condición médica detallada) el modelo puede degenerar en una
    // respuesta sin sentido, o la respuesta puede fallar la validación
    // determinista (ID inválido, contraindicación, más días de los
    // pedidos). En vez de reintentar a ciegas con la MISMA petición
    // (que tiende a fallar exactamente igual dos veces), el intento 2
    // recibe retroalimentación real: qué falló específicamente, vía un
    // turno de conversación `tool_result` — Claude ve su propio intento
    // anterior y el motivo exacto del rechazo, no solo "inténtalo de
    // nuevo". Esto NUNCA relaja la validación en sí (sigue siendo
    // determinista y exactamente igual de estricta); solo hace que el
    // reintento tenga una razón real de salir distinto.
    const mensajeInicial = intencionHoy
      ? `Genera la rutina para este usuario:\n${JSON.stringify(perfilParaPrompt)}\n\n` +
        `intencion_hoy (texto libre del usuario, contexto/preferencia — NO diagnóstico ni restricción verificada):\n` +
        JSON.stringify(intencionHoy)
      : `Genera la rutina para este usuario:\n${JSON.stringify(perfilParaPrompt)}`;
    const mensajesConversacion: any[] = [{ role: "user", content: mensajeInicial }];

    let rutina: any = null;
    let errores: ErrorValidacion[] = [];
    let motivoFalloFinal: string | null = null;
    // Explícito, nunca implícito: true únicamente cuando una rutina sin
    // errores duros trae MENOS días de los solicitados. Un resultado
    // parcial sigue siendo determinista y sigue pasando por exactamente
    // las mismas validaciones de catálogo/equipo/contraindicación — lo
    // único que cambia es que el llamador debe comunicarlo como degradado,
    // no como éxito completo silencioso (ver validarRutina en diagnostico.ts).
    let rutinaEsParcial = false;
    const INTENTOS_MAXIMOS = 2;

    for (let intento = 1; intento <= INTENTOS_MAXIMOS; intento++) {
      const inicioIntentoMs = Date.now();
      const registrarIntento = (resultado: string, datos: {
        input?: any; stopReason?: string | null; errores?: ErrorValidacion[];
        usage?: any; httpStatusModelo?: number | null;
      }) => {
        const d = describirIntento({
          intento,
          resultado,
          input: datos.input ?? null,
          stopReason: datos.stopReason ?? null,
          errores: datos.errores,
          usage: datos.usage,
          httpStatusModelo: datos.httpStatusModelo,
          ms: Date.now() - inicioIntentoMs,
        });
        diagnostico.intentos.push(d);
        log("intento", { ...d });
      };

      let respuestaModelo;
      try {
        respuestaModelo = await llamarClaude(systemPrompt, mensajesConversacion);
      } catch (err) {
        if (!(err instanceof ErrorApiModelo)) throw err;
        registrarIntento(RESULTADO.ERROR_API_MODELO, { httpStatusModelo: err.status });
        motivoFalloFinal = RESULTADO.ERROR_API_MODELO;
        errores = [{ codigo: RESULTADO.ERROR_API_MODELO, texto: err.message }];
        break;
      }
      const { input: candidato, stopReason, toolUseId, usage } = respuestaModelo;

      // Chequeo de cordura ANTES de procesar nada más: sin tool_use, sin
      // `dias`, más de ~10 días, o `stop_reason === "max_tokens"` sin
      // `dias` utilizable. En ninguno de esos casos hay un tool_use
      // completo que se pueda reproducir como turno del asistente para dar
      // retroalimentación específica — solo se puede reintentar con la
      // conversación tal cual.
      const falloForma = clasificarFormaRespuesta(candidato, stopReason);
      if (falloForma) {
        registrarIntento(falloForma, { input: candidato, stopReason, usage });
        motivoFalloFinal = falloForma;
        errores = [{ codigo: falloForma, texto: `Respuesta inutilizable del modelo (stop_reason=${stopReason}).` }];
        if (intento < INTENTOS_MAXIMOS) continue;
        break;
      }

      // Traducir las referencias cortas (1, 2, 3...) de vuelta al
      // exercise_id real del catálogo, antes de validar y guardar. Se
      // trabaja sobre una COPIA — el `candidato` original (con las
      // referencias numéricas tal como las escribió el modelo) se
      // conserva intacto para poder reenviarlo como su propio turno de
      // conversación si hace falta un reintento corrector.
      const candidatoTraducido = structuredClone(candidato);
      const lesionesUsuario = new Set(perfilParaPrompt.lesiones || []);
      for (const dia of candidatoTraducido.dias || []) {
        for (const ej of dia.ejercicios || []) {
          const real = catalogoPorRef.get(String(ej.exercise_id));
          ej.exercise_id = real ? real.id : `REF_INVALIDA_${ej.exercise_id}`;

          // Alternativas: se traducen igual, pero si alguna resulta inválida
          // o contraindicada, simplemente se descarta (no truena la rutina
          // completa por una alternativa de más).
          const alternativasTraducidas = [];
          for (const alt of ej.alternativas || []) {
            const realAlt = catalogoPorRef.get(String(alt.exercise_id));
            if (!realAlt) continue;
            const contraindicada = (realAlt.contraindicaciones || []).some((c: string) => lesionesUsuario.has(c));
            if (contraindicada) continue;
            alternativasTraducidas.push({
              ejercicio_id: realAlt.id,
              nombre: realAlt.nombre,
              equipo: realAlt.equipo,
              motivo: alt.motivo,
            });
          }
          ej.alternativas = alternativasTraducidas;
        }
      }

      const erroresIntento = validarRutina(
        candidatoTraducido, catalogoFiltrado.map((ej) => ({ ...ej, exercise_id: ej.id })), perfilParaPrompt,
      );

      if (erroresIntento.length === 0) {
        rutina = candidatoTraducido;
        errores = [];
        motivoFalloFinal = null;
        // Explícito, no silencioso: si el catálogo/restricciones no
        // permitieron llenar los días pedidos de forma segura, esto se
        // marca como parcial aquí mismo, en el único lugar donde se decide
        // que la rutina es válida — nunca se infiere después a partir de
        // un simple conteo desconectado de la decisión de éxito.
        rutinaEsParcial = Boolean(
          perfilParaPrompt.dias_disponibles && candidatoTraducido.dias.length < perfilParaPrompt.dias_disponibles,
        );
        registrarIntento(rutinaEsParcial ? RESULTADO.OK_PARCIAL : RESULTADO.OK, { input: candidato, stopReason, usage });
        break;
      }

      errores = erroresIntento;
      motivoFalloFinal = RESULTADO.VALIDACION_FALLIDA;
      registrarIntento(RESULTADO.VALIDACION_FALLIDA, { input: candidato, stopReason, errores: erroresIntento, usage });

      if (intento < INTENTOS_MAXIMOS && toolUseId) {
        // Retroalimentación real para el siguiente intento, usando el
        // `candidato` SIN traducir (con sus referencias numéricas
        // originales) para que el modelo reconozca su propia respuesta.
        mensajesConversacion.push({
          role: "assistant",
          content: [{ type: "tool_use", id: toolUseId, name: "generar_rutina", input: candidato }],
        });
        mensajesConversacion.push({
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: toolUseId,
            content: `Tu rutina anterior no es válida por lo siguiente:\n${erroresIntento.map((e) => `- ${e.texto}`).join("\n")}\n` +
              `Corrige ESTOS problemas específicos y vuelve a llamar a "generar_rutina" con una rutina completa y válida. ` +
              `No repitas la misma referencia de ejercicio inválida ni la misma contraindicación.`,
          }],
        });
      }
    }

    if (!rutina) {
      // Nunca se expone al usuario normal el detalle técnico como única
      // explicación — solo un mensaje entendible más un `codigo` para que
      // el frontend elija su propio texto amigable. `codigo` conserva sus
      // valores previos (RESPUESTA_TRUNCADA / VALIDACION_FALLIDA) para no
      // romper al cliente; el motivo exacto va en `diagnostico.fallo`.
      if (motivoFalloFinal === RESULTADO.ERROR_API_MODELO) {
        return responder(502, {
          error: "El servicio de generación no respondió correctamente.",
          codigo: "ERROR_MODELO",
          detalles: errores.map((e) => e.texto),
        }, motivoFalloFinal);
      }
      const codigo = motivoFalloFinal === RESULTADO.VALIDACION_FALLIDA ? "VALIDACION_FALLIDA" : "RESPUESTA_TRUNCADA";
      return responder(422, {
        error: "No pudimos construir una rutina válida con estas restricciones.",
        codigo,
        detalles: errores.map((e) => e.texto).slice(0, 20),
      }, motivoFalloFinal);
    }

    // A partir de aquí usamos el cliente "admin" (service role) SOLO para
    // guardar en nombre del usuario ya verificado arriba — nunca se expone
    // esta key al cliente.
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    await supabaseAdmin.from("rutinas").update({ activa: false })
      .eq("usuario_id", user.id).eq("activa", true).eq("tipo", tipo);

    const { data: nuevaRutina, error: rutinaError } = await supabaseAdmin
      .from("rutinas")
      .insert({
        usuario_id: user.id,
        tipo,
        nombre: tipo === "abdominales" ? "Rutina de abdomen generada" : "Rutina generada",
        resumen: rutina.resumen,
        activa: true,
      })
      .select()
      .single();

    if (rutinaError || !nuevaRutina) {
      return responder(500, {
        error: "No se pudo guardar la rutina.",
        codigo: "ERROR_GUARDADO",
        detalle: textoAcotado(rutinaError?.message),
      }, RESULTADO.PERSISTENCIA_RUTINA_FALLIDA);
    }

    const filas = rutina.dias.flatMap((dia: any) =>
      dia.ejercicios.map((ej: any) => ({
        rutina_id: nuevaRutina.id,
        ejercicio_id: ej.exercise_id,
        dia: dia.dia,
        nombre_dia: dia.nombre,
        series: ej.series,
        reps_objetivo: ej.reps_objetivo,
        orden: ej.orden,
        alternativas: ej.alternativas || [],
      })),
    );

    const { error: ejerciciosError } = await supabaseAdmin.from("rutina_ejercicios").insert(filas);
    if (ejerciciosError) {
      return responder(500, {
        error: "No se pudieron guardar los ejercicios.",
        codigo: "ERROR_GUARDADO",
        detalle: textoAcotado(ejerciciosError.message),
      }, RESULTADO.PERSISTENCIA_EJERCICIOS_FALLIDA);
    }

    // `parcial`/`codigo` son explícitos siempre (no solo cuando son true),
    // para que el frontend nunca tenga que inferir el estado a partir de
    // contar `dias.length` por su cuenta — la decisión de si el resultado
    // es completo o degradado se toma UNA sola vez, arriba, junto con el
    // resto de la validación.
    return responder(200, {
      rutina: nuevaRutina,
      dias: rutina.dias,
      parcial: rutinaEsParcial,
      codigo: rutinaEsParcial ? "RUTINA_PARCIAL_MENOS_DIAS" : null,
      dias_solicitados: perfilParaPrompt.dias_disponibles,
      dias_generados: rutina.dias.length,
    });
  } catch (err) {
    return responder(500, { error: "Error inesperado", detalle: textoAcotado(err) }, RESULTADO.ERROR_INESPERADO);
  }
});
