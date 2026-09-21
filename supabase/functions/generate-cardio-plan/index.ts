// Edge Function: generate-cardio-plan
// -----------------------------------------------------------------------
// Genera un plan de cardio por día (calentamiento, cardio principal,
// enfriamiento) — independiente del catálogo de ejercicios de fuerza,
// porque el cardio no se elige de una lista fija, se prescribe (actividad +
// duración + intensidad).
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

const CARDIO_TOOL = {
  name: "generar_plan_cardio",
  description: "Genera un plan de cardio por día, con fases de calentamiento, principal y enfriamiento.",
  input_schema: {
    type: "object",
    properties: {
      resumen: { type: "string" },
      dias: {
        type: "array",
        items: {
          type: "object",
          properties: {
            dia: { type: "integer" },
            nombre_dia: { type: "string", description: "Ej. 'Cardio moderado', 'HIIT ligero'" },
            fases: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  fase: { type: "string", enum: ["calentamiento", "principal", "enfriamiento"] },
                  actividad: { type: "string", description: "Ej. 'Caminadora inclinada', 'Bicicleta estática'" },
                  duracion_min: { type: "integer" },
                  intensidad: { type: "string", description: "Ej. 'velocidad 4, inclinación 2%' o 'zona 2, RPE 5'" },
                  orden: { type: "integer" },
                },
                required: ["fase", "actividad", "duracion_min", "orden"],
              },
            },
          },
          required: ["dia", "nombre_dia", "fases"],
        },
      },
    },
    required: ["resumen", "dias"],
  },
};

function buildSystemPrompt(): string {
  return `Eres un entrenador experto en cardio. Genera un plan de cardio por
día — NO es una rutina de fuerza, no uses pesas ni un catálogo de
ejercicios. Cada día debe tener 3 fases en orden: "calentamiento" (5-10 min,
baja intensidad), "principal" (el cardio real, ajustado a la meta e
intensidad del usuario), y "enfriamiento" (5 min, baja intensidad).

Usa actividades comunes de gimnasio: caminadora (con o sin inclinación),
bicicleta estática, elíptica, remo, escaladora — el usuario tiene acceso a
equipo de gimnasio estándar. Da intensidad concreta y accionable (velocidad,
inclinación, o zona de esfuerzo), no vaga.

Reglas obligatorias:
- Si "condiciones_medicas" no está vacío, es una condición médica real, no
  una preferencia. Razona así: (1) identifica qué tipo de impacto/carga es
  riesgoso dado el diagnóstico (ej. una fusión lumbar o lesión de rodilla
  hace que correr o la caminadora con inclinación alta sea de mayor riesgo
  por impacto; prioriza bicicleta, elíptica o remo, que son de bajo impacto),
  (2) EXCLUYE esas actividades de alto riesgo por completo, no las
  "moderes", (3) sé concreto en "resumen" sobre qué evitaste y por qué, y
  recuerda que esto no reemplaza la valoración de un médico o fisioterapeuta.
- Distribuye el cardio en tantos días como "dias_disponibles" indique el
  usuario.
- Si la meta principal del usuario es "pérdida de grasa" o "resistencia",
  dale más duración/frecuencia al cardio; si es "fuerza" o "hipertrofia",
  mantenlo moderado (no interferir con la recuperación de fuerza).
- Responde ÚNICAMENTE llamando a la herramienta "generar_plan_cardio".`;
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
      max_tokens: 4096,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: [CARDIO_TOOL],
      tool_choice: { type: "tool", name: "generar_plan_cardio" },
      messages: [{ role: "user", content: `Genera el plan de cardio para este usuario:\n${JSON.stringify(perfil)}` }],
    }),
  });

  if (!resp.ok) throw new Error(`Error de la API de Claude (${resp.status}): ${await resp.text()}`);

  const data = await resp.json();
  const bloque = data.content?.find((b: any) => b.type === "tool_use" && b.name === "generar_plan_cardio");
  if (!bloque) throw new Error("Claude no devolvió una tool call de generar_plan_cardio.");
  return bloque.input;
}

