// Edge Function: regenerate-day
// -----------------------------------------------------------------------
// Regenera SOLO un día de la rutina activa del usuario, no la semana
// completa. Le manda a Claude un resumen de qué grupos musculares ya
// cubren los OTROS días (para no repetir enfoque), genera únicamente el
// día pedido, y reemplaza solo esas filas en 'rutina_ejercicios' — el
// resto de la rutina queda intacto.
// -----------------------------------------------------------------------

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const ROUTINE_TOOL = {
  name: "generar_dia",
  description: "Genera UN SOLO día de una rutina de entrenamiento.",
  input_schema: {
    type: "object",
    properties: {
      nombre_dia: { type: "string", description: "Ej. 'Empuje', 'Pierna'" },
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
                properties: { exercise_id: { type: "string" }, motivo: { type: "string" } },
                required: ["exercise_id", "motivo"],
              },
            },
          },
          required: ["exercise_id", "series", "reps_objetivo", "orden"],
        },
      },
    },
    required: ["nombre_dia", "ejercicios"],
  },
};

function buildSystemPrompt(catalogo: unknown[], diaNumero: number, otrosDias: string, tipo: string): string {
  const intro = tipo === "abdominales"
    ? `Eres un entrenador experto en core/abdomen. El usuario ya tiene una
rutina de ABDOMEN de varios días, y te pide regenerar ÚNICAMENTE el día
${diaNumero} — los demás días se quedan como están, no los toques.`
    : `Eres un entrenador de fuerza experto. El usuario ya tiene una rutina
de varios días, y te pide regenerar ÚNICAMENTE el día ${diaNumero} — los
demás días de su rutina se quedan como están, no los toques ni los
menciones en tu respuesta.`;

  const reglaVolumen = tipo === "abdominales"
    ? `- Esta es una rutina de ABDOMEN, no de cuerpo completo. Usa repeticiones
  altas (12-20) o series por tiempo (ej. "30-45 seg") más que cargas
  pesadas.`
    : `- Si "evitar_maquinas" es true, prioriza barra, mancuernas, polea o peso
  corporal sobre máquinas.`;

  return `${intro}

CATÁLOGO DISPONIBLE (usa exclusivamente estos "exercise_id"):
${JSON.stringify(catalogo)}

Así están cubiertos los OTROS días (para que el día ${diaNumero} no repita
el mismo enfoque):
${otrosDias || "No hay otros días definidos todavía."}

Reglas obligatorias:
- Si el usuario reporta una lesión, NUNCA incluyas un ejercicio cuyo campo
  "contraindicaciones" contenga esa lesión.
- Si "condiciones_medicas" no está vacío, es una condición médica real, no
  una preferencia. Razona así: (1) identifica qué PATRONES DE MOVIMIENTO
  (no ejercicios sueltos) cargan la estructura afectada, (2) EXCLÚYELOS POR
  COMPLETO para este día, no los "aligeres", (3) si suena aguda/inflamatoria/
  post-quirúrgica/de inestabilidad, reduce el volumen de esa zona 30-50% y
  prioriza estabilización sobre progresión de carga, (4) si no hay
  suficientes ejercicios seguros, incluye menos ejercicios en vez de forzar
  uno riesgoso. Sé concreto en "nombre_dia" o notas sobre qué excluiste, y
  recuerda que esto no reemplaza la valoración de un médico o fisioterapeuta.
- Usa solo equipo presente en "equipo_disponible" del usuario.
${reglaVolumen}
- Para cada ejercicio, sugiere hasta 2 "alternativas" del mismo catálogo,
  con un "motivo" breve (menos de 10 palabras).
- Responde ÚNICAMENTE llamando a la herramienta "generar_dia".`;
}

async function llamarClaude(systemPrompt: string, perfil: unknown) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 1500,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: [ROUTINE_TOOL],
      tool_choice: { type: "tool", name: "generar_dia" },
      messages: [{ role: "user", content: `Genera el día para este usuario:\n${JSON.stringify(perfil)}` }],
    }),
  });

  if (!resp.ok) throw new Error(`Error de la API de Claude (${resp.status}): ${await resp.text()}`);

  const data = await resp.json();
  const bloque = data.content?.find((b: any) => b.type === "tool_use" && b.name === "generar_dia");
  if (!bloque) throw new Error("Claude no devolvió una tool call de generar_dia.");
  return bloque.input;
}

