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
// 5. Valida la respuesta contra el catálogo y las lesiones.
// 6. Si es válida, la guarda en 'rutinas' y 'rutina_ejercicios', y desactiva
//    cualquier rutina anterior del usuario.
// -----------------------------------------------------------------------

import { createClient } from "npm:@supabase/supabase-js@2";

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

const ROUTINE_TOOL = {
  name: "generar_rutina",
  description: "Genera una rutina de entrenamiento estructurada por días.",
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
    },
    required: ["resumen", "dias"],
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
     en vez de forzar uno riesgoso.
  5. En "resumen", sé CONCRETO sobre qué excluiste y por qué (ej. "Se excluyó
     todo empuje sobre la cabeza y press pesado por la tendinopatía de
     manguito rotador e inestabilidad AC reportada; el trabajo de hombro se
     limita a estabilización controlada de baja carga."). Cierra siempre
     recordando que esto no sustituye la valoración de un médico o
     fisioterapeuta.
- Distribuye los ejercicios en tantos días como "dias_disponibles" indique el
  usuario, evitando entrenar el mismo grupo muscular en días consecutivos
  cuando sea posible.
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
- Si "evitar_maquinas" es true, PRIORIZA ejercicios con equipo "barra",
  "mancuernas", "polea" o "peso_corporal" sobre los de equipo "maquina" —
  el usuario prefiere esto porque las máquinas suelen tener fila de espera
  en horas pico, mientras que barras/mancuernas/polea suelen tener más
  disponibilidad. Usa "maquina" solo si de verdad no hay una alternativa
  razonable en el catálogo para ese grupo muscular.
- Responde ÚNICAMENTE llamando a la herramienta "generar_rutina".`;
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
      tools: [ROUTINE_TOOL],
      tool_choice: { type: "tool", name: "generar_rutina" },
      messages: [
        { role: "user", content: `Genera la rutina para este usuario:\n${JSON.stringify(perfil)}` },
      ],
    }),
  });

  if (!resp.ok) {
    const texto = await resp.text();
    throw new Error(`Error de la API de Claude (${resp.status}): ${texto}`);
  }

  const data = await resp.json();
  const bloque = data.content?.find((b: any) => b.type === "tool_use" && b.name === "generar_rutina");
  if (!bloque) throw new Error("Claude no devolvió una tool call de generar_rutina.");
  return bloque.input;
}

function validarRutina(rutina: any, catalogo: any[], perfil: any): string[] {
  const errores: string[] = [];
  const catalogoPorId = new Map(catalogo.map((e) => [e.exercise_id, e]));
  const lesiones = new Set(perfil.lesiones || []);
  const equipoDisponible = new Set(perfil.equipo_disponible || []);

  const dias = rutina?.dias || [];
  if (dias.length === 0) errores.push("La rutina no tiene ningún día definido.");

  if (perfil.dias_disponibles && dias.length !== perfil.dias_disponibles) {
    errores.push(`Se esperaban ${perfil.dias_disponibles} días, la rutina trae ${dias.length}.`);
  }

  let vistos = 0;
  for (const dia of dias) {
    for (const ej of dia.ejercicios || []) {
      vistos++;
      const catEj = catalogoPorId.get(ej.exercise_id);
      if (!catEj) {
        errores.push(`Día ${dia.dia}: '${ej.exercise_id}' no existe en el catálogo.`);
        continue;
      }
      const contraindicado = (catEj.contraindicaciones || []).filter((c: string) => lesiones.has(c));
      if (contraindicado.length > 0) {
        errores.push(`Día ${dia.dia}: '${catEj.nombre}' contraindicado para: ${contraindicado.join(", ")}.`);
      }
      if (equipoDisponible.size > 0 && !equipoDisponible.has(catEj.equipo)) {
        errores.push(`Día ${dia.dia}: '${catEj.nombre}' requiere equipo no disponible (${catEj.equipo}).`);
      }
      if (typeof ej.series !== "number" || ej.series < 1 || ej.series > 6) {
        errores.push(`Día ${dia.dia}: series fuera de rango para '${ej.exercise_id}' (${ej.series}).`);
      }
    }
  }
  if (vistos === 0) errores.push("La rutina no incluye ningún ejercicio.");

  return errores;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // "fuerza" por default: así las llamadas existentes (sin body) del
    // botón "Generar mi rutina" original siguen funcionando sin cambios.
    let tipo = "fuerza";
    try {
      const body = await req.json();
      if (body?.tipo) tipo = body.tipo;
    } catch (_e) {
      // sin body — está bien, usa el default
    }
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
      return new Response(
        JSON.stringify({ error: "No se encontró tu perfil. Guárdalo primero desde la app." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: catalogoCompleto, error: catalogoError } = await supabaseUsuario
      .from("ejercicios")
      .select("id, nombre, grupo_muscular, equipo, nivel, contraindicaciones");

    if (catalogoError || !catalogoCompleto) {
      return new Response(JSON.stringify({ error: "No se pudo cargar el catálogo de ejercicios." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
        return new Response(
          JSON.stringify({
            error: `Tu catálogo solo tiene ${catalogoFiltrado.length} ejercicios de abdomen etiquetados así — no es suficiente para generar una rutina variada. Revisa cómo está etiquetado el grupo muscular en tu tabla 'ejercicios'.`,
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
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

    const systemPrompt = buildSystemPrompt(catalogo, tipo);

    // A veces (sobre todo con perfiles complejos: varias metas + lesiones +
    // condición médica detallada) el modelo puede degenerar en una
    // respuesta sin sentido (cientos o miles de "días" vacíos). En vez de
    // fallarle al usuario de una, reintentamos UNA vez automáticamente
    // antes de rendirnos — esto cuesta una llamada extra solo si el primer
    // intento sale mal, no siempre.
    let rutina: any = null;
    let errores: string[] = [];
    const INTENTOS_MAXIMOS = 2;

    for (let intento = 1; intento <= INTENTOS_MAXIMOS; intento++) {
      const candidato = await llamarClaude(systemPrompt, perfilParaPrompt);

      // Chequeo de cordura ANTES de procesar nada más: una rutina real no
      // tiene más de ~10 días. Si trae más, es una respuesta degenerada —
      // ni vale la pena traducir referencias, solo reintentar.
      if (!candidato.dias || !Array.isArray(candidato.dias) || candidato.dias.length > 10) {
        console.error(
          `[generate-routine] tipo=${tipo} Respuesta degenerada en intento ${intento}: ` +
          `dias.length=${candidato.dias?.length ?? "N/A"}, catalogo.length=${catalogo.length}. ` +
          `Muestra de la respuesta: ${JSON.stringify(candidato).slice(0, 800)}`,
        );
        errores = [`Respuesta degenerada del modelo (${candidato.dias?.length ?? 0} "días"), reintentando...`];
        if (intento < INTENTOS_MAXIMOS) continue;
        errores = ["El modelo generó una respuesta inválida dos veces seguidas. Intenta de nuevo en un momento."];
        break;
      }

      // Traducir las referencias cortas (1, 2, 3...) de vuelta al
      // exercise_id real del catálogo, antes de validar y guardar.
      const lesionesUsuario = new Set(perfilParaPrompt.lesiones || []);
      for (const dia of candidato.dias || []) {
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
        candidato, catalogoFiltrado.map((ej) => ({ ...ej, exercise_id: ej.id })), perfilParaPrompt,
      );

      if (erroresIntento.length === 0) {
        rutina = candidato;
        errores = [];
        break;
      }

      errores = erroresIntento;
      // si falló pero aún quedan intentos, seguimos el loop (reintenta)
    }

    if (!rutina) {
      return new Response(
        JSON.stringify({ error: "La rutina generada no pasó la validación.", detalles: errores }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
      return new Response(JSON.stringify({ error: "No se pudo guardar la rutina.", detalle: rutinaError?.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      return new Response(
        JSON.stringify({ error: "No se pudieron guardar los ejercicios.", detalle: ejerciciosError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ rutina: nuevaRutina, dias: rutina.dias }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Error inesperado", detalle: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});