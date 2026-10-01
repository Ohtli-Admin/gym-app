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
//    disponible, series en rango), contra 'lesiones' vía el campo
//    'contraindicaciones' del catálogo, Y contra los `grupos_excluidos`
//    que el propio modelo declaró (ver más abajo).
// 6. Si es válida, la guarda en 'rutinas' y 'rutina_ejercicios', y desactiva
//    cualquier rutina anterior del usuario.
//
// LÍMITES DE SEGURIDAD — LEER ANTES DE ASUMIR QUE ESTO ES "VALIDACIÓN
// MÉDICA DETERMINISTA":
// - El paso 5 tiene DOS capas deterministas ahora:
//   (a) `contraindicaciones` en el catálogo — a la fecha de este comentario
//       0 de 1,464 filas de `ejercicios` lo tienen poblado, así que hoy es
//       una red de seguridad para cuando ese dato exista, no una garantía
//       activa por sí sola.
//   (b) `grupos_excluidos` — el modelo debe declarar, ANTES de elegir
//       ejercicios, qué valores exactos de `grupo_muscular` decidió excluir
//       por la condición médica de ESTE usuario (ver ROUTINE_TOOL). El
//       código (no el modelo) verifica que NINGÚN ejercicio elegido
//       pertenezca a un grupo que el propio modelo declaró excluir — si
//       eso pasa, la respuesta se rechaza y se reintenta con el error
//       explícito. Esto SÍ es determinista y generaliza a cualquier lesión
//       que el usuario describa (no depende de una lista de zonas escrita
//       a mano por el desarrollador), pero depende de que el modelo haya
//       sido honesto al declarar `grupos_excluidos` — no es una prueba de
//       que declaró TODOS los grupos que debería haber excluido, solo de
//       que respetó lo que sí declaró.
// - El campo libre `condiciones_medicas` nunca es una entrada verificada
//   de forma determinista en cuanto a SU CONTENIDO CLÍNICO — es contexto
//   que se le pide al modelo interpretar como mejor esfuerzo. Esta función
//   no diagnostica, no infiere recuperación, y NO produce una prescripción
//   de rehabilitación real: como mucho, adapta una rutina de fuerza/abdomen
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
  nuevoIdDiagnostico,
  textoAcotado,
  validarRutina,
  type ErrorValidacion,
  type IntentoDiagnostico,
} from "./diagnostico.ts";
import { ejecutarIntentos } from "./reintentos.ts";

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

