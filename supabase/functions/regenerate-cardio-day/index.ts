// Edge Function: regenerate-cardio-day
// -----------------------------------------------------------------------
// Regenera solo un día del plan de cardio activo, sin tocar los demás.
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

const CARDIO_DIA_TOOL = {
  name: "generar_dia_cardio",
  description: "Genera un solo día de un plan de cardio (fases de calentamiento, principal, enfriamiento).",
  input_schema: {
    type: "object",
    properties: {
      nombre_dia: { type: "string" },
      fases: {
        type: "array",
        items: {
          type: "object",
          properties: {
            fase: { type: "string", enum: ["calentamiento", "principal", "enfriamiento"] },
            actividad: { type: "string" },
            duracion_min: { type: "integer" },
            intensidad: { type: "string" },
            orden: { type: "integer" },
          },
          required: ["fase", "actividad", "duracion_min", "orden"],
        },
      },
    },
    required: ["nombre_dia", "fases"],
  },
};

function buildSystemPrompt(diaNumero: number): string {
  return `Eres un entrenador experto en cardio. El usuario ya tiene un plan de
cardio de varios días y te pide regenerar ÚNICAMENTE el día ${diaNumero} —
los demás días se quedan como están. Genera 3 fases en orden:
"calentamiento" (5-10 min, baja intensidad), "principal" (el cardio real),
y "enfriamiento" (5 min, baja intensidad). Usa actividades comunes de
gimnasio (caminadora, bicicleta estática, elíptica, remo, escaladora) con
intensidad concreta (velocidad, inclinación, o zona de esfuerzo).

Reglas obligatorias:
- Si "condiciones_medicas" no está vacío, es una condición médica real.
  Excluye por completo actividades de alto impacto si el diagnóstico lo
  sugiere (ej. correr o inclinación alta con lesiones de rodilla o columna),
  prioriza bicicleta/elíptica/remo (bajo impacto), y sé concreto en
  "nombre_dia" sobre qué evitaste.
- Responde ÚNICAMENTE llamando a la herramienta "generar_dia_cardio".`;
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
      max_tokens: 1200,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: [CARDIO_DIA_TOOL],
      tool_choice: { type: "tool", name: "generar_dia_cardio" },
      messages: [{ role: "user", content: `Genera el día de cardio para este usuario:\n${JSON.stringify(perfil)}` }],
    }),
  });
  if (!resp.ok) throw new Error(`Error de la API de Claude (${resp.status}): ${await resp.text()}`);
  const data = await resp.json();
  const bloque = data.content?.find((b: any) => b.type === "tool_use" && b.name === "generar_dia_cardio");
  if (!bloque) throw new Error("Claude no devolvió una tool call de generar_dia_cardio.");
  return bloque.input;
}

function validarDia(dia: any): string[] {
  const errores: string[] = [];
  if (!dia.fases || dia.fases.length === 0) { errores.push("El día no tiene fases."); return errores; }
  for (const f of dia.fases) {
    if (!["calentamiento", "principal", "enfriamiento"].includes(f.fase)) errores.push(`Fase inválida '${f.fase}'.`);
    if (typeof f.duracion_min !== "number" || f.duracion_min < 1 || f.duracion_min > 90) {
      errores.push(`Duración fuera de rango para '${f.actividad}' (${f.duracion_min}).`);
    }
  }
  return errores;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { dia } = await req.json();
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
      .from("rutinas").select("id").eq("usuario_id", user.id).eq("activa", true).eq("tipo", "cardio")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (rutinaError || !rutina) {
      return new Response(JSON.stringify({ error: "No tienes un plan de cardio activo todavía." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const perfilParaPrompt = {
      peso_kg: perfil.peso_kg, edad: perfil.edad, nivel: perfil.nivel,
      metas: perfil.metas, lesiones: perfil.lesiones, condiciones_medicas: perfil.condiciones_medicas || null,
    };

    const systemPrompt = buildSystemPrompt(dia);

    let diaGenerado: any = null;
    let errores: string[] = [];
    const INTENTOS_MAXIMOS = 2;

    for (let intento = 1; intento <= INTENTOS_MAXIMOS; intento++) {
      const candidato = await llamarClaude(systemPrompt, perfilParaPrompt);
      if (!candidato.fases || !Array.isArray(candidato.fases) || candidato.fases.length > 10) {
        console.error(`[regenerate-cardio-day] Respuesta degenerada en intento ${intento}: ${JSON.stringify(candidato).slice(0, 500)}`);
        if (intento < INTENTOS_MAXIMOS) continue;
        errores = ["El modelo generó una respuesta inválida dos veces seguidas. Intenta de nuevo en un momento."];
        break;
      }
      const erroresIntento = validarDia(candidato);
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
      .from("cardio_plan").delete().eq("rutina_id", rutina.id).eq("dia", dia);
    if (borrarError) {
      return new Response(JSON.stringify({ error: "No se pudo reemplazar el día anterior.", detalle: borrarError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const filas = diaGenerado.fases.map((f: any) => ({
      rutina_id: rutina.id, dia, nombre_dia: diaGenerado.nombre_dia,
      fase: f.fase, actividad: f.actividad, duracion_min: f.duracion_min,
      intensidad: f.intensidad || null, orden: f.orden,
    }));

    const { error: insertarError } = await supabaseAdmin.from("cardio_plan").insert(filas);
    if (insertarError) {
      return new Response(JSON.stringify({ error: "No se pudo guardar el nuevo día.", detalle: insertarError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ dia, nombre_dia: diaGenerado.nombre_dia, fases: diaGenerado.fases }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Error inesperado", detalle: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});