function validarPlan(plan: any): string[] {
  const errores: string[] = [];
  if (!plan.dias || plan.dias.length === 0) {
    errores.push("El plan no incluye ningún día.");
    return errores;
  }
  for (const dia of plan.dias) {
    if (!dia.fases || dia.fases.length === 0) {
      errores.push(`Día ${dia.dia}: no tiene fases definidas.`);
      continue;
    }
    for (const f of dia.fases) {
      if (!["calentamiento", "principal", "enfriamiento"].includes(f.fase)) {
        errores.push(`Día ${dia.dia}: fase inválida '${f.fase}'.`);
      }
      if (typeof f.duracion_min !== "number" || f.duracion_min < 1 || f.duracion_min > 90) {
        errores.push(`Día ${dia.dia}: duración fuera de rango para '${f.actividad}' (${f.duracion_min}).`);
      }
    }
  }
  return errores;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
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
      return new Response(JSON.stringify({ error: "No se encontró tu perfil. Guárdalo primero desde la app." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const perfilParaPrompt = {
      peso_kg: perfil.peso_kg, edad: perfil.edad, nivel: perfil.nivel,
      metas: perfil.metas, lesiones: perfil.lesiones,
      condiciones_medicas: perfil.condiciones_medicas || null,
      dias_disponibles: perfil.dias_disponibles_cardio || perfil.dias_disponibles,
    };

    const systemPrompt = buildSystemPrompt();

    let plan: any = null;
    let errores: string[] = [];
    const INTENTOS_MAXIMOS = 2;

    for (let intento = 1; intento <= INTENTOS_MAXIMOS; intento++) {
      const candidato = await llamarClaude(systemPrompt, perfilParaPrompt);

      // Chequeo de cordura: un plan real no tiene más de ~10 días.
      if (!candidato.dias || !Array.isArray(candidato.dias) || candidato.dias.length > 10) {
        console.error(
          `[generate-cardio-plan] Respuesta degenerada en intento ${intento}: ` +
          `dias.length=${candidato.dias?.length ?? "N/A"}. Muestra: ${JSON.stringify(candidato).slice(0, 500)}`,
        );
        if (intento < INTENTOS_MAXIMOS) continue;
        errores = ["El modelo generó una respuesta inválida dos veces seguidas. Intenta de nuevo en un momento."];
        break;
      }

      const erroresIntento = validarPlan(candidato);
      if (erroresIntento.length === 0) {
        plan = candidato;
        errores = [];
        break;
      }
      console.error(`[generate-cardio-plan] Validación falló en intento ${intento}: ${erroresIntento.join(" | ")}`);
      errores = erroresIntento;
    }

    if (!plan) {
      return new Response(JSON.stringify({ error: "El plan generado no pasó la validación.", detalles: errores }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    await supabaseAdmin.from("rutinas").update({ activa: false })
      .eq("usuario_id", user.id).eq("activa", true).eq("tipo", "cardio");

    const { data: nuevaRutina, error: rutinaError } = await supabaseAdmin
      .from("rutinas")
      .insert({ usuario_id: user.id, tipo: "cardio", nombre: "Plan de cardio generado", resumen: plan.resumen, activa: true })
      .select().single();

    if (rutinaError || !nuevaRutina) {
      return new Response(JSON.stringify({ error: "No se pudo guardar el plan.", detalle: rutinaError?.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const filas = plan.dias.flatMap((dia: any) =>
      dia.fases.map((f: any) => ({
        rutina_id: nuevaRutina.id, dia: dia.dia, nombre_dia: dia.nombre_dia,
        fase: f.fase, actividad: f.actividad, duracion_min: f.duracion_min,
        intensidad: f.intensidad || null, orden: f.orden,
      })),
    );

    const { error: insertarError } = await supabaseAdmin.from("cardio_plan").insert(filas);
    if (insertarError) {
      return new Response(JSON.stringify({ error: "No se pudieron guardar las fases.", detalle: insertarError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ rutina: nuevaRutina, dias: plan.dias }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Error inesperado", detalle: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});