// ORDEN DE CAMPOS DELIBERADO — Claude emite los campos de una tool call en
// el orden en que el schema los declara:
// 1. `grupos_excluidos` va PRIMERO a propósito: es corto (unas cuantas
//    palabras del catálogo), así que casi no consume presupuesto de
//    tokens, y forzar que el modelo lo declare ANTES de elegir ejercicios
//    lo compromete con esa lista antes de generar `dias` — es más difícil
//    que la contradiga después si ya la escribió primero.
// 2. `dias` va segundo: es la parte que de verdad importa (la rutina).
// 3. `resumen` va AL FINAL a propósito: es texto libre que el prompt pide
//    mantener breve, pero puede alargarse en casos médicos complejos. Si
//    fuera antes de `dias`, una respuesta verbosa arriesgaría agotar
//    max_tokens ANTES de escribir la rutina — esto fue la causa confirmada
//    de fallos de validación dos veces seguidas en entradas médicas reales
//    y extensas (ver GA-005 en el historial de este archivo).
//
// `strict: true` (Anthropic "strict tool use", soportado en claude-sonnet-5):
// la API restringe el muestreo para que `input` siempre cumpla este schema
// — en particular, `dias`, `grupos_excluidos` y `resumen` siempre están
// presentes como claves (aunque `grupos_excluidos` puede ser `[]`). Esto es
// el fix directo del fallo real DIAS_AUSENTES (tool_use sin `dias`). El modo
// estricto exige `additionalProperties: false` en cada objeto y NO admite
// `maxItems`, así que el límite de 2 alternativas se aplica en código (ver
// `evaluar` más abajo), no en el schema. Una respuesta truncada
// (stop_reason=max_tokens) puede seguir siendo incompleta — strict no
// cambia eso — y reintentos.ts sigue manejando toda falla de forma de
// manera defensiva.
const ROUTINE_TOOL = {
  name: "generar_rutina",
  description: "Genera una rutina de entrenamiento estructurada por días.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      grupos_excluidos: {
        type: "array",
        items: { type: "string" },
        description:
          "Valores EXACTOS de 'grupo_muscular' (copiados tal cual del catálogo recibido, sin traducir ni parafrasear) que decidiste excluir POR COMPLETO de esta rutina por una lesión o condición médica reportada por el usuario. Tu elección de ejercicios en 'dias' será verificada en código contra esta misma lista: si incluyes un ejercicio de un grupo que tú mismo pusiste aquí, tu respuesta será rechazada. Si el usuario no reportó ninguna lesión/condición relevante para ningún grupo muscular, deja este arreglo vacío [].",
      },
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
                    items: {
                      type: "object",
                      properties: {
                        exercise_id: { type: "string" },
                        motivo: { type: "string" },
                      },
                      required: ["exercise_id", "motivo"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["exercise_id", "series", "reps_objetivo", "orden"],
                additionalProperties: false,
              },
            },
          },
          required: ["dia", "nombre", "ejercicios"],
          additionalProperties: false,
        },
      },
      resumen: { type: "string" },
    },
    required: ["grupos_excluidos", "dias", "resumen"],
    additionalProperties: false,
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
- Si "condiciones_medicas" no está vacío, TRÁTALO como una condición médica
  real y específica, nunca como una preferencia — incluso si está redactado
  de forma breve o informal. Este mismo campo también se usa en otra parte de
  la app con una etiqueta más suave ("lesiones, molestias o limitaciones"),
  así que el usuario puede haber escrito algo corto o coloquial sin que eso
  signifique que la restricción sea menor: una frase breve no es evidencia de
  severidad baja. Sigue este razonamiento ANTES de elegir cualquier ejercicio
  para la zona afectada:
  1. Identifica la estructura/articulación afectada y qué PATRONES DE
     MOVIMIENTO (no ejercicios individuales) la cargan directamente. Ej.: una
     lesión de manguito rotador o inestabilidad acromioclavicular se carga con
     press overhead, press de banca pesado, fondos, dominadas, y cualquier
     abducción/rotación externa del hombro cargada por encima de ~90°. Una
     cirugía lumbar con material (tornillos, fusión) se carga con peso muerto
     convencional pesado, sentadilla con carga axial alta, flexión de tronco
     cargada, y rotación de tronco cargada.
  2. Con base en eso, decide TODOS los valores de "grupo_muscular" (tal cual
     aparecen en el catálogo de arriba, copiados exactos) que corresponden a
     esos patrones de movimiento para ESTE usuario, y ponlos en el campo
     "grupos_excluidos" de tu respuesta — ANTES de elegir ningún ejercicio.
     Esta declaración se usa para verificar tu propia rutina en código: si
     luego eliges un ejercicio de un grupo que pusiste aquí, tu respuesta
     completa será rechazada y tendrás que corregirla. Sé exhaustivo: es
     mejor excluir un grupo de más que dejar pasar uno que sí carga la zona
     lesionada.
  3. EXCLUYE POR COMPLETO esos grupos/patrones de movimiento al elegir
     ejercicios — no los "aligeres", exclúyelos del todo. "Cuidado" no es una
     categoría de ejercicio válida aquí.
  4. Si la condición suena aguda, inflamatoria, post-quirúrgica reciente, o
     de inestabilidad (tendinopatía, cirugía con material, inestabilidad
     articular), reduce el volumen general de esa zona un 30-50% respecto a
     lo normal, y prioriza estabilización y control de rango de movimiento
     sobre progresión de carga — aunque la rutina resultante sea menos
     intensa de lo que sería sin la condición.
  5. NUNCA sacrifiques esto por "completar el día" — si el catálogo no tiene
     suficientes ejercicios seguros para esa zona, incluye menos ejercicios
     en vez de forzar uno riesgoso. Si de verdad no hay suficientes
     ejercicios seguros para llenar "dias_disponibles" días completos,
     genera MENOS DÍAS en vez de forzar contenido de relleno — un plan de 2
     días bien construido es mejor que uno de 4 días con ejercicios
     riesgosos o inventados.
  6. IMPORTANTE — límites de esta herramienta: NO eres un generador de
     protocolos de rehabilitación, y este texto libre no es un diagnóstico
     que puedas verificar. No inventes un "plan de rehabilitación" a partir
     de él. Tu única tarea aquí es adaptar una rutina de fuerza/abdomen
     NORMAL evitando por completo los patrones de movimiento de la zona
     afectada — nada más.
  7. En "resumen", sé BREVE (máximo 3 oraciones) sobre qué excluiste y por
     qué — una frase basta, ej. "Se excluyó todo empuje sobre la cabeza y
     press pesado por la condición de hombro reportada; el trabajo de
     hombro se limita a estabilización de baja carga." NO repitas el texto
     médico del usuario ni redactes una explicación clínica extensa — esto
     puede truncar tu respuesta antes de terminar "dias", que es la parte
     que realmente importa. Cierra siempre recordando que esto no sustituye
     la valoración de un médico o fisioterapeuta.