function validarDia(diaGenerado: any, catalogo: any[], perfil: any): string[] {
  const errores: string[] = [];
  const catalogoPorId = new Map(catalogo.map((e) => [e.exercise_id, e]));
  const lesiones = new Set(perfil.lesiones || []);
  const equipoDisponible = new Set(perfil.equipo_disponible || []);

  if (!diaGenerado.ejercicios || diaGenerado.ejercicios.length === 0) {
    errores.push("El día generado no incluye ningún ejercicio.");
    return errores;
  }

  for (const ej of diaGenerado.ejercicios) {
    const catEj = catalogoPorId.get(ej.exercise_id);
    if (!catEj) { errores.push(`'${ej.exercise_id}' no existe en el catálogo.`); continue; }
    const contraindicado = (catEj.contraindicaciones || []).filter((c: string) => lesiones.has(c));
    if (contraindicado.length > 0) errores.push(`'${catEj.nombre}' contraindicado para: ${contraindicado.join(", ")}.`);
    if (equipoDisponible.size > 0 && !equipoDisponible.has(catEj.equipo)) {
      errores.push(`'${catEj.nombre}' requiere equipo no disponible (${catEj.equipo}).`);
    }
    if (typeof ej.series !== "number" || ej.series < 1 || ej.series > 6) {
      errores.push(`Series fuera de rango para '${ej.exercise_id}' (${ej.series}).`);
    }
  }
  return errores;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { dia, tipo: tipoRaw } = await req.json();
    const tipo = tipoRaw === "abdominales" ? "abdominales" : "fuerza";
    if (!dia || typeof dia !== "number") {
      return new Response(JSON.stringify({ error: "Falta el número de día a regenerar." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUsuario = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUsuario.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: perfil, error: perfilError } = await supabaseUsuario
      .from("perfiles").select("*").eq("id", user.id).single();
    if (perfilError || !perfil) {
      return new Response(JSON.stringify({ error: "No se encontró tu perfil." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: rutina, error: rutinaError } = await supabaseUsuario
      .from("rutinas").select("id").eq("usuario_id", user.id).eq("activa", true).eq("tipo", tipo)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (rutinaError || !rutina) {
      return new Response(JSON.stringify({ error: "No tienes una rutina activa de este tipo todavía." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: ejerciciosActuales } = await supabaseUsuario
      .from("rutina_ejercicios").select("dia, nombre_dia, ejercicios(grupo_muscular)")
      .eq("rutina_id", rutina.id);

    const otrosDiasResumen = Array.from(
      new Map(
        (ejerciciosActuales || [])
          .filter((e: any) => e.dia !== dia)
          .map((e: any) => [e.dia, { dia: e.dia, nombre: e.nombre_dia, grupos: new Set() }]),
      ).values(),
    );
    for (const e of ejerciciosActuales || []) {
      if (e.dia === dia) continue;
      const entrada = otrosDiasResumen.find((d: any) => d.dia === e.dia);
      if (entrada && e.ejercicios?.grupo_muscular) entrada.grupos.add(e.ejercicios.grupo_muscular);
    }
    const otrosDiasTexto = otrosDiasResumen
      .map((d: any) => `Día ${d.dia} (${d.nombre}): ${[...d.grupos].join(", ")}`)
      .join("\n");

    const { data: catalogoCompleto, error: catalogoError } = await supabaseUsuario
      .from("ejercicios").select("id, nombre, grupo_muscular, equipo, nivel, contraindicaciones");
    if (catalogoError || !catalogoCompleto) {
      return new Response(JSON.stringify({ error: "No se pudo cargar el catálogo." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const equipoDisponible = new Set(perfil.equipo_disponible || []);
    let catalogoFiltrado = catalogoCompleto.filter(
      (ej) => equipoDisponible.size === 0 || equipoDisponible.has(ej.equipo),
    );
    if (tipo === "abdominales") {
      catalogoFiltrado = catalogoFiltrado.filter((ej) => {
        const g = (ej.grupo_muscular || "").toLowerCase();
        return g.includes("abdom") || g.includes("abs") || g.includes("core") || g.includes("obli") || g.includes("waist");
      });
      if (catalogoFiltrado.length < 3) {
        return new Response(
          JSON.stringify({ error: `Tu catálogo solo tiene ${catalogoFiltrado.length} ejercicios de abdomen etiquetados así.` }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }
    const catalogoPorRef = new Map<string, any>();
    const catalogo = catalogoFiltrado.map((ej, i) => {
      const ref = String(i + 1);
      catalogoPorRef.set(ref, ej);
      return {
        exercise_id: ref, nombre: ej.nombre, grupo_muscular: ej.grupo_muscular,
        equipo: ej.equipo, nivel: ej.nivel, contraindicaciones: ej.contraindicaciones || [],
      };
    });

    const perfilParaPrompt = {
      peso_kg: perfil.peso_kg, edad: perfil.edad, nivel: perfil.nivel,
      metas: perfil.metas, lesiones: perfil.lesiones, condiciones_medicas: perfil.condiciones_medicas || null,
      equipo_disponible: perfil.equipo_disponible, evitar_maquinas: perfil.evitar_maquinas || false,
    };

    const systemPrompt = buildSystemPrompt(catalogo, dia, otrosDiasTexto, tipo);

    let diaGenerado: any = null;
    let errores: string[] = [];
    const INTENTOS_MAXIMOS = 2;

    for (let intento = 1; intento <= INTENTOS_MAXIMOS; intento++) {
      const candidato = await llamarClaude(systemPrompt, perfilParaPrompt);

      if (!candidato.ejercicios || !Array.isArray(candidato.ejercicios) || candidato.ejercicios.length > 30) {
        errores = ["Respuesta degenerada del modelo, reintentando..."];
        if (intento < INTENTOS_MAXIMOS) continue;
        errores = ["El modelo generó una respuesta inválida dos veces seguidas. Intenta de nuevo en un momento."];
        break;
      }

      const lesionesUsuario = new Set(perfil.lesiones || []);
      for (const ej of candidato.ejercicios || []) {
        const real = catalogoPorRef.get(String(ej.exercise_id));
        ej.exercise_id = real ? real.id : `REF_INVALIDA_${ej.exercise_id}`;

        const alternativasTraducidas = [];
        for (const alt of ej.alternativas || []) {
          const realAlt = catalogoPorRef.get(String(alt.exercise_id));
          if (!realAlt) continue;
          const contraindicada = (realAlt.contraindicaciones || []).some((c: string) => lesionesUsuario.has(c));
          if (contraindicada) continue;
          alternativasTraducidas.push({ ejercicio_id: realAlt.id, nombre: realAlt.nombre, equipo: realAlt.equipo, motivo: alt.motivo });
        }
        ej.alternativas = alternativasTraducidas;
      }

      const erroresIntento = validarDia(candidato, catalogoFiltrado.map((ej) => ({ ...ej, exercise_id: ej.id })), perfilParaPrompt);
      if (erroresIntento.length === 0) {
        diaGenerado = candidato;
        errores = [];
        break;
      }
      errores = erroresIntento;
    }

    if (!diaGenerado) {
      return new Response(JSON.stringify({ error: "El día generado no pasó la validación.", detalles: errores }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { error: borrarError } = await supabaseAdmin
      .from("rutina_ejercicios").delete().eq("rutina_id", rutina.id).eq("dia", dia);
    if (borrarError) {
      return new Response(JSON.stringify({ error: "No se pudo reemplazar el día anterior.", detalle: borrarError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const filas = diaGenerado.ejercicios.map((ej: any) => ({
      rutina_id: rutina.id, ejercicio_id: ej.exercise_id, dia, nombre_dia: diaGenerado.nombre_dia,
      series: ej.series, reps_objetivo: ej.reps_objetivo, orden: ej.orden, alternativas: ej.alternativas || [],
    }));

    const { error: insertarError } = await supabaseAdmin.from("rutina_ejercicios").insert(filas);
    if (insertarError) {
      return new Response(JSON.stringify({ error: "No se pudo guardar el nuevo día.", detalle: insertarError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ dia, nombre_dia: diaGenerado.nombre_dia, ejercicios: diaGenerado.ejercicios }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Error inesperado", detalle: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});