- Si el usuario NO tiene ninguna lesión/condición médica relevante, deja
  "grupos_excluidos" como un arreglo vacío [].
- Distribuye los ejercicios en tantos días como "dias_disponibles" indique el
  usuario (o menos, por la regla 5 anterior si aplica), evitando entrenar el
  mismo grupo muscular en días consecutivos cuando sea posible. NUNCA generes
  MÁS días de los que "dias_disponibles" indica.
${reglaVolumen}
- Usa solo equipo presente en "equipo_disponible" del usuario.
- Para CADA ejercicio, sugiere hasta 2 "alternativas" del mismo catálogo —
  pensadas para cuando el equipo esté ocupado, el usuario no domine la
  técnica, o no pueda hacerlo por alguna limitación física del momento.
  Cada alternativa debe: (a) trabajar el mismo grupo muscular o uno muy
  cercano, (b) respetar las mismas lesiones, "grupos_excluidos" y equipo
  disponible del usuario, (c) traer un "motivo" breve (menos de 10 palabras)
  explicando cuándo usarla, ej. "si la polea está ocupada" o "si te molesta
  el hombro". Si no hay una alternativa razonable, deja el arreglo vacío —
  no inventes una mala solo por rellenar.
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
    // determinista (ID inválido, contraindicación, grupo excluido violado,
    // más días de los pedidos). En vez de reintentar a ciegas con la MISMA
    // petición (que tiende a fallar exactamente igual dos veces), el
    // intento 2 recibe retroalimentación real: qué falló específicamente,
    // vía un turno de conversación `tool_result` — Claude ve su propio
    // intento anterior y el motivo exacto del rechazo, no solo "inténtalo de
    // nuevo". Esto NUNCA relaja la validación en sí (sigue siendo
    // determinista y exactamente igual de estricta); solo hace que el
    // reintento tenga una razón real de salir distinto.
    const mensajeInicial = intencionHoy
      ? `Genera la rutina para este usuario:\n${JSON.stringify(perfilParaPrompt)}\n\n` +
        `intencion_hoy (texto libre del usuario, contexto/preferencia — NO diagnóstico ni restricción verificada):\n` +
        JSON.stringify(intencionHoy)
      : `Genera la rutina para este usuario:\n${JSON.stringify(perfilParaPrompt)}`;
    const mensajesConversacion: any[] = [{ role: "user", content: mensajeInicial }];

    // Traduce las referencias cortas (1, 2, 3...) al exercise_id real y
    // valida. Trabaja sobre una COPIA: el `candidato` original (con las
    // referencias tal como las escribió el modelo) queda intacto para
    // poder reenviarlo como su propio turno si hace falta un reintento
    // corrector (ver reintentos.ts).
    const lesionesUsuario = new Set(perfilParaPrompt.lesiones || []);
    const catalogoParaValidar = catalogoFiltrado.map((ej) => ({ ...ej, exercise_id: ej.id }));
    const evaluar = (candidato: any) => {
      const candidatoTraducido = structuredClone(candidato);
      for (const dia of candidatoTraducido.dias || []) {
        for (const ej of dia.ejercicios || []) {
          const real = catalogoPorRef.get(String(ej.exercise_id));
          ej.exercise_id = real ? real.id : `REF_INVALIDA_${ej.exercise_id}`;

          // Alternativas: se traducen igual, pero si alguna resulta inválida
          // o contraindicada, simplemente se descarta (no truena la rutina
          // completa por una alternativa de más). Máximo 2: el límite antes
          // vivía como `maxItems` en el schema, que el modo estricto no
          // admite — ahora se aplica aquí, en código.
          const alternativasTraducidas = [];
          for (const alt of ej.alternativas || []) {
            if (alternativasTraducidas.length >= 2) break;
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
      const errores = validarRutina(candidatoTraducido, catalogoParaValidar, perfilParaPrompt);
      // Explícito, nunca implícito: parcial únicamente cuando una rutina
      // sin errores duros trae MENOS días de los solicitados — se comunica
      // como degradada, no como éxito completo silencioso.
      const parcial = Boolean(
        perfilParaPrompt.dias_disponibles && candidatoTraducido.dias.length < perfilParaPrompt.dias_disponibles,
      );
      return { errores, resultado: candidatoTraducido, parcial };
    };

    const intentos = await ejecutarIntentos({
      mensajes: mensajesConversacion,
      llamarModelo: (mensajes) => llamarClaude(systemPrompt, mensajes),
      evaluar,
      statusErrorApi: (err) => (err instanceof ErrorApiModelo ? err.status : null),
      registrar: (d) => {
        diagnostico.intentos.push(d);
        log("intento", { ...d });
      },
    });
    const rutina = intentos.resultado;
    const rutinaEsParcial = intentos.parcial;
    const motivoFalloFinal = intentos.motivoFallo;
    const errores: ErrorValidacion[] = intentos.errores;

    if (!rutina) {
      // Nunca se expone al usuario normal el detalle técnico como única
      // explicación — solo un mensaje entendible más un `codigo` para que
      // el frontend elija su propio texto amigable. `codigo` es el motivo
      // real: "RESPUESTA_TRUNCADA" SOLO para un truncado real por
      // max_tokens; los fallos de forma conservan su propio código
      // (DIAS_AUSENTES, SIN_TOOL_INPUT, DIAS_DEGENERADOS).
      if (motivoFalloFinal === RESULTADO.ERROR_API_MODELO) {
        return responder(502, {
          error: "El servicio de generación no respondió correctamente.",
          codigo: "ERROR_MODELO",
          detalles: errores.map((e) => e.texto),
        }, motivoFalloFinal);
      }
      const codigo = motivoFalloFinal === RESULTADO.TRUNCADO_MAX_TOKENS
        ? "RESPUESTA_TRUNCADA"
        : (motivoFalloFinal ?? RESULTADO.VALIDACION_FALLIDA);
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
      grupos_excluidos: rutina.grupos_excluidos || [],
      parcial: rutinaEsParcial,
      codigo: rutinaEsParcial ? "RUTINA_PARCIAL_MENOS_DIAS" : null,
      dias_solicitados: perfilParaPrompt.dias_disponibles,
      dias_generados: rutina.dias.length,
    });
  } catch (err) {
    return responder(500, { error: "Error inesperado", detalle: textoAcotado(err) }, RESULTADO.ERROR_INESPERADO);
  }
});
