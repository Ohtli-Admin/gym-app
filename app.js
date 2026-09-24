// =========================================================================
// Estado global
// =========================================================================
const estado = {
  sesion: undefined, // undefined = cargando, null = sin sesión
  pantalla: 'perfil', // GymApp 2.0 (GA-005 UX pass): Perfil es el destino post-login por defecto
  authModo: 'login', // 'login' | 'registro' | 'reset'
  dias: null,
  rutinaId: null,
  conteoDias: {}, // { 1: {total, estaSemana}, 2: {...} }
  cargandoRutina: false,
  errorRutina: null,
  diaActivo: 0,
  ejercicioActivo: null,
  pantallaOrigenRegistro: 'rutina', // a dónde regresar desde Registro: 'rutina' o 'abdomen'
  abdomen: {
    dias: null,
    rutinaId: null,
    conteoDias: {},
    cargando: false,
    error: null,
    diaActivo: 0,
    semanaActual: [],
    diasDisponibles: 0,
    tasaConsistenciaReciente: null,
  },
  cardio: {
    dias: null,
    rutinaId: null,
    conteoDias: {},
    cargando: false,
    error: null,
    diaActivo: 0,
    semanaActual: [],
    diasDisponibles: 0,
  },
  // Generación de planes (fuerza/abdomen/cardio) — GLOBAL, no local a
  // ninguna pantalla. Si el estado de "generando"/"mensaje" viviera en
  // nodos de DOM capturados, navegar a otra pantalla mientras la llamada
  // sigue en curso lo perdería (render() reemplaza #app). Aquí sobrevive a
  // cualquier cambio de pantalla — ver actualizarIndicadorGeneracion() y
  // bloqueEstadoGeneracion() en cada pantalla de producto.
  generacion: {
    fuerza: { activo: false, mensaje: null },
    abdomen: { activo: false, mensaje: null },
    cardio: { activo: false, mensaje: null },
  },
};

const LESIONES_COMUNES = ['Rodilla', 'Hombro', 'Espalda baja', 'Muñeca', 'Tobillo', 'Cadera'];
const METAS = ['Hipertrofia', 'Fuerza', 'Resistencia', 'Pérdida de grasa'];
const MAX_METAS = 3;
const ETIQUETAS_GENERACION = { fuerza: 'Fuerza', abdomen: 'Abdomen', cardio: 'Cardio' };

const app = document.getElementById('app');
const navContainer = document.getElementById('nav-container');
const indicadorGeneracion = document.getElementById('indicador-generacion');

// Banner global "Generando rutina de X…" — vive FUERA de #app a propósito
// (ver index.html), para que sobreviva a que render() reemplace
// app.innerHTML al cambiar de pantalla. Se actualiza cada vez que cambia
// estado.generacion, no solo dentro de render().
function actualizarIndicadorGeneracion() {
  if (!indicadorGeneracion) return;
  const activos = Object.entries(estado.generacion)
    .filter(([, g]) => g.activo)
    .map(([tipo]) => ETIQUETAS_GENERACION[tipo]);
  indicadorGeneracion.innerHTML = activos.length === 0
    ? ''
    : `<div class="g2-generando-banner"><div class="spinner-mini"></div>Generando rutina de ${activos.join(', ')}…</div>`;
}

function inicioDeSemana(fechaStr) {
  const d = new Date(fechaStr + 'T00:00:00');
  const diaSemana = d.getDay(); // 0 = domingo
  const offset = diaSemana === 0 ? -6 : 1 - diaSemana; // mueve al lunes
  d.setDate(d.getDate() + offset);
  return d;
}
function formatoFecha(d) { return d.toISOString().slice(0, 10); }

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// =========================================================================
// Arranque + sesión
// =========================================================================
// Confirmación antes de generar/regenerar (un plan completo o un solo
// día). GymApp 2.0 (GA-005 UX pass): el contexto persistente — metas,
// nivel, restricciones, equipo — se edita SOLO en Perfil; este modal solo
// muestra qué se va a usar y, si aplica, pregunta cuántos días.
// `pedirDias`: 'gym' | 'cardio' | null. Fuerza y Core comparten el mismo
// campo del perfil (dias_disponibles), porque generate-routine lo lee de
// ahí para ambos — y así se le dice al usuario. `producto` (fuerza/abdomen)
// muestra el objetivo especial activo cuando ese generador lo recibe.
async function abrirModalGeneracion({ titulo, descripcion, pedirDias = null, producto = null, textoConfirmar, onGenerar }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: perfil } = await supabase.from('perfiles')
    .select('peso_kg, edad, metas, lesiones, condiciones_medicas, dias_disponibles, dias_disponibles_cardio')
    .eq('id', user.id).maybeSingle();

  if (!perfil || !perfil.peso_kg || !perfil.edad) {
    alert('Primero completa y guarda tu Perfil (al menos peso y edad): GymApp lo usa para adaptar tus planes.');
    irAPantalla('perfil');
    return;
  }

  let dias = pedirDias === 'cardio' ? (perfil.dias_disponibles_cardio || 3) : (perfil.dias_disponibles || 4);
  const maxDias = pedirDias === 'cardio' ? 7 : 6;
  const objetivo = producto ? leerObjetivoEspecialParaProducto(producto) : '';
  const restricciones = [...(perfil.lesiones || []), ...(perfil.condiciones_medicas ? ['condición médica registrada'] : [])];

  const fondo = h(`
    <div class="modal-fondo">
      <div class="modal-caja">
        <h2 class="titulo" style="font-size:18px">${titulo}</h2>
        ${descripcion ? `<p class="subtitulo">${descripcion}</p>` : ''}
        ${pedirDias ? `
          <label class="etiqueta">${pedirDias === 'cardio' ? 'Días de cardio por semana' : 'Días de gym por semana'}: <span id="modal-dias-num">${dias}</span></label>
          <div class="chip-grid" id="modal-dias"></div>
          ${pedirDias === 'gym' ? '<p class="subtitulo g2-nota">Fuerza y Core comparten este número de días.</p>' : ''}` : ''}
        <div class="g2-contexto-usado">
          <label class="etiqueta">Se usará tu perfil</label>
          <p class="subtitulo">Metas: ${escaparHtml((perfil.metas || []).join(', ') || '—')}</p>
          <p class="subtitulo">Restricciones: ${escaparHtml(restricciones.join(', ') || 'ninguna')}</p>
          ${objetivo ? `<p class="subtitulo">Objetivo especial: “${escaparHtml(objetivo)}”</p>` : ''}
          <button type="button" class="g2-link-btn" id="modal-ir-perfil">Editar en Perfil</button>
        </div>
        <div id="modal-mensaje"></div>
        <div class="modal-botones">
          <button type="button" class="boton-secundario-caja" id="modal-cancelar">Cancelar</button>
          <button type="button" class="boton-primario" id="modal-confirmar">${textoConfirmar}</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(fondo);

  if (pedirDias) {
    const diasDiv = document.getElementById('modal-dias');
    const pintarDias = () => {
      diasDiv.innerHTML = Array.from({ length: maxDias }, (_, i) => i + 1)
        .map((d) => `<button type="button" class="chip ${dias === d ? 'activo' : ''}" data-md="${d}">${d}</button>`).join('');
      document.getElementById('modal-dias-num').textContent = dias;
      diasDiv.querySelectorAll('[data-md]').forEach((btn) => {
        btn.onclick = () => { dias = Number(btn.dataset.md); pintarDias(); };
      });
    };
    pintarDias();
  }

  document.getElementById('modal-cancelar').onclick = () => fondo.remove();
  document.getElementById('modal-ir-perfil').onclick = () => { fondo.remove(); irAPantalla('perfil'); };

  document.getElementById('modal-confirmar').onclick = async () => {
    const btn = document.getElementById('modal-confirmar');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div>';
    if (pedirDias) {
      const cambios = pedirDias === 'cardio' ? { dias_disponibles_cardio: dias } : { dias_disponibles: dias };
      const { error } = await supabase.from('perfiles').update(cambios).eq('id', user.id);
      if (error) {
        document.getElementById('modal-mensaje').innerHTML = `<div class="mensaje error">No se pudo guardar: ${escaparHtml(error.message)}</div>`;
        btn.disabled = false;
        btn.textContent = textoConfirmar;
        return;
      }
      if (pedirDias === 'cardio') perfilForm.diasCardio = dias;
      else perfilForm.dias = dias;
    }
    fondo.remove();
    onGenerar();
  };
}

async function iniciar() {
  const { data } = await supabase.auth.getSession();
  estado.sesion = data.session;
  render();

  supabase.auth.onAuthStateChange((_evt, nuevaSesion) => {
    estado.sesion = nuevaSesion;
    if (nuevaSesion) {
      cargarRutina();
      cargarRutinaAbdomen();
      cargarRutinaCardio();
    }
    render();
  });

  if (estado.sesion) {
    cargarRutina();
    cargarRutinaAbdomen();
    cargarRutinaCardio();
  }
}

function render() {
  if (estado.sesion === undefined) {
    app.innerHTML = '<div class="pantalla-carga">Cargando…</div>';
    navContainer.innerHTML = '';
    return;
  }
  if (!estado.sesion) {
    renderAuth();
    navContainer.innerHTML = '';
    return;
  }

  if (estado.pantalla === 'perfil' || estado.pantalla === 'onboarding') renderPerfil();
  else if (estado.pantalla === 'entrenamiento') renderEntrenamiento();
  else if (estado.pantalla === 'rutina') renderRutina();
  else if (estado.pantalla === 'cardio') renderCardio();
  else if (estado.pantalla === 'abdomen') renderAbdomen();
  else if (estado.pantalla === 'calistenia') renderCalistenia();
  else if (estado.pantalla === 'especial') renderEspecial();
  else if (estado.pantalla === 'entrenar') renderEntrenar();
  else if (estado.pantalla === 'registro') renderRegistro();
  else if (estado.pantalla === 'historial') renderHistorial();
  else if (estado.pantalla === 'extra') renderExtra();
  else {
    estado.pantalla = 'perfil';
    renderPerfil();
  }

  renderNav();
  actualizarIndicadorGeneracion();
}

// GymApp 2.0 (GA-005 UX pass): exactly THREE global destinations, one
// obvious place per action —
// - Perfil: what GymApp knows about you (edited only here).
// - Entrenamiento: every training product; view / create / regenerate.
// - Historial: what you already did (and logging extra activity).
// Every sub-screen belongs to exactly one of them (nav highlight).
const SECCION_POR_PANTALLA = {
  perfil: 'perfil',
  onboarding: 'perfil',
  entrenamiento: 'entrenamiento',
  rutina: 'entrenamiento',
  cardio: 'entrenamiento',
  abdomen: 'entrenamiento',
  calistenia: 'entrenamiento',
  especial: 'entrenamiento',
  entrenar: 'entrenamiento',
  registro: 'entrenamiento',
  historial: 'historial',
  extra: 'historial',
};

function irAPantalla(destino) {
  estado.pantalla = destino;
  render();
}

function renderNav() {
  const seccion = SECCION_POR_PANTALLA[estado.pantalla] || 'perfil';
  navContainer.innerHTML = `
    <div class="nav-inferior">
      <button class="nav-item ${seccion === 'perfil' ? 'activo' : ''}" data-nav="perfil"><span class="icono">👤</span>Perfil</button>
      <button class="nav-item ${seccion === 'entrenamiento' ? 'activo' : ''}" data-nav="entrenamiento"><span class="icono">🏋️</span>Entrenamiento</button>
      <button class="nav-item ${seccion === 'historial' ? 'activo' : ''}" data-nav="historial"><span class="icono">📅</span>Historial</button>
    </div>`;
  navContainer.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.onclick = () => irAPantalla(btn.dataset.nav);
  });
}

function escaparHtml(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function puenteEntrenamiento() {
  return window.GymAppTodayExperience || null;
}

// Objetivo especial "adaptar mis planes" (ver renderEspecial). Solo se
// envía a los productos cuyo generador lo acepta hoy (Fuerza y Core, vía
// generate-routine) — la lista vive en src/today-experience/special-training.mjs.
function leerObjetivoEspecial() {
  return puenteEntrenamiento()?.readAdaptObjective?.() || null;
}

function leerObjetivoEspecialParaProducto(producto) {
  const puente = puenteEntrenamiento();
  return puente ? puente.objectiveTextForProduct(producto, puente.readAdaptObjective()) : '';
}

// Controles de demo/desarrollo del armador de sesiones: ocultos en la UX
// normal; visibles solo con ?dev=1 en la URL.
function controlesDevActivos() {
  try {
    return new URLSearchParams(window.location.search).get('dev') === '1';
  } catch (e) {
    return false;
  }
}

// Cabecera común de toda pantalla de producto: siempre regresa al hub.
function encabezadoProducto(titulo, subtitulo) {
  return `
    <button type="button" class="g2-back" data-volver-entrenamiento>‹ Entrenamiento</button>
    <header class="g2-appbar"><h1>${titulo}</h1>${subtitulo ? `<p>${subtitulo}</p>` : ''}</header>`;
}

function conectarVolverEntrenamiento() {
  app.querySelectorAll('[data-volver-entrenamiento]').forEach((btn) => {
    btn.onclick = () => irAPantalla('entrenamiento');
  });
}

// =========================================================================
// Planes con generación (Fuerza, Core, Cardio) — gramática común.
// Crear / regenerar / cambiar días pasan TODOS por abrirGeneracionPlan()
// -> abrirModalGeneracion() -> invocarGeneracion(): un solo camino por
// acción, sin importar desde dónde se pida (hub, pantalla del producto,
// Entrenamiento especial).
// =========================================================================
const PLANES = {
  fuerza: {
    nombre: 'Fuerza / Gimnasio',
    nombreCorto: 'Fuerza',
    icono: '💪',
    pantalla: 'rutina',
    funcion: 'generate-routine',
    body: undefined,
    pedirDias: 'gym',
    dias: () => estado.dias,
    cargando: () => estado.cargandoRutina,
  },
  cardio: {
    nombre: 'Cardio',
    nombreCorto: 'Cardio',
    icono: '🏃',
    pantalla: 'cardio',
    funcion: 'generate-cardio-plan',
    body: undefined,
    pedirDias: 'cardio',
    dias: () => estado.cardio.dias,
    cargando: () => estado.cardio.cargando,
  },
  abdomen: {
    nombre: 'Core / Abdomen',
    nombreCorto: 'Core',
    icono: '🔥',
    pantalla: 'abdomen',
    funcion: 'generate-routine',
    body: { tipo: 'abdominales' },
    pedirDias: 'gym',
    dias: () => estado.abdomen.dias,
    cargando: () => estado.abdomen.cargando,
  },
};

function planActivo(tipo) {
  const dias = PLANES[tipo].dias();
  return Boolean(dias && dias.length > 0);
}

// `modo`: 'crear' | 'regenerar'. Regenerar también es donde se cambian
// los días: un plan semanal ya generado no se puede "estirar" a otro
// número de días sin generarlo de nuevo.
function abrirGeneracionPlan(tipo, modo) {
  const plan = PLANES[tipo];
  const crear = modo === 'crear';
  abrirModalGeneracion({
    titulo: crear ? `Crear plan de ${plan.nombreCorto}` : `Regenerar plan de ${plan.nombreCorto}`,
    descripcion: crear
      ? '¿Cuántos días por semana quieres entrenar?'
      : 'Se genera un plan nuevo que reemplaza al activo. Tu historial se conserva.',
    pedirDias: plan.pedirDias,
    producto: tipo,
    textoConfirmar: crear ? 'Crear plan' : 'Generar plan nuevo',
    onGenerar: () => invocarGeneracion(tipo, plan.funcion, plan.body),
  });
}

// Estado de generación + objetivo especial, dentro de la pantalla del
// producto (no en una pantalla aparte).
function bloqueEstadoGeneracion(tipo) {
  const gen = estado.generacion[tipo];
  const objetivo = leerObjetivoEspecialParaProducto(tipo);
  return `
    ${gen.activo ? '<div class="mensaje info">Generando plan nuevo… puedes seguir usando la app.</div>' : ''}
    ${!gen.activo && gen.mensaje ? `<div class="mensaje ${gen.mensaje.tipo}">${escaparHtml(gen.mensaje.texto)}</div>` : ''}
    ${objetivo ? `<p class="subtitulo g2-nota">Objetivo especial activo: “${escaparHtml(objetivo)}”. Se usa al regenerar este plan.</p>` : ''}`;
}

function botonCrearPlanHtml(tipo) {
  const activo = estado.generacion[tipo].activo;
  return `<button type="button" class="boton-primario g2-cta" data-plan-accion="crear" ${activo ? 'disabled' : ''}>${activo ? 'Generando…' : 'Crear plan'}</button>`;
}

// Acciones secundarias del plan, detrás de "Ajustar plan" (progresivo).
function bloqueAjustesPlan(tipo, { idRegenerarDia, idMensajeDia }) {
  const activo = estado.generacion[tipo].activo;
  return `
    <details class="g2-disclosure g2-ajustes-plan">
      <summary>Ajustar plan</summary>
      <button type="button" class="boton-secundario" data-plan-accion="regenerar" ${activo ? 'disabled' : ''}>🔁 Regenerar plan o cambiar días</button>
      <button type="button" class="boton-secundario" id="${idRegenerarDia}">🔄 Regenerar solo este día con IA</button>
      <div id="${idMensajeDia}"></div>
    </details>`;
}

function conectarAccionesPlan(tipo) {
  app.querySelectorAll('[data-plan-accion]').forEach((btn) => {
    btn.onclick = () => abrirGeneracionPlan(tipo, btn.dataset.planAccion);
  });
  conectarVolverEntrenamiento();
}

// =========================================================================
// Entrenamiento — el hub de TODOS los productos de entrenamiento. Cada
// tarjeta tiene UNA acción principal: "Ver plan" si hay plan activo,
// "Crear plan" si no (abre directamente la creación). No hay otro lugar
// de la app que genere planes semanales.
// =========================================================================
function renderEntrenamiento() {
  const puente = puenteEntrenamiento();
  const objetivo = leerObjetivoEspecial();
  const enCurso = puente?.hasActiveSession?.();

  const tarjetasPlanes = Object.entries(PLANES).map(([tipo, plan]) => {
    const activo = planActivo(tipo);
    const generando = estado.generacion[tipo].activo;
    let estadoTxt = 'Sin plan activo';
    if (generando) estadoTxt = 'Generando plan…';
    else if (!activo && plan.cargando()) estadoTxt = 'Cargando…';
    else if (activo) {
      estadoTxt = `Plan activo · ${plan.dias().length} día(s) por semana`;
      if (tipo === 'fuerza' && perfilForm.metas?.[0]) estadoTxt += ` · ${escaparHtml(perfilForm.metas[0])}`;
    }
    return `
      <div class="g2-product-card">
        <div class="g2-product-info">
          <div class="g2-product-name">${plan.icono} ${plan.nombre}</div>
          <div class="g2-product-status">${estadoTxt}</div>
        </div>
        <button type="button" class="g2-btn-secondary" data-producto="${tipo}" data-activo="${activo ? '1' : ''}" ${!activo && generando ? 'disabled' : ''}>${activo ? 'Ver plan' : 'Crear plan'}</button>
      </div>`;
  }).join('');

  app.innerHTML = '';
  app.appendChild(h(`
    <div>
      <header class="g2-appbar"><h1>Entrenamiento</h1><p>Tus planes y sesiones</p></header>
      ${enCurso ? `
        <div class="mensaje info g2-resume-banner">
          Tienes una sesión en curso.
          <button type="button" class="g2-link-btn" id="btn-continuar-sesion">Continuar →</button>
        </div>` : ''}
      ${tarjetasPlanes}
      <div class="g2-product-card">
        <div class="g2-product-info">
          <div class="g2-product-name">🤸 Calistenia</div>
          <div class="g2-product-status">Sesión bajo demanda (aún no se guarda como plan)</div>
        </div>
        <button type="button" class="g2-btn-secondary" id="btn-calistenia">Crear sesión</button>
      </div>
      <div class="g2-product-card">
        <div class="g2-product-info">
          <div class="g2-product-name">✨ Entrenamiento especial</div>
          <div class="g2-product-status">${objetivo ? `Objetivo activo: “${escaparHtml(objetivo.text)}”` : 'Algo temporal o fuera de lo normal'}</div>
        </div>
        <button type="button" class="g2-btn-secondary" id="btn-especial">Abrir</button>
      </div>
    </div>`));

  app.querySelectorAll('[data-producto]').forEach((btn) => {
    btn.onclick = () => {
      const tipo = btn.dataset.producto;
      if (btn.dataset.activo) irAPantalla(PLANES[tipo].pantalla);
      else abrirGeneracionPlan(tipo, 'crear');
    };
  });
  const continuar = document.getElementById('btn-continuar-sesion');
  if (continuar) continuar.onclick = () => irAPantalla('entrenar');
  document.getElementById('btn-calistenia').onclick = () => irAPantalla('calistenia');
  document.getElementById('btn-especial').onclick = () => {
    // Entrar desde el hub empieza limpio (sin el aviso/sesión de la visita
    // anterior); el texto a medio escribir sí se conserva.
    especialUi.aplicado = null;
    especialUi.mensaje = null;
    irAPantalla('especial');
  };
}

// Calistenia: todavía NO hay un plan semanal persistido para este
// producto; lo honesto es presentarlo como sesión bajo demanda (pipeline
// Context Engine -> Compatibility Engine -> Workout Planner, bloqueado a
// la modalidad calistenia). Cuando exista un plan, esta pantalla puede
// ganar "Ver plan" sin cambiar la navegación global.
function renderCalistenia() {
  app.innerHTML = '';
  app.appendChild(h(`
    <div>
      ${encabezadoProducto('Calistenia', 'Sesión bajo demanda')}
      <p class="subtitulo g2-nota">Por ahora Calistenia arma una sesión para hoy; todavía no guarda un plan semanal.</p>
      <div id="today-root"></div>
    </div>`));
  conectarVolverEntrenamiento();
  montarArmadorSesion(document.getElementById('today-root'), { lockedModalities: ['calisthenics'] });
}

// =========================================================================
// Entrenamiento especial — una necesidad temporal o fuera de lo normal,
// en palabras del usuario. Dos intenciones explícitas (nunca inferidas del
// texto): entrenamiento independiente (una sesión puntual) o adaptar los
// planes actuales (objetivo que persiste hasta que el usuario lo quita).
// El texto NO es diagnóstico ni restricción: nunca se convierte en
// filtros; como mucho se envía, etiquetado, al generador de Fuerza/Core.
// =========================================================================
const especialUi = { texto: '', modo: null, aplicado: null, mensaje: null };

function renderEspecial() {
  const puente = puenteEntrenamiento();
  if (!puente) {
    app.innerHTML = '<div class="mensaje error">No se pudo cargar el módulo de entrenamiento. Revisa la consola.</div>';
    return;
  }
  const MODOS = puente.SPECIAL_TRAINING_MODES;
  const objetivo = puente.readAdaptObjective();
  const productosConObjetivo = puente.productsUsingObjective().map((t) => PLANES[t].nombreCorto);
  const maximo = puente.TODAY_INTENT_MAX_LENGTH;

  const opcion = (modo, titulo, texto) => `
    <button type="button" class="g2-opcion ${especialUi.modo === modo ? 'activo' : ''}" data-modo="${modo}">
      <strong>${titulo}</strong><span>${texto}</span>
    </button>`;

  app.innerHTML = '';
  app.appendChild(h(`
    <div>
      ${encabezadoProducto('Entrenamiento especial', 'Algo temporal o fuera de lo normal')}

      ${objetivo ? `
        <section class="g2-card">
          <label class="etiqueta">Objetivo activo para tus planes</label>
          <p class="g2-contexto-texto">“${escaparHtml(objetivo.text)}”</p>
          ${especialUi.mensaje ? `<div class="mensaje info">${especialUi.mensaje}</div>` : ''}
          <p class="subtitulo g2-nota">Se aplica cuando generas o regeneras: ${productosConObjetivo.join(' y ')}. Cardio y Calistenia todavía no lo usan. No cambia tus planes por sí solo.</p>
          <div class="g2-intent-acciones">
            ${puente.productsUsingObjective().map((t) => `<button type="button" class="g2-btn-secondary" data-aplicar="${t}" ${estado.generacion[t].activo ? 'disabled' : ''}>${planActivo(t) ? 'Regenerar' : 'Crear'} ${PLANES[t].nombreCorto}</button>`).join('')}
          </div>
          <button type="button" class="g2-link-btn" id="btn-quitar-objetivo">Quitar objetivo</button>
        </section>` : ''}

      <section class="g2-card">
        <label class="etiqueta" for="especial-texto">¿Qué quieres preparar o resolver?</label>
        <textarea class="input-modal g2-intent-input" id="especial-texto" rows="4" maxlength="${maximo}"
          placeholder="Ej.: Hoy no fui al gimnasio y quiero hacer calistenia en casa. En 30 días voy a un concierto y quiero mejorar mi condición.">${escaparHtml(especialUi.texto)}</textarea>
        <p class="subtitulo g2-intent-nota">Es contexto para tu entrenamiento, no un diagnóstico. Tus lesiones y condiciones se editan en Perfil.</p>

        <label class="etiqueta">¿Cómo quieres aplicar este objetivo?</label>
        <div class="g2-opciones">
          ${opcion(MODOS.INDEPENDENT, 'Crear un entrenamiento independiente', 'Para algo puntual: hoy no fui al gym, entreno en casa, estoy de viaje.')}
          ${opcion(MODOS.ADAPT_PLANS, 'Adaptar mis planes actuales', 'Para algo temporal que debe influir en tus planes: un evento en 30 días.')}
        </div>
        <button type="button" class="boton-primario g2-cta" id="especial-continuar">Continuar</button>
        <div id="especial-mensaje"></div>
      </section>

      ${especialUi.aplicado === MODOS.INDEPENDENT ? `
        <section>
          <label class="etiqueta">Tu sesión independiente</label>
          <p class="subtitulo g2-nota">Elige tiempo, lugar y modalidades para esta sesión. Tu texto queda como referencia: todavía no se interpreta automáticamente.</p>
          <div id="today-root"></div>
        </section>` : ''}
    </div>`));

  conectarVolverEntrenamiento();
  const textarea = document.getElementById('especial-texto');
  textarea.oninput = () => { especialUi.texto = textarea.value; };

  app.querySelectorAll('[data-modo]').forEach((btn) => {
    btn.onclick = () => {
      especialUi.texto = textarea.value;
      especialUi.modo = btn.dataset.modo;
      renderEspecial();
    };
  });

  document.getElementById('especial-continuar').onclick = () => {
    especialUi.texto = textarea.value;
    const mensajeDiv = document.getElementById('especial-mensaje');
    if (!especialUi.texto.trim()) {
      mensajeDiv.innerHTML = '<div class="mensaje error">Escribe qué quieres preparar o resolver.</div>';
      return;
    }
    if (!especialUi.modo) {
      mensajeDiv.innerHTML = '<div class="mensaje error">Elige cómo quieres aplicar este objetivo.</div>';
      return;
    }
    if (especialUi.modo === MODOS.ADAPT_PLANS) {
      puente.saveAdaptObjective(especialUi.texto);
      especialUi.texto = '';
      especialUi.modo = null;
      especialUi.aplicado = MODOS.ADAPT_PLANS;
      especialUi.mensaje = 'Objetivo guardado. Todavía no cambió ningún plan: elige abajo cuál generar con este objetivo.';
    } else {
      especialUi.aplicado = MODOS.INDEPENDENT;
      especialUi.mensaje = null;
    }
    renderEspecial();
  };

  app.querySelectorAll('[data-aplicar]').forEach((btn) => {
    btn.onclick = () => {
      const tipo = btn.dataset.aplicar;
      abrirGeneracionPlan(tipo, planActivo(tipo) ? 'regenerar' : 'crear');
    };
  });
  const quitar = document.getElementById('btn-quitar-objetivo');
  if (quitar) {
    quitar.onclick = () => {
      puente.clearAdaptObjective();
      especialUi.aplicado = null;
      especialUi.mensaje = null;
      renderEspecial();
    };
  }

  if (especialUi.aplicado === MODOS.INDEPENDENT) {
    montarArmadorSesion(document.getElementById('today-root'), {});
  }
}

// Entrenar: la sesión en curso (su estado vive en el store compartido de
// src/today-experience/workout-session.mjs, así sobrevive a navegar).
// Si no hay nada en curso, el módulo muestra un estado vacío que regresa a
// Entrenamiento.
function renderEntrenar() {
  app.innerHTML = '<div id="today-root"></div>';
  const contenedor = document.getElementById('today-root');
  if (window.GymAppTodayExperience) {
    window.GymAppTodayExperience.mount(contenedor, { screen: 'active', navigate: irAPantalla });
  } else {
    contenedor.innerHTML = '<div class="mensaje error">No se pudo cargar el módulo de entrenamiento. Revisa la consola.</div>';
  }
}

// Armador de sesiones bajo demanda (tiempo/lugar/modalidades de ESA
// sesión — nunca de un plan semanal). Lo usan Calistenia y el modo
// "entrenamiento independiente" de Entrenamiento especial.
function montarArmadorSesion(contenedor, { lockedModalities = null }) {
  if (!contenedor) return;
  if (!window.GymAppTodayExperience) {
    contenedor.innerHTML = '<div class="mensaje error">No se pudo cargar el módulo de entrenamiento. Revisa la consola.</div>';
    return;
  }
  window.GymAppTodayExperience.mount(contenedor, {
    screen: 'home',
    navigate: irAPantalla,
    lockedModalities,
    title: null,
    showDevControls: controlesDevActivos(),
  });
}

// =========================================================================
// Auth
// =========================================================================
function renderAuth() {
  const modo = estado.authModo;
  app.innerHTML = '';
  app.appendChild(h(`
    <div>
      <h1 class="titulo">${modo === 'login' ? 'Inicia sesión' : modo === 'registro' ? 'Crea tu cuenta' : 'Recupera tu contraseña'}</h1>
      <p class="subtitulo">${modo === 'login' ? 'Bienvenido de vuelta' : modo === 'registro' ? 'Para guardar tu progreso y tus rutinas' : 'Te mandamos un enlace a tu correo'}</p>
      <div class="campo">
        <label class="etiqueta">Correo</label>
        <input type="email" id="auth-email" placeholder="tucorreo@ejemplo.com" autocapitalize="none" />
      </div>
      ${modo !== 'reset' ? `
      <div class="campo">
        <label class="etiqueta">Contraseña</label>
        <input type="password" id="auth-password" placeholder="Mínimo 6 caracteres" />
      </div>` : ''}
      <div id="auth-mensaje"></div>
      <button class="boton-primario" id="auth-submit">${modo === 'login' ? 'Entrar' : modo === 'registro' ? 'Registrarme' : 'Enviar enlace'}</button>
      ${modo === 'login' ? '<button class="boton-secundario" id="auth-olvide">¿Olvidaste tu contraseña?</button>' : ''}
      <button class="boton-secundario" id="auth-cambiar-modo">
        ${modo === 'login' ? '¿No tienes cuenta? Regístrate' : modo === 'registro' ? '¿Ya tienes cuenta? Inicia sesión' : 'Volver a inicio de sesión'}
      </button>
    </div>`));

  const mensajeDiv = document.getElementById('auth-mensaje');
  const setMensaje = (tipo, texto) => {
    mensajeDiv.innerHTML = texto ? `<div class="mensaje ${tipo}">${texto}</div>` : '';
  };

  document.getElementById('auth-submit').onclick = async () => {
    const email = document.getElementById('auth-email').value.trim();
    if (!email.includes('@')) return setMensaje('error', 'Escribe un correo válido.');

    if (modo === 'reset') {
      setMensaje(null, '');
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) setMensaje('error', error.message);
      else setMensaje('info', 'Si ese correo tiene cuenta, te llegó un enlace para restablecer tu contraseña.');
      return;
    }

    const password = document.getElementById('auth-password').value;
    if (password.length < 6) return setMensaje('error', 'La contraseña debe tener al menos 6 caracteres.');

    setMensaje(null, '');
    if (modo === 'registro') {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setMensaje('error', error.message);
      else setMensaje('info', 'Cuenta creada. Revisa tu correo para confirmarla.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMensaje('error', error.message);
    }
  };

  const olvide = document.getElementById('auth-olvide');
  if (olvide) olvide.onclick = () => { estado.authModo = 'reset'; render(); };

  document.getElementById('auth-cambiar-modo').onclick = () => {
    estado.authModo = modo === 'login' ? 'registro' : 'login';
    render();
  };
}

// =========================================================================
// Perfil — pantalla de llegada. El contexto persistente que GymApp usa
// para adaptar TODOS los planes, y el ÚNICO lugar donde se edita (antes
// estaba repartido entre Perfil, Generador y el modal de generación).
// Sin acciones de generación aquí: eso vive en Entrenamiento.
// Un solo estado (`perfilForm`, precargado en cargarRutina) y un solo
// guardado (guardarPerfil).
// =========================================================================
const NIVELES = [
  { valor: 'principiante', etiqueta: 'Principiante' },
  { valor: 'intermedio', etiqueta: 'Intermedio' },
  { valor: 'avanzado', etiqueta: 'Avanzado' },
];
// Valores tal como los usa `ejercicios.equipo` (y la validación de
// generate-routine contra `perfiles.equipo_disponible`).
const EQUIPOS = [
  { valor: 'barra', etiqueta: 'Barra' },
  { valor: 'mancuernas', etiqueta: 'Mancuernas' },
  { valor: 'polea', etiqueta: 'Polea' },
  { valor: 'maquina', etiqueta: 'Máquinas' },
  { valor: 'peso_corporal', etiqueta: 'Peso corporal' },
];

const perfilForm = {
  nombre: '',
  peso: '',
  edad: '',
  nivel: 'intermedio',
  metas: ['Hipertrofia'],
  lesiones: [],
  condicionesMedicas: '',
  dias: 4,
  diasCardio: 3,
  equipo: EQUIPOS.map((e) => e.valor),
  evitarMaquinas: false,
};
// true cuando ya se intentó leer el perfil de la base (exista o no) — así
// "Guardar" nunca sobrescribe el perfil real con los valores por defecto.
let perfilPrecargado = false;

function renderPerfil() {
  if (!perfilPrecargado) {
    app.innerHTML = '<div class="pantalla-carga"><div class="spinner"></div></div>';
    return;
  }

  app.innerHTML = '';
  app.appendChild(h(`
    <div>
      <header class="g2-appbar">
        <h1>${perfilForm.nombre ? `Hola, ${escaparHtml(perfilForm.nombre)}` : 'Perfil'}</h1>
        <p>Esto es lo que GymApp sabe de ti y usa para adaptar tus planes.</p>
      </header>

      <section class="g2-card">
        <h2 class="g2-seccion">Datos básicos</h2>
        <div class="campo">
          <label class="etiqueta">Tu nombre</label>
          <input type="text" id="p-nombre" placeholder="¿Cómo te llamas?" value="${escaparHtml(perfilForm.nombre)}" />
        </div>
        <div class="fila-2col">
          <div><label class="etiqueta">Peso (kg)</label><input type="number" id="p-peso" placeholder="70" value="${escaparHtml(perfilForm.peso)}" /></div>
          <div><label class="etiqueta">Edad</label><input type="number" id="p-edad" placeholder="28" value="${escaparHtml(perfilForm.edad)}" /></div>
        </div>
        <label class="etiqueta">Nivel de entrenamiento</label>
        <div class="chip-grid" id="p-nivel"></div>
      </section>

      <section class="g2-card">
        <h2 class="g2-seccion">Objetivos</h2>
        <label class="etiqueta">Tus metas (hasta ${MAX_METAS})</label>
        <div class="chip-grid" id="p-metas"></div>
        <div id="p-prioridad"></div>
      </section>

      <section class="g2-card">
        <h2 class="g2-seccion">Disponibilidad</h2>
        <label class="etiqueta">Días de gym por semana (Fuerza y Core): <span id="p-dias-num">${perfilForm.dias}</span></label>
        <div class="chip-grid" id="p-dias"></div>
        <label class="etiqueta">Días de cardio por semana: <span id="p-dias-cardio-num">${perfilForm.diasCardio}</span></label>
        <div class="chip-grid" id="p-dias-cardio"></div>
        <label class="etiqueta">Equipo al que sueles tener acceso</label>
        <div class="chip-grid" id="p-equipo"></div>
      </section>

      <section class="g2-card">
        <h2 class="g2-seccion">Restricciones y consideraciones</h2>
        <label class="etiqueta">Lesiones o limitaciones</label>
        <div class="chip-grid" id="p-lesiones"></div>
        <label class="etiqueta">Condición médica específica (opcional, pero importante)</label>
        <textarea class="input-modal" id="p-condiciones">${escaparHtml(perfilForm.condicionesMedicas)}</textarea>
        <p class="subtitulo g2-nota">Esto no sustituye la valoración de tu médico o fisioterapeuta. Se mantiene hasta que tú lo cambies.</p>
        <div class="toggle-fila ${perfilForm.evitarMaquinas ? 'activo' : ''}" id="p-evitar-maquinas">
          <div class="toggle-dot"></div>
          <div class="toggle-texto">
            <strong>Priorizar equipo con más disponibilidad</strong>
            <span>Barra, mancuernas, polea y peso corporal en vez de máquinas.</span>
          </div>
        </div>
      </section>

      <div id="p-mensaje"></div>
      <button type="button" class="boton-primario" id="p-guardar">Guardar perfil</button>

      <h2 class="titulo" style="font-size:16px;margin-top:30px;margin-bottom:2px">Tu peso corporal</h2>
      <p class="subtitulo">Independiente del peso que usa la rutina — esto es tu historial en el tiempo</p>
      <div id="peso-form"></div>
      <div id="peso-grafica"></div>
      <div id="peso-lista"></div>

      <button type="button" class="boton-secundario" id="p-salir" style="margin-top:24px">Cerrar sesión</button>
    </div>`));

  // Cada grupo de chips se repinta solo a sí mismo (no toda la pantalla),
  // para no perder lo que el usuario ya escribió en los campos de texto.
  const pintarChips = (id, opciones, esActivo, alTocar, deshabilitado = () => false) => {
    const div = document.getElementById(id);
    const pintar = () => {
      div.innerHTML = opciones.map((o) => `<button type="button" class="chip ${esActivo(o.valor) ? 'activo' : ''}" data-v="${o.valor}" ${deshabilitado(o.valor) ? 'disabled' : ''}>${o.etiqueta}</button>`).join('');
      div.querySelectorAll('[data-v]').forEach((btn) => {
        btn.onclick = () => { alTocar(btn.dataset.v); pintar(); };
      });
    };
    pintar();
    return pintar;
  };

  pintarChips('p-nivel', NIVELES, (v) => perfilForm.nivel === v, (v) => { perfilForm.nivel = v; });

  const prioridadDiv = document.getElementById('p-prioridad');
  let repintarMetas = () => {};
  const pintarPrioridad = () => {
    if (perfilForm.metas.length <= 1) { prioridadDiv.innerHTML = ''; return; }
    prioridadDiv.innerHTML = `
      <label class="etiqueta">¿Cuál es tu prioridad principal?</label>
      <div class="chip-grid">
        ${perfilForm.metas.map((m, i) => `<button type="button" class="chip ${i === 0 ? 'activo' : ''}" data-prio="${m}">${i === 0 ? '★ ' : ''}${m}</button>`).join('')}
      </div>`;
    prioridadDiv.querySelectorAll('[data-prio]').forEach((btn) => {
      btn.onclick = () => {
        const m = btn.dataset.prio;
        perfilForm.metas = [m, ...perfilForm.metas.filter((x) => x !== m)];
        repintarMetas();
        pintarPrioridad();
      };
    });
  };
  repintarMetas = pintarChips(
    'p-metas',
    METAS.map((m) => ({ valor: m, etiqueta: m })),
    (v) => perfilForm.metas.includes(v),
    (v) => {
      if (perfilForm.metas.includes(v)) perfilForm.metas = perfilForm.metas.filter((x) => x !== v);
      else if (perfilForm.metas.length < MAX_METAS) perfilForm.metas = [...perfilForm.metas, v];
      pintarPrioridad();
    },
    (v) => !perfilForm.metas.includes(v) && perfilForm.metas.length >= MAX_METAS,
  );
  pintarPrioridad();

  const opcionesDias = (max) => Array.from({ length: max }, (_, i) => ({ valor: String(i + 1), etiqueta: String(i + 1) }));
  pintarChips('p-dias', opcionesDias(6), (v) => perfilForm.dias === Number(v), (v) => {
    perfilForm.dias = Number(v);
    document.getElementById('p-dias-num').textContent = v;
  });
  pintarChips('p-dias-cardio', opcionesDias(7), (v) => perfilForm.diasCardio === Number(v), (v) => {
    perfilForm.diasCardio = Number(v);
    document.getElementById('p-dias-cardio-num').textContent = v;
  });
  pintarChips(
    'p-equipo',
    EQUIPOS,
    (v) => perfilForm.equipo.includes(v),
    (v) => {
      perfilForm.equipo = perfilForm.equipo.includes(v) ? perfilForm.equipo.filter((x) => x !== v) : [...perfilForm.equipo, v];
    },
    // Al menos un tipo de equipo: con la lista vacía el generador no
    // filtraría nada, lo contrario de lo que el usuario quiso decir.
    (v) => perfilForm.equipo.length === 1 && perfilForm.equipo.includes(v),
  );
  pintarChips(
    'p-lesiones',
    LESIONES_COMUNES.map((l) => ({ valor: l, etiqueta: l })),
    (v) => perfilForm.lesiones.includes(v),
    (v) => {
      perfilForm.lesiones = perfilForm.lesiones.includes(v) ? perfilForm.lesiones.filter((x) => x !== v) : [...perfilForm.lesiones, v];
    },
  );

  const toggleMaquinas = document.getElementById('p-evitar-maquinas');
  toggleMaquinas.onclick = () => {
    perfilForm.evitarMaquinas = !perfilForm.evitarMaquinas;
    toggleMaquinas.classList.toggle('activo', perfilForm.evitarMaquinas);
  };

  document.getElementById('p-guardar').onclick = guardarPerfil;
  document.getElementById('p-salir').onclick = () => supabase.auth.signOut();
  renderPesoCorporal();
}

async function guardarPerfil() {
  const mensajeDiv = document.getElementById('p-mensaje');
  const boton = document.getElementById('p-guardar');
  const nombre = document.getElementById('p-nombre').value.trim();
  const peso = document.getElementById('p-peso').value;
  const edad = document.getElementById('p-edad').value;
  const condicionesMedicas = document.getElementById('p-condiciones').value.trim();

  mensajeDiv.innerHTML = '';
  if (!peso || !edad) {
    mensajeDiv.innerHTML = '<div class="mensaje error">Completa tu peso y edad antes de continuar.</div>';
    return;
  }
  if (perfilForm.metas.length === 0) {
    mensajeDiv.innerHTML = '<div class="mensaje error">Elige al menos una meta.</div>';
    return;
  }

  boton.disabled = true;
  boton.innerHTML = '<div class="spinner"></div>';

  try {
    const { data: { user } } = await supabase.auth.getUser();
    // 'upsert': el registro podría no existir aún (usuario nuevo). Escribe
    // exactamente las columnas que antes escribían, por separado, Perfil
    // (nombre/peso/edad/nivel) y Generador (metas, lesiones, condición,
    // días, equipo, máquinas) — ahora desde un solo lugar.
    const { error: perfilError } = await supabase.from('perfiles').upsert({
      id: user.id,
      nombre: nombre || null,
      peso_kg: parseFloat(peso),
      edad: parseInt(edad, 10),
      nivel: perfilForm.nivel,
      metas: perfilForm.metas,
      lesiones: perfilForm.lesiones,
      condiciones_medicas: condicionesMedicas || null,
      dias_disponibles: perfilForm.dias,
      dias_disponibles_cardio: perfilForm.diasCardio,
      equipo_disponible: perfilForm.equipo,
      evitar_maquinas: perfilForm.evitarMaquinas,
    });
    if (perfilError) throw new Error(`No se pudo guardar tu perfil: ${perfilError.message}`);
    perfilForm.nombre = nombre;
    perfilForm.peso = peso;
    perfilForm.edad = edad;
    perfilForm.condicionesMedicas = condicionesMedicas;
    const tituloEl = document.querySelector('#app .g2-appbar h1');
    if (tituloEl && nombre) tituloEl.textContent = `Hola, ${nombre}`;

    mensajeDiv.innerHTML = '<div class="mensaje info">Perfil guardado. Se usará la próxima vez que generes o regeneres un plan.</div>';
  } catch (err) {
    mensajeDiv.innerHTML = `<div class="mensaje error">${escaparHtml(err.message)}</div>`;
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar perfil';
  }
}

// Extrae un mensaje de error entendible para el usuario a partir de lo que
// devuelve la Edge Function, SIN mostrar internos técnicos (detalles de
// validación por ejercicio, JSON crudo, etc.) como única explicación —
// esos detalles técnicos sí quedan en consola para depurar.
function mensajeErrorGeneracionAmigable(cuerpoError) {
  const codigo = cuerpoError?.codigo;
  if (['RESPUESTA_TRUNCADA', 'VALIDACION_FALLIDA', 'DIAS_AUSENTES', 'SIN_TOOL_INPUT', 'DIAS_DEGENERADOS'].includes(codigo)) {
    return 'No pudimos construir una rutina válida con estas restricciones. '
      + 'Tu información se conserva; intenta ajustar la rutina o revisar las restricciones activas.';
  }
  if (codigo === 'ERROR_MODELO') return 'El servicio de generación no respondió bien. Intenta de nuevo en un momento.';
  if (codigo === 'ERROR_GUARDADO') return 'La rutina se generó pero no se pudo guardar. Intenta de nuevo.';
  return cuerpoError?.error || 'No se pudo generar la rutina. Intenta de nuevo en un momento.';
}

// Diagnóstico de desarrollo — SOLO consola, nunca la UI. Resume por qué
// falló (o cómo salió) una generación: estado HTTP, tiempo total visto por
// el cliente, `codigo` y el objeto `diagnostico` acotado que devuelve
// generate-routine (intentos, stop_reason, conteos por categoría de error;
// sin texto médico ni respuesta del modelo). Si el cuerpo no es JSON (p.ej.
// la función fue cortada por límite de tiempo del runtime), se registra un
// fragmento acotado del texto para poder identificarlo.
async function registrarDiagnosticoGeneracion(tipo, { data, error, ms }) {
  const info = { tipo, ms_cliente: ms };
  if (error) {
    info.error_nombre = error.name;
    info.http_status = error.context?.status ?? null;
    let texto = null;
    try { texto = await error.context.text(); } catch (e) {}
    let cuerpo = null;
    try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { info.cuerpo_no_json = texto?.slice(0, 200) ?? null; }
    info.codigo = cuerpo?.codigo ?? null;
    info.diagnostico = cuerpo?.diagnostico ?? null;
    info.detalles = Array.isArray(cuerpo?.detalles) ? cuerpo.detalles.slice(0, 10) : null;
    if (!cuerpo) info.nota = 'Sin cuerpo JSON: revisar límite de tiempo/recursos del runtime o red (ver ms_cliente y http_status).';
    console.warn(`[generación:${tipo}] diagnóstico (falló)`, info);
    return cuerpo;
  }
  info.codigo = data?.codigo ?? null;
  info.diagnostico = data?.diagnostico ?? null;
  console.info(`[generación:${tipo}] diagnóstico (ok)`, info);
  return null;
}

// Llama a una Edge Function de generación (fuerza/abdomen/cardio) usando
// SOLO estado.generacion[tipo] para el estado de carga/mensaje — nunca una
// referencia de DOM capturada — así el resultado no se pierde si el
// usuario navega a otra pantalla mientras la llamada sigue en curso (ver
// el comentario en la definición de estado.generacion arriba).
async function invocarGeneracion(tipo, nombreFuncion, body) {
  if (estado.generacion[tipo].activo) return; // ya hay una generación de este tipo en curso — no duplicar

  estado.generacion[tipo] = { activo: true, mensaje: null };
  repintarSiMuestraGeneracion(tipo);
  actualizarIndicadorGeneracion();

  // Objetivo especial "adaptar mis planes" (ver renderEspecial): solo se
  // envía a los productos cuyo generador lo acepta (Fuerza/Core, como
  // `intencion_hoy` de generate-routine), como intención etiquetada —
  // nunca como restricción. Sin objetivo, el cuerpo queda como antes.
  const objetivo = leerObjetivoEspecialParaProducto(tipo);
  const cuerpoPeticion = objetivo ? { ...(body || {}), intencion_hoy: objetivo } : body;

  const inicioMs = Date.now();
  const { data, error } = await supabase.functions.invoke(nombreFuncion, cuerpoPeticion ? { body: cuerpoPeticion } : undefined);
  const cuerpo = await registrarDiagnosticoGeneracion(tipo, { data, error, ms: Date.now() - inicioMs });

  if (error) {
    estado.generacion[tipo] = { activo: false, mensaje: { tipo: 'error', texto: mensajeErrorGeneracionAmigable(cuerpo) } };
  } else if (data.parcial) {
    // Explícito, nunca silencioso: la Edge Function ya decidió que esta
    // rutina es un resultado degradado (menos días de los pedidos porque
    // las restricciones activas no permitían más de forma segura) — se
    // muestra así, no como un "¡Listo!" normal. No es una afirmación de
    // que la rutina fue validada médicamente; solo que se generó con
    // menos volumen del solicitado.
    estado.generacion[tipo] = {
      activo: false,
      mensaje: {
        tipo: 'warning',
        texto: `Se generaron ${data.dias_generados} de ${data.dias_solicitados} día(s) solicitados — `
          + 'las restricciones activas no permitían completar los demás de forma segura con el catálogo actual. '
          + 'Puedes ajustar tus restricciones o intentar de nuevo.',
      },
    };
    if (tipo === 'fuerza') await cargarRutina();
    else if (tipo === 'abdomen') await cargarRutinaAbdomen();
    else if (tipo === 'cardio') await cargarRutinaCardio();
  } else {
    estado.generacion[tipo] = { activo: false, mensaje: { tipo: 'info', texto: `¡Listo! ${data.dias.length} día(s) generado(s).` } };
    if (tipo === 'fuerza') await cargarRutina();
    else if (tipo === 'abdomen') await cargarRutinaAbdomen();
    else if (tipo === 'cardio') await cargarRutinaCardio();
  }

  repintarSiMuestraGeneracion(tipo);
  actualizarIndicadorGeneracion();
}

// Repinta solo si la pantalla actual muestra el estado de esa generación:
// la pantalla del producto, el hub, o Entrenamiento especial.
function repintarSiMuestraGeneracion(tipo) {
  if ([PLANES[tipo].pantalla, 'entrenamiento', 'especial'].includes(estado.pantalla)) render();
}

// =========================================================================
// Cargar rutina + estadísticas de días
// =========================================================================
async function regenerarDia(diaNumero, tipo) {
  const esAbdomen = tipo === 'abdominales';
  abrirModalGeneracion({
    titulo: `Regenerar Día ${diaNumero} de ${esAbdomen ? 'Core' : 'Fuerza'}`,
    descripcion: 'Se genera de nuevo solo este día; el resto del plan no cambia.',
    textoConfirmar: 'Regenerar día',
    onGenerar: async () => {
      const btnId = esAbdomen ? 'btn-regenerar-dia-ab' : 'btn-regenerar-dia';
      const mensajeId = esAbdomen ? 'regen-mensaje-ab' : 'regen-mensaje';
      const btn = document.getElementById(btnId);
      const mensajeDiv = document.getElementById(mensajeId);
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div>';
      mensajeDiv.innerHTML = '';

      const { data, error } = await supabase.functions.invoke('regenerate-day', {
        body: { dia: diaNumero, tipo: esAbdomen ? 'abdominales' : 'fuerza' },
      });

      btn.disabled = false;
      btn.textContent = '🔄 Regenerar solo este día con IA';

      if (error) {
        let detalle = error.message;
        try {
          const cuerpo = await error.context.json();
          detalle = [cuerpo.error, cuerpo.detalle, ...(cuerpo.detalles || [])].filter(Boolean).join(' | ') || detalle;
        } catch (e) {}
        mensajeDiv.innerHTML = `<div class="mensaje error">No se pudo regenerar el día: ${detalle}</div>`;
        return;
      }

      mensajeDiv.innerHTML = `<div class="mensaje info">Día ${data.dia} regenerado: ${data.nombre_dia}.</div>`;
      if (esAbdomen) await cargarRutinaAbdomen();
      else await cargarRutina();
    },
  });
}

async function regenerarDiaCardio(diaNumero) {
  abrirModalGeneracion({
    titulo: `Regenerar Día ${diaNumero} de Cardio`,
    descripcion: 'Se genera de nuevo solo este día; el resto del plan no cambia.',
    textoConfirmar: 'Regenerar día',
    onGenerar: async () => {
      const btn = document.getElementById('btn-regenerar-dia-cardio');
      const mensajeDiv = document.getElementById('regen-mensaje-cardio');
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div>';
      mensajeDiv.innerHTML = '';

      const { data, error } = await supabase.functions.invoke('regenerate-cardio-day', { body: { dia: diaNumero } });

      btn.disabled = false;
      btn.textContent = '🔄 Regenerar solo este día con IA';

      if (error) {
        let detalle = error.message;
        try {
          const cuerpo = await error.context.json();
          detalle = [cuerpo.error, cuerpo.detalle, ...(cuerpo.detalles || [])].filter(Boolean).join(' | ') || detalle;
        } catch (e) {}
        mensajeDiv.innerHTML = `<div class="mensaje error">No se pudo regenerar el día: ${detalle}</div>`;
        return;
      }

      mensajeDiv.innerHTML = `<div class="mensaje info">Día ${data.dia} regenerado: ${data.nombre_dia}.</div>`;
      await cargarRutinaCardio();
    },
  });
}

async function cargarRutina() {
  estado.cargandoRutina = true;
  estado.errorRutina = null;
  if (estado.pantalla === 'rutina' || estado.pantalla === 'entrenamiento') render();

  const userId = estado.sesion.user.id;

  const { data: perfilExistente } = await supabase
    .from('perfiles').select('nombre, peso_kg, edad, nivel, metas, lesiones, condiciones_medicas, dias_disponibles, dias_disponibles_cardio, equipo_disponible, evitar_maquinas')
    .eq('id', userId).maybeSingle();
  if (perfilExistente) {
    perfilForm.nombre = perfilExistente.nombre || '';
    perfilForm.peso = perfilExistente.peso_kg ?? '';
    perfilForm.edad = perfilExistente.edad ?? '';
    perfilForm.nivel = perfilExistente.nivel || perfilForm.nivel;
    perfilForm.metas = perfilExistente.metas || perfilForm.metas;
    perfilForm.lesiones = perfilExistente.lesiones || perfilForm.lesiones;
    perfilForm.condicionesMedicas = perfilExistente.condiciones_medicas || '';
    perfilForm.dias = perfilExistente.dias_disponibles || perfilForm.dias;
    perfilForm.diasCardio = perfilExistente.dias_disponibles_cardio || perfilForm.diasCardio;
    // Vacío en la base = "sin filtro" para el generador; se muestra como
    // todo el equipo marcado, que significa lo mismo.
    if (perfilExistente.equipo_disponible?.length) perfilForm.equipo = [...perfilExistente.equipo_disponible];
    perfilForm.evitarMaquinas = perfilExistente.evitar_maquinas || false;
  }
  // Solo la PRIMERA vez (al abrir la app) — exista perfil o no — se marca
  // como precargado y se refresca Perfil. Antes de esto Perfil muestra un
  // indicador de carga, así "Guardar" nunca pisa el perfil real con los
  // valores por defecto. Hacerlo siempre borraría el mensaje de éxito
  // justo después de guardar.
  if (!perfilPrecargado) {
    perfilPrecargado = true;
    if (estado.pantalla === 'perfil' || estado.pantalla === 'onboarding') render();
  }

  const { data: rutina, error: rutinaError } = await supabase
    .from('rutinas').select('id')
    .eq('usuario_id', userId).eq('activa', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (rutinaError) {
    estado.errorRutina = `No se pudo cargar tu rutina: ${rutinaError.message}`;
    estado.cargandoRutina = false;
    if (estado.pantalla === 'rutina' || estado.pantalla === 'entrenamiento') render();
    return;
  }

  if (!rutina) {
    estado.rutinaId = null;
    estado.dias = [];
    estado.cargandoRutina = false;
    if (estado.pantalla === 'rutina' || estado.pantalla === 'entrenamiento') render();
    return;
  }

  estado.rutinaId = rutina.id;

  const { data: ejercicios, error: ejerciciosError } = await supabase
    .from('rutina_ejercicios').select('*, ejercicios(nombre, grupo_muscular)')
    .eq('rutina_id', rutina.id).order('dia').order('orden');

  if (ejerciciosError) {
    estado.errorRutina = `No se pudieron cargar los ejercicios: ${ejerciciosError.message}`;
    estado.cargandoRutina = false;
    if (estado.pantalla === 'rutina' || estado.pantalla === 'entrenamiento') render();
    return;
  }

  const porDia = {};
  for (const ej of ejercicios) {
    if (!porDia[ej.dia]) porDia[ej.dia] = { dia: ej.dia, nombre_dia: ej.nombre_dia, ejercicios: [] };
    porDia[ej.dia].ejercicios.push(ej);
  }
  estado.dias = Object.values(porDia).sort((a, b) => a.dia - b.dia);
  if (estado.diaActivo >= estado.dias.length) estado.diaActivo = 0;

  // Conteo de veces completado por día (todo el historial), calendario de
  // la semana actual (lunes a domingo), y consistencia de semanas recientes.
  const { data: sesiones } = await supabase
    .from('sesiones_entrenamiento').select('dia, fecha')
    .eq('rutina_id', rutina.id).eq('usuario_id', userId);

  const { data: perfil } = await supabase
    .from('perfiles').select('dias_disponibles').eq('id', userId).maybeSingle();
  estado.diasDisponibles = perfil?.dias_disponibles || estado.dias.length;

  const conteo = {};
  for (const d of estado.dias) conteo[d.dia] = { total: 0 };
  const fechasVistasPorDia = {};
  const mapaFechaDia = {};
  const semanas = {}; // inicioSemana -> Set de días distintos completados esa semana

  for (const s of sesiones || []) {
    if (s.dia == null) continue;
    fechasVistasPorDia[s.dia] = fechasVistasPorDia[s.dia] || new Set();
    if (!fechasVistasPorDia[s.dia].has(s.fecha)) {
      fechasVistasPorDia[s.dia].add(s.fecha);
      if (conteo[s.dia]) conteo[s.dia].total++;
    }
    mapaFechaDia[s.fecha] = s.dia;

    const inicioSem = formatoFecha(inicioDeSemana(s.fecha));
    semanas[inicioSem] = semanas[inicioSem] || new Set();
    semanas[inicioSem].add(s.dia);
  }
  estado.conteoDias = conteo;

  // Calendario de la semana actual: lunes a domingo, con qué día de la
  // rutina se hizo cada fecha (o nada, si fue descanso).
  const hoyStr = formatoFecha(new Date());
  const inicioActual = formatoFecha(inicioDeSemana(hoyStr));
  const etiquetasSemana = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const celdas = [];
  for (let i = 0; i < 7; i++) {
    const f = new Date(inicioActual + 'T00:00:00');
    f.setDate(f.getDate() + i);
    const fStr = formatoFecha(f);
    celdas.push({ etiqueta: etiquetasSemana[i], fecha: fStr, dia: mapaFechaDia[fStr] ?? null, esFuturo: fStr > hoyStr });
  }
  estado.semanaActual = celdas;

  // Consistencia de hasta las últimas 4 semanas ANTERIORES a la actual
  // (la actual todavía está en curso, no es justo compararla completa).
  const clavesSemanasPasadas = Object.keys(semanas).filter((k) => k !== inicioActual).sort().slice(-4);
  const tasas = clavesSemanasPasadas.map((k) => semanas[k].size / (estado.diasDisponibles || 1));
  estado.tasaConsistenciaReciente = tasas.length ? tasas.reduce((a, b) => a + b, 0) / tasas.length : null;

  estado.cargandoRutina = false;
  if (estado.pantalla === 'rutina' || estado.pantalla === 'entrenamiento') render();
}

async function cargarRutinaAbdomen() {
  const ab = estado.abdomen;
  ab.cargando = true;
  ab.error = null;
  if (estado.pantalla === 'abdomen' || estado.pantalla === 'entrenamiento') render();

  const userId = estado.sesion.user.id;

  const { data: rutina, error: rutinaError } = await supabase
    .from('rutinas').select('id')
    .eq('usuario_id', userId).eq('activa', true).eq('tipo', 'abdominales')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (rutinaError) {
    ab.error = `No se pudo cargar tu rutina de abdomen: ${rutinaError.message}`;
    ab.cargando = false;
    if (estado.pantalla === 'abdomen' || estado.pantalla === 'entrenamiento') render();
    return;
  }

  if (!rutina) {
    ab.rutinaId = null;
    ab.dias = [];
    ab.cargando = false;
    if (estado.pantalla === 'abdomen' || estado.pantalla === 'entrenamiento') render();
    return;
  }

  ab.rutinaId = rutina.id;

  const { data: ejercicios, error: ejerciciosError } = await supabase
    .from('rutina_ejercicios').select('*, ejercicios(nombre, grupo_muscular)')
    .eq('rutina_id', rutina.id).order('dia').order('orden');

  if (ejerciciosError) {
    ab.error = `No se pudieron cargar los ejercicios: ${ejerciciosError.message}`;
    ab.cargando = false;
    if (estado.pantalla === 'abdomen' || estado.pantalla === 'entrenamiento') render();
    return;
  }

  const porDia = {};
  for (const ej of ejercicios) {
    if (!porDia[ej.dia]) porDia[ej.dia] = { dia: ej.dia, nombre_dia: ej.nombre_dia, ejercicios: [] };
    porDia[ej.dia].ejercicios.push(ej);
  }
  ab.dias = Object.values(porDia).sort((a, b) => a.dia - b.dia);
  if (ab.diaActivo >= ab.dias.length) ab.diaActivo = 0;

  const { data: sesiones } = await supabase
    .from('sesiones_entrenamiento').select('dia, fecha')
    .eq('rutina_id', rutina.id).eq('usuario_id', userId);

  const { data: perfil } = await supabase.from('perfiles').select('dias_disponibles').eq('id', userId).maybeSingle();
  ab.diasDisponibles = ab.dias.length || perfil?.dias_disponibles || 0;

  const conteo = {};
  for (const d of ab.dias) conteo[d.dia] = { total: 0 };
  const fechasVistasPorDia = {};
  const mapaFechaDia = {};
  const semanas = {};
  for (const s of sesiones || []) {
    if (s.dia == null) continue;
    fechasVistasPorDia[s.dia] = fechasVistasPorDia[s.dia] || new Set();
    if (!fechasVistasPorDia[s.dia].has(s.fecha)) {
      fechasVistasPorDia[s.dia].add(s.fecha);
      if (conteo[s.dia]) conteo[s.dia].total++;
    }
    mapaFechaDia[s.fecha] = s.dia;
    const inicioSem = formatoFecha(inicioDeSemana(s.fecha));
    semanas[inicioSem] = semanas[inicioSem] || new Set();
    semanas[inicioSem].add(s.dia);
  }
  ab.conteoDias = conteo;

  const hoyStr = formatoFecha(new Date());
  const inicioActual = formatoFecha(inicioDeSemana(hoyStr));
  const etiquetasSemana = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const celdas = [];
  for (let i = 0; i < 7; i++) {
    const f = new Date(inicioActual + 'T00:00:00');
    f.setDate(f.getDate() + i);
    const fStr = formatoFecha(f);
    celdas.push({ etiqueta: etiquetasSemana[i], fecha: fStr, dia: mapaFechaDia[fStr] ?? null, esFuturo: fStr > hoyStr });
  }
  ab.semanaActual = celdas;

  const clavesSemanasPasadas = Object.keys(semanas).filter((k) => k !== inicioActual).sort().slice(-4);
  const tasas = clavesSemanasPasadas.map((k) => semanas[k].size / (ab.diasDisponibles || 1));
  ab.tasaConsistenciaReciente = tasas.length ? tasas.reduce((a, b) => a + b, 0) / tasas.length : null;

  ab.cargando = false;
  if (estado.pantalla === 'abdomen' || estado.pantalla === 'entrenamiento') render();
}

// =========================================================================
// Cardio: plan generado por IA (fases, no series/reps) + marcar completado
// =========================================================================
async function cargarRutinaCardio() {
  const c = estado.cardio;
  c.cargando = true;
  c.error = null;
  if (estado.pantalla === 'cardio' || estado.pantalla === 'entrenamiento') render();

  const userId = estado.sesion.user.id;

  const { data: rutina, error: rutinaError } = await supabase
    .from('rutinas').select('id')
    .eq('usuario_id', userId).eq('activa', true).eq('tipo', 'cardio')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (rutinaError) {
    c.error = `No se pudo cargar tu plan de cardio: ${rutinaError.message}`;
    c.cargando = false;
    if (estado.pantalla === 'cardio' || estado.pantalla === 'entrenamiento') render();
    return;
  }
  if (!rutina) {
    c.rutinaId = null;
    c.dias = [];
    c.cargando = false;
    if (estado.pantalla === 'cardio' || estado.pantalla === 'entrenamiento') render();
    return;
  }
  c.rutinaId = rutina.id;

  const { data: fases, error: fasesError } = await supabase
    .from('cardio_plan').select('*').eq('rutina_id', rutina.id).order('dia').order('orden');

  if (fasesError) {
    c.error = `No se pudieron cargar las fases: ${fasesError.message}`;
    c.cargando = false;
    if (estado.pantalla === 'cardio' || estado.pantalla === 'entrenamiento') render();
    return;
  }

  const porDia = {};
  for (const f of fases) {
    if (!porDia[f.dia]) porDia[f.dia] = { dia: f.dia, nombre_dia: f.nombre_dia, fases: [] };
    porDia[f.dia].fases.push(f);
  }
  c.dias = Object.values(porDia).sort((a, b) => a.dia - b.dia);
  if (c.diaActivo >= c.dias.length) c.diaActivo = 0;

  const { data: sesiones } = await supabase
    .from('sesiones_entrenamiento').select('dia, fecha')
    .eq('rutina_id', rutina.id).eq('usuario_id', userId);

  c.diasDisponibles = c.dias.length;
  const conteo = {};
  for (const d of c.dias) conteo[d.dia] = { total: 0 };
  const mapaFechaDia = {};
  for (const s of sesiones || []) {
    if (s.dia == null) continue;
    conteo[s.dia] = conteo[s.dia] || { total: 0 };
    conteo[s.dia].total++;
    mapaFechaDia[s.fecha] = s.dia;
  }
  c.conteoDias = conteo;

  const hoyStr = formatoFecha(new Date());
  const inicioActual = formatoFecha(inicioDeSemana(hoyStr));
  const etiquetasSemana = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const celdas = [];
  for (let i = 0; i < 7; i++) {
    const f = new Date(inicioActual + 'T00:00:00');
    f.setDate(f.getDate() + i);
    const fStr = formatoFecha(f);
    celdas.push({ etiqueta: etiquetasSemana[i], fecha: fStr, dia: mapaFechaDia[fStr] ?? null, esFuturo: fStr > hoyStr });
  }
  c.semanaActual = celdas;

  c.cargando = false;
  if (estado.pantalla === 'cardio' || estado.pantalla === 'entrenamiento') render();
}

function renderCardio() {
  app.innerHTML = '';
  const c = estado.cardio;

  if (c.cargando) {
    app.appendChild(h('<div class="pantalla-carga"><div class="spinner"></div></div>'));
    return;
  }
  if (c.error) app.appendChild(h(`<div class="mensaje error">${c.error}</div>`));

  if (!c.dias || c.dias.length === 0) {
    app.appendChild(h(`
      <div>
        ${encabezadoProducto('Cardio')}
        <div class="vacio"><div class="icono-grande">🏃</div><p>Aún no tienes plan de cardio.</p></div>
        ${bloqueEstadoGeneracion('cardio')}
        ${botonCrearPlanHtml('cardio')}
      </div>`));
    conectarAccionesPlan('cardio');
    return;
  }

  const diasCompletadosEstaSemana = c.semanaActual.filter((x) => x.dia != null).length;
  const dia = c.dias[c.diaActivo];
  const info = c.conteoDias[dia.dia] || { total: 0 };
  const yaCompletadoHoy = c.semanaActual.some((x) => x.fecha === formatoFecha(new Date()) && x.dia === dia.dia);

  const etiquetasFase = { calentamiento: 'Calentamiento', principal: 'Cardio principal', enfriamiento: 'Enfriamiento' };

  const cont = h('<div></div>');
  cont.appendChild(h(`
    <div>
      ${encabezadoProducto('Cardio', `${c.dias.length} día(s) por semana`)}
      ${bloqueEstadoGeneracion('cardio')}
      <p class="subtitulo">${dia.nombre_dia}</p>
      <div class="semana-calendario">
        ${c.semanaActual.map((x) => `
          <div class="celda-dia ${x.dia != null ? 'hecho' : ''} ${x.esFuturo ? 'futuro' : ''}">
            <span class="etiqueta-dia">${x.etiqueta}</span>
            <span class="valor-dia">${x.dia != null ? 'D' + x.dia : (x.esFuturo ? '' : '—')}</span>
          </div>`).join('')}
      </div>
      <p class="subtitulo" style="margin-top:-6px">Esta semana: ${diasCompletadosEstaSemana}/${c.diasDisponibles} días planeados</p>
      <div class="resumen-semana">
        <div><div class="num">${info.total}</div><div class="txt">veces que hiciste ${dia.nombre_dia} (histórico)</div></div>
      </div>
      <div class="tabs-dias" id="tabs-dias-cardio"></div>
      <div id="fases-cardio"></div>
      <div id="cardio-mensaje"></div>
      <button class="boton-primario" id="btn-marcar-cardio" ${yaCompletadoHoy ? 'disabled' : ''}>
        ${yaCompletadoHoy ? 'Ya completaste esto hoy ✓' : 'Marcar como completado hoy'}
      </button>
      ${bloqueAjustesPlan('cardio', { idRegenerarDia: 'btn-regenerar-dia-cardio', idMensajeDia: 'regen-mensaje-cardio' })}
    </div>`));
  app.appendChild(cont);

  conectarAccionesPlan('cardio');
  document.getElementById('btn-regenerar-dia-cardio').onclick = () => regenerarDiaCardio(dia.dia);

  const tabsDiv = document.getElementById('tabs-dias-cardio');
  c.dias.forEach((d, idx) => {
    const info2 = c.conteoDias[d.dia] || { total: 0 };
    const tab = h(`<button class="tab-dia ${idx === c.diaActivo ? 'activo' : ''}"><strong>Día ${d.dia}</strong><span>${info2.total}x hecho</span></button>`);
    tab.onclick = () => { c.diaActivo = idx; renderCardio(); };
    tabsDiv.appendChild(tab);
  });

  const fasesDiv = document.getElementById('fases-cardio');
  dia.fases.forEach((f) => {
    fasesDiv.appendChild(h(`
      <div class="tarjeta-ejercicio">
        <div class="ph">${f.fase === 'principal' ? '🔥' : '🚶'}</div>
        <div class="info">
          <div class="nombre">${etiquetasFase[f.fase]}: ${f.actividad}</div>
          <div class="detalle">Plan: ${f.duracion_min} min${f.intensidad ? ' · ' + f.intensidad : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:4px">
          <input type="number" class="input-duracion-real" data-fase-id="${f.id}" value="${f.duracion_min}" style="width:52px;text-align:center;padding:6px 4px" />
          <span style="font-size:11px;color:var(--text-muted)">min</span>
        </div>
      </div>`));
  });

  document.getElementById('btn-marcar-cardio').onclick = () => marcarCardioCompletado(dia.dia);
}

async function marcarCardioCompletado(diaNumero) {
  const c = estado.cardio;
  const btn = document.getElementById('btn-marcar-cardio');
  const mensajeDiv = document.getElementById('cardio-mensaje');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div>';

  const userId = estado.sesion.user.id;
  const hoy = formatoFecha(new Date());

  const { error } = await supabase.from('sesiones_entrenamiento')
    .insert({ usuario_id: userId, rutina_id: c.rutinaId, fecha: hoy, dia: diaNumero });

  if (error) {
    mensajeDiv.innerHTML = `<div class="mensaje error">No se pudo registrar: ${error.message}</div>`;
    btn.disabled = false;
    btn.textContent = 'Marcar como completado hoy';
    return;
  }

  // Usamos la duración REAL que escribiste en cada fase, no el plan tal
  // cual — así el historial refleja lo que en verdad hiciste.
  const dia = c.dias.find((d) => d.dia === diaNumero);
  for (const f of dia.fases) {
    const input = document.querySelector(`.input-duracion-real[data-fase-id="${f.id}"]`);
    const duracionReal = input?.value ? parseInt(input.value, 10) : f.duracion_min;
    await supabase.from('actividades_extra').insert({
      usuario_id: userId, tipo: 'cardio',
      nombre_actividad: `${f.fase}: ${f.actividad}`,
      duracion_min: duracionReal, notas: f.intensidad || null,
    });
  }

  await cargarRutinaCardio();
}

// =========================================================================
// Pantalla Rutina
// =========================================================================
function renderRutina() {
  app.innerHTML = '';

  if (estado.cargandoRutina) {
    app.appendChild(h('<div class="pantalla-carga"><div class="spinner"></div></div>'));
    return;
  }
  if (estado.errorRutina) {
    app.appendChild(h(`<div class="mensaje error">${estado.errorRutina}</div>`));
    return;
  }
  if (!estado.dias || estado.dias.length === 0) {
    app.appendChild(h(`
      <div>
        ${encabezadoProducto('Fuerza / Gimnasio')}
        <div class="vacio">
          <div class="icono-grande">📋</div>
          <p>Aún no tienes plan de fuerza.</p>
        </div>
        ${bloqueEstadoGeneracion('fuerza')}
        ${botonCrearPlanHtml('fuerza')}
      </div>`));
    conectarAccionesPlan('fuerza');
    return;
  }

  const diasCompletadosEstaSemana = estado.semanaActual.filter((c) => c.dia != null).length;
  const dia = estado.dias[estado.diaActivo];
  const info = estado.conteoDias[dia.dia] || { total: 0 };

  const cont = h('<div></div>');
  cont.appendChild(h(`
    <div>
      ${encabezadoProducto('Fuerza / Gimnasio', `${estado.dias.length} día(s) por semana${perfilForm.metas?.[0] ? ` · Meta principal: ${escaparHtml(perfilForm.metas[0])}` : ''}`)}
      ${bloqueEstadoGeneracion('fuerza')}
      <p class="subtitulo">${dia.nombre_dia}</p>
      <div class="semana-calendario">
        ${estado.semanaActual.map((c) => `
          <div class="celda-dia ${c.dia != null ? 'hecho' : ''} ${c.esFuturo ? 'futuro' : ''}">
            <span class="etiqueta-dia">${c.etiqueta}</span>
            <span class="valor-dia">${c.dia != null ? 'D' + c.dia : (c.esFuturo ? '' : '—')}</span>
          </div>`).join('')}
      </div>
      <p class="subtitulo" style="margin-top:-6px">Esta semana: ${diasCompletadosEstaSemana}/${estado.diasDisponibles} días planeados (lunes a domingo)</p>
      <div class="resumen-semana">
        <div><div class="num">${info.total}</div><div class="txt">veces que hiciste ${dia.nombre_dia} (histórico)</div></div>
      </div>
      <div class="tabs-dias" id="tabs-dias"></div>
      <div id="lista-ejercicios"></div>
      ${bloqueAjustesPlan('fuerza', { idRegenerarDia: 'btn-regenerar-dia', idMensajeDia: 'regen-mensaje' })}
    </div>`));
  app.appendChild(cont);

  conectarAccionesPlan('fuerza');
  document.getElementById('btn-regenerar-dia').onclick = () => regenerarDia(dia.dia);

  const tabsDiv = document.getElementById('tabs-dias');
  estado.dias.forEach((d, idx) => {
    const c = estado.conteoDias[d.dia] || { total: 0 };
    const tab = h(`<button class="tab-dia ${idx === estado.diaActivo ? 'activo' : ''}"><strong>Día ${d.dia}</strong><span>${c.total}x hecho</span></button>`);
    tab.onclick = () => { estado.diaActivo = idx; renderRutina(); };
    tabsDiv.appendChild(tab);
  });

  const listaDiv = document.getElementById('lista-ejercicios');
  dia.ejercicios.forEach((ej) => {
    const nombre = ej.ejercicios?.nombre || ej.ejercicio_id;
    const altTxt = ej.alternativas?.length ? ` · ${ej.alternativas.length} alternativa(s)` : '';
    const tarjeta = h(`
      <div class="tarjeta-ejercicio">
        <div class="ph">🏋️</div>
        <div class="info">
          <div class="nombre">${nombre}</div>
          <div class="detalle">${ej.series} series x ${ej.reps_objetivo} reps${altTxt}</div>
        </div>
        <div class="chevron">›</div>
      </div>`);
    tarjeta.onclick = () => {
      estado.ejercicioActivo = ej;
      estado.pantallaOrigenRegistro = 'rutina';
      estado.pantalla = 'registro';
      render();
    };
    listaDiv.appendChild(tarjeta);

    // Foto miniatura real, si existe (no bloquea el render de la tarjeta).
    supabase.from('ejercicio_imagenes').select('url').eq('ejercicio_id', ej.ejercicio_id).order('orden').limit(1)
      .then(({ data }) => {
        if (data && data[0]) {
          const ph = tarjeta.querySelector('.ph');
          const img = h(`<img src="${data[0].url}" />`);
          ph.replaceWith(img);
        }
      });
  });
}

// =========================================================================
// Pantalla Abdomen (rutina de core generada por IA, paralela a la de fuerza)
// =========================================================================
function renderAbdomen() {
  app.innerHTML = '';
  const ab = estado.abdomen;

  if (ab.cargando) {
    app.appendChild(h('<div class="pantalla-carga"><div class="spinner"></div></div>'));
    return;
  }
  if (ab.error) {
    app.appendChild(h(`<div class="mensaje error">${ab.error}</div>`));
  }
  if (!ab.dias || ab.dias.length === 0) {
    app.appendChild(h(`
      <div>
        ${encabezadoProducto('Core / Abdomen')}
        <div class="vacio">
          <div class="icono-grande">🔥</div>
          <p>Aún no tienes plan de core.</p>
        </div>
        ${bloqueEstadoGeneracion('abdomen')}
        ${botonCrearPlanHtml('abdomen')}
      </div>`));
    conectarAccionesPlan('abdomen');
    return;
  }

  const diasCompletadosEstaSemana = ab.semanaActual.filter((c) => c.dia != null).length;
  const dia = ab.dias[ab.diaActivo];
  const info = ab.conteoDias[dia.dia] || { total: 0 };

  const cont = h('<div></div>');
  cont.appendChild(h(`
    <div>
      ${encabezadoProducto('Core / Abdomen', `${ab.dias.length} día(s) por semana`)}
      ${bloqueEstadoGeneracion('abdomen')}
      <p class="subtitulo">${dia.nombre_dia}</p>
      <div class="semana-calendario">
        ${ab.semanaActual.map((c) => `
          <div class="celda-dia ${c.dia != null ? 'hecho' : ''} ${c.esFuturo ? 'futuro' : ''}">
            <span class="etiqueta-dia">${c.etiqueta}</span>
            <span class="valor-dia">${c.dia != null ? 'D' + c.dia : (c.esFuturo ? '' : '—')}</span>
          </div>`).join('')}
      </div>
      <p class="subtitulo" style="margin-top:-6px">Esta semana: ${diasCompletadosEstaSemana}/${ab.diasDisponibles} días planeados</p>
      <div class="resumen-semana">
        <div><div class="num">${info.total}</div><div class="txt">veces que hiciste ${dia.nombre_dia} (histórico)</div></div>
      </div>
      <div class="tabs-dias" id="tabs-dias-ab"></div>
      <div id="lista-ejercicios-ab"></div>
      ${bloqueAjustesPlan('abdomen', { idRegenerarDia: 'btn-regenerar-dia-ab', idMensajeDia: 'regen-mensaje-ab' })}
    </div>`));
  app.appendChild(cont);

  conectarAccionesPlan('abdomen');
  document.getElementById('btn-regenerar-dia-ab').onclick = () => regenerarDia(dia.dia, 'abdominales');

  const tabsDiv = document.getElementById('tabs-dias-ab');
  ab.dias.forEach((d, idx) => {
    const c = ab.conteoDias[d.dia] || { total: 0 };
    const tab = h(`<button class="tab-dia ${idx === ab.diaActivo ? 'activo' : ''}"><strong>Día ${d.dia}</strong><span>${c.total}x hecho</span></button>`);
    tab.onclick = () => { ab.diaActivo = idx; renderAbdomen(); };
    tabsDiv.appendChild(tab);
  });

  const listaDiv = document.getElementById('lista-ejercicios-ab');
  dia.ejercicios.forEach((ej) => {
    const nombre = ej.ejercicios?.nombre || ej.ejercicio_id;
    const altTxt = ej.alternativas?.length ? ` · ${ej.alternativas.length} alternativa(s)` : '';
    const tarjeta = h(`
      <div class="tarjeta-ejercicio">
        <div class="ph">🔥</div>
        <div class="info">
          <div class="nombre">${nombre}</div>
          <div class="detalle">${ej.series} series x ${ej.reps_objetivo}${altTxt}</div>
        </div>
        <div class="chevron">›</div>
      </div>`);
    tarjeta.onclick = () => {
      estado.ejercicioActivo = ej;
      estado.pantallaOrigenRegistro = 'abdomen';
      estado.pantalla = 'registro';
      render();
    };
    listaDiv.appendChild(tarjeta);

    supabase.from('ejercicio_imagenes').select('url').eq('ejercicio_id', ej.ejercicio_id).order('orden').limit(1)
      .then(({ data }) => {
        if (data && data[0]) {
          const ph = tarjeta.querySelector('.ph');
          const img = h(`<img src="${data[0].url}" />`);
          ph.replaceWith(img);
        }
      });
  });
}

// =========================================================================
// Pantalla Registro — con precarga de lo ya guardado (corrige el bug)
// =========================================================================
async function renderRegistro() {
  app.innerHTML = '';

  if (!estado.ejercicioActivo) {
    app.appendChild(h(`
      <div class="vacio">
        <div class="icono-grande">✏️</div>
        <p>Elige un ejercicio desde la pestaña "Rutina" para registrar tus series.</p>
      </div>`));
    return;
  }

  const ej = estado.ejercicioActivo;
  const nombre = ej.ejercicios?.nombre || ej.ejercicio_id;

  app.appendChild(h(`
    <div>
      <h1 class="titulo">${nombre}</h1>
      <p class="subtitulo">Objetivo: ${ej.series} series x ${ej.reps_objetivo} reps</p>
      <div id="reg-progreso"></div>
      <div id="reg-imagenes"><div class="sin-imagen">Buscando fotos de referencia…</div></div>
      <div id="reg-guia" class="guia-musculo">Trabaja: <strong>${ej.ejercicios?.grupo_muscular || 'este grupo muscular'}</strong>. Enfócate en sentir el músculo objetivo trabajando, con movimientos controlados — no en levantar el peso como sea.</div>
      <div id="reg-alternativas"></div>
      <div id="reg-mensaje"></div>
      <div class="tabla-series" id="reg-tabla"><div class="pantalla-carga"><div class="spinner"></div></div></div>
      <button class="boton-primario" id="reg-volver">Volver a mi rutina</button>
    </div>`));

  document.getElementById('reg-volver').onclick = () => { estado.pantalla = estado.pantallaOrigenRegistro || 'rutina'; render(); };

  // ---- Imágenes principales (grandes) ----
  supabase.from('ejercicio_imagenes').select('tipo, url, orden').eq('ejercicio_id', ej.ejercicio_id).order('orden')
    .then(({ data }) => {
      const cont = document.getElementById('reg-imagenes');
      if (!cont) return;
      if (!data || data.length === 0) {
        cont.innerHTML = '<div class="sin-imagen">Sin foto de referencia para este ejercicio todavía.</div>';
        return;
      }
      const etiquetas = { posicion_inicial: 'Inicio', posicion_final: 'Final', referencia_principal: 'Referencia', referencia: 'Referencia' };
      cont.innerHTML = `<div class="galeria-grande">${data.slice(0, 2).map((img) => `
        <div class="caption"><img src="${img.url}" /><span>${etiquetas[img.tipo] || 'Referencia'}</span></div>
      `).join('')}</div>`;
    });

  // ---- Toggle: ¿este ejercicio usa peso de asistencia? ----
  const toggleAsistidoDiv = h(`
    <div class="toggle-fila ${ej.peso_asistido ? 'activo' : ''}" id="toggle-asistido" style="margin-bottom:14px">
      <div class="toggle-dot"></div>
      <div class="toggle-texto">
        <strong>Es un ejercicio de asistencia</strong>
        <span>Ej. dominadas asistidas: MENOS peso en la máquina = más difícil. Actívalo para que el progreso se interprete al revés.</span>
      </div>
    </div>`);
  document.getElementById('reg-guia').insertAdjacentElement('afterend', toggleAsistidoDiv);
  toggleAsistidoDiv.onclick = async () => {
    const nuevoValor = !ej.peso_asistido;
    await supabase.from('rutina_ejercicios').update({ peso_asistido: nuevoValor }).eq('id', ej.id);
    ej.peso_asistido = nuevoValor;
    renderRegistro();
  };

  // ---- Progreso / estancamiento (por sesión) + estancamiento por semanas ----
  supabase.from('series_registradas')
    .select('peso_kg, repeticiones, sesiones_entrenamiento!inner(fecha)')
    .eq('ejercicio_id', ej.ejercicio_id)
    .then(({ data }) => {
      const cont = document.getElementById('reg-progreso');
      if (!cont || !data) return;

      const hayPeso = data.some((s) => s.peso_kg != null && s.peso_kg > 0);
      // Si nunca se registra peso (ej. Wall Angel, puro peso corporal), usamos
      // las repeticiones como medida de progreso en su lugar.
      const campo = hayPeso ? 'peso_kg' : 'repeticiones';
      const mejorPorFecha = {};
      for (const s of data) {
        if (s[campo] == null) continue;
        const f = s.sesiones_entrenamiento.fecha;
        if (!mejorPorFecha[f] || s[campo] > mejorPorFecha[f]) mejorPorFecha[f] = s[campo];
      }
      const puntos = Object.entries(mejorPorFecha).sort(([a], [b]) => (a < b ? -1 : 1)).map(([, p]) => p);
      const prog = calcularTendencia(puntos, hayPeso && ej.peso_asistido, hayPeso ? 'kg' : 'reps');

      let html = '';
      if (prog.estado !== 'sin_datos') {
        let extra = '';
        const bajaConsistencia = estado.tasaConsistenciaReciente != null && estado.tasaConsistenciaReciente < 0.7;
        if ((prog.estado === 'estancado' || prog.estado === 'bajando') && bajaConsistencia) {
          const pct = Math.round(estado.tasaConsistenciaReciente * 100);
          extra = `<div style="margin-top:6px;font-weight:400">Además, en tus semanas recientes solo completaste ~${pct}% de tus días planeados — la falta de consistencia probablemente esté contribuyendo a esto, no solo el ejercicio en sí.</div>`;
        }
        html += `<div class="bloque-progreso ${prog.estado}">${prog.texto}${extra}</div>`;
      }

      // Estancamiento por SEMANAS calendario (más confiable que comparar
      // sesiones sueltas, sobre todo si entrenas el mismo ejercicio varias
      // veces por semana).
      const puntosSemanales = pesoMaximoPorSemana(
        Object.entries(mejorPorFecha).map(([fecha, valor]) => ({ fecha, valor })),
      );
      const estancSemanas = detectarEstancamientoSemanas(puntosSemanales, hayPeso && ej.peso_asistido);
      if (estancSemanas) {
        const unidad = hayPeso ? 'kg' : 'reps';
        html += `
          <div class="bloque-progreso estancado" style="margin-top:8px">
            ⚠️ Llevas ${estancSemanas.semanas} semanas seguidas sin mejorar en este ejercicio (${estancSemanas.valor}${unidad}).
            <div style="margin-top:6px;font-weight:400">Opciones a considerar: ${hayPeso ? 'ajusta el peso aunque bajes 1-2 reps' : 'suma 1-2 repeticiones aunque sea con más esfuerzo'}, cambia el rango de repeticiones, o dale unos días de descanso extra a este grupo muscular (deload).</div>
            <button class="btn-usar-alt" id="btn-ver-alternativas" style="margin-top:10px">Ver alternativas de este ejercicio ↓</button>
          </div>`;
      }

      cont.innerHTML = html;
      const btnVerAlt = document.getElementById('btn-ver-alternativas');
      if (btnVerAlt) {
        btnVerAlt.onclick = () => {
          document.getElementById('reg-alternativas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
      }
    });

  // ---- Alternativas (con imagen + botón de cambio) + buscador manual ----
  const contAlt = document.getElementById('reg-alternativas');
  contAlt.innerHTML = `
    <div class="bloque-alternativas">
      <span class="etiqueta">Si no puedes hacer este ejercicio</span>
      <div id="alt-filas"></div>
      <div id="alt-buscador"></div>
    </div>`;
  const filasDiv = document.getElementById('alt-filas');

  (ej.alternativas || []).forEach((alt) => {
    const fila = h(`
      <div class="fila-alt">
        <div class="ph">🏋️</div>
        <div class="info"><div class="nombre">${alt.nombre}</div><div class="motivo">${alt.motivo}</div></div>
        <button class="btn-usar-alt">Usar esta</button>
      </div>`);
    filasDiv.appendChild(fila);

    fila.querySelector('.btn-usar-alt').onclick = () => usarAlternativa(alt);

    supabase.from('ejercicio_imagenes').select('url').eq('ejercicio_id', alt.ejercicio_id).order('orden').limit(1)
      .then(({ data }) => {
        if (data && data[0]) fila.querySelector('.ph').outerHTML = `<img src="${data[0].url}" />`;
      });
  });

  // ---- Buscador: agrega un ejercicio que TÚ conozcas como alternativa ----
  const buscadorDiv = document.getElementById('alt-buscador');
  buscadorDiv.innerHTML = `
    <button class="boton-secundario" id="alt-mostrar-buscador" style="text-align:left;padding-left:0">+ Agregar un ejercicio que tú conozcas</button>
    <div id="alt-buscador-form" style="display:none">
      <input type="text" id="alt-busqueda-input" placeholder="Nombre del ejercicio (ej. Zancada búlgara)" style="margin-top:8px" />
      <div id="alt-busqueda-resultados"></div>
    </div>`;

  document.getElementById('alt-mostrar-buscador').onclick = () => {
    document.getElementById('alt-buscador-form').style.display = 'block';
    document.getElementById('alt-mostrar-buscador').style.display = 'none';
    document.getElementById('alt-busqueda-input').focus();
  };

  let debounceBusqueda = null;
  document.getElementById('alt-busqueda-input').oninput = (e) => {
    clearTimeout(debounceBusqueda);
    const texto = e.target.value.trim();
    const resDiv = document.getElementById('alt-busqueda-resultados');
    if (texto.length < 3) { resDiv.innerHTML = ''; return; }
    debounceBusqueda = setTimeout(async () => {
      const { data } = await supabase
        .from('ejercicios').select('id, nombre, equipo')
        .ilike('nombre', `%${texto}%`).limit(5);
      if (!data || data.length === 0) {
        resDiv.innerHTML = '<p class="subtitulo" style="margin-top:8px">Sin resultados.</p>';
        return;
      }
      resDiv.innerHTML = '';
      data.forEach((res) => {
        const fila = h(`
          <div class="fila-alt" style="margin-top:8px">
            <div class="ph">🏋️</div>
            <div class="info"><div class="nombre">${res.nombre}</div><div class="motivo">${res.equipo}</div></div>
            <button class="btn-usar-alt">Agregar</button>
          </div>`);
        resDiv.appendChild(fila);
        fila.querySelector('.btn-usar-alt').onclick = () => agregarAlternativaManual(res);
      });
    }, 350);
  };

  // ---- Sesión de hoy + tabla de series (con precarga de lo guardado) ----
  const userId = estado.sesion.user.id;
  const hoy = new Date().toISOString().slice(0, 10);

  let { data: sesionExistente } = await supabase
    .from('sesiones_entrenamiento').select('id')
    .eq('usuario_id', userId).eq('rutina_id', ej.rutina_id).eq('fecha', hoy).eq('dia', ej.dia)
    .maybeSingle();

  let sesionId;
  if (sesionExistente) {
    sesionId = sesionExistente.id;
  } else {
    const { data: nueva, error } = await supabase
      .from('sesiones_entrenamiento')
      .insert({ usuario_id: userId, rutina_id: ej.rutina_id, fecha: hoy, dia: ej.dia })
      .select('id').single();
    if (error) {
      document.getElementById('reg-tabla').innerHTML = `<div class="mensaje error">No se pudo crear la sesión: ${error.message}</div>`;
      return;
    }
    sesionId = nueva.id;
  }

  // Traer lo que YA se guardó hoy para este ejercicio, para no perderlo al salir y volver.
  const { data: seriesGuardadas } = await supabase
    .from('series_registradas').select('id, numero_serie, peso_kg, repeticiones, rir')
    .eq('sesion_id', sesionId).eq('ejercicio_id', ej.ejercicio_id).order('numero_serie');

  const guardadasPorNumero = {};
  for (const s of seriesGuardadas || []) guardadasPorNumero[s.numero_serie] = s;

  // ---- Sugerencia de peso, basada en tu RIR de la última sesión (no hoy) ----
  const sugerencia = await sugerirProgresion(ej.ejercicio_id, userId, hoy, ej.peso_asistido);
  if (sugerencia) {
    const cont = document.getElementById('reg-guia');
    cont.insertAdjacentHTML('beforebegin', `<div class="mensaje info">💡 ${sugerencia.texto}</div>`);
  }

  const numSeries = ej.series || 3;
  pintarTablaSeries(sesionId, ej.ejercicio_id, numSeries, guardadasPorNumero, sugerencia?.peso ?? null);
}

async function sugerirProgresion(ejercicioId, userId, hoyStr, esAsistido) {
  const { data } = await supabase
    .from('series_registradas')
    .select('peso_kg, rir, sesiones_entrenamiento!inner(fecha, usuario_id)')
    .eq('ejercicio_id', ejercicioId)
    .eq('sesiones_entrenamiento.usuario_id', userId)
    .not('peso_kg', 'is', null)
    .neq('sesiones_entrenamiento.fecha', hoyStr);

  if (!data || data.length === 0) return null;

  const ultimaFecha = data.reduce((max, s) => (s.sesiones_entrenamiento.fecha > max ? s.sesiones_entrenamiento.fecha : max), '');
  const seriesUltimaVez = data.filter((s) => s.sesiones_entrenamiento.fecha === ultimaFecha);
  const pesoMax = Math.max(...seriesUltimaVez.map((s) => s.peso_kg));
  const rirsValidos = seriesUltimaVez.map((s) => s.rir).filter((r) => r != null);
  const rirPromedio = rirsValidos.length ? rirsValidos.reduce((a, b) => a + b, 0) / rirsValidos.length : null;

  if (rirPromedio == null) {
    return { peso: pesoMax, texto: `Sugerido: continúa con ${pesoMax}kg (igual que tu última vez).` };
  }
  if (rirPromedio <= 1) {
    return { peso: pesoMax, texto: `Sugerido: mantén ${pesoMax}kg — la última vez fuiste cerca del fallo (RIR ${rirPromedio.toFixed(1)}).` };
  }
  if (rirPromedio >= 3) {
    // "Hacerlo más difícil" es +2.5kg en un ejercicio normal, pero -2.5kg
    // de asistencia en uno asistido (sin bajar de 0).
    const nuevoPeso = esAsistido
      ? Math.max(0, Math.round((pesoMax - 2.5) * 2) / 2)
      : Math.round((pesoMax + 2.5) * 2) / 2;
    const texto = esAsistido
      ? `Sugerido: baja la asistencia a ${nuevoPeso}kg — la última vez te sobró margen (RIR ${rirPromedio.toFixed(1)}).`
      : `Sugerido: sube a ${nuevoPeso}kg — la última vez te sobró margen (RIR ${rirPromedio.toFixed(1)}).`;
    return { peso: nuevoPeso, texto };
  }
  return { peso: pesoMax, texto: `Sugerido: continúa con ${pesoMax}kg (igual que tu última vez).` };
}

function pintarTablaSeries(sesionId, ejercicioId, numSeries, guardadasPorNumero, pesoSugerido) {
  const tabla = document.getElementById('reg-tabla');
  tabla.innerHTML = `
    <div class="fila-encabezado"><span></span><span>Kg</span><span>Reps</span><span>RIR</span><span></span></div>
    <div id="filas-series"></div>`;
  const filasDiv = document.getElementById('filas-series');

  for (let i = 1; i <= numSeries; i++) {
    let guardada = guardadasPorNumero[i]; // se reemplaza al editar, por eso 'let'
    const valorPeso = guardada?.peso_kg ?? (pesoSugerido != null ? pesoSugerido : '');
    const fila = h(`
      <div class="fila-serie">
        <span class="num">${i}</span>
        <input type="number" id="peso-${i}" value="${valorPeso}" ${guardada ? 'disabled' : ''} />
        <input type="number" id="reps-${i}" value="${guardada?.repeticiones ?? ''}" ${guardada ? 'disabled' : ''} />
        <input type="number" id="rir-${i}" value="${guardada?.rir ?? ''}" ${guardada ? 'disabled' : ''} />
        <button class="btn-guardar-serie ${guardada ? 'hecha' : ''}" id="btn-${i}">${guardada ? 'Editar' : 'Guardar'}</button>
      </div>`);
    filasDiv.appendChild(fila);

    const pesoInput = () => document.getElementById(`peso-${i}`);
    const repsInput = () => document.getElementById(`reps-${i}`);
    const rirInput = () => document.getElementById(`rir-${i}`);
    const btn = () => document.getElementById(`btn-${i}`);

    const habilitarEdicion = () => {
      pesoInput().disabled = false;
      repsInput().disabled = false;
      rirInput().disabled = false;
      pesoInput().focus();
      btn().textContent = 'Actualizar';
      btn().classList.remove('hecha');
    };

    const guardarOActualizar = async () => {
      btn().disabled = true;
      btn().innerHTML = '<div class="spinner"></div>';

      const peso = pesoInput().value;
      const reps = repsInput().value;
      const rir = rirInput().value;
      const valores = {
        peso_kg: peso ? parseFloat(peso) : null,
        repeticiones: reps ? parseInt(reps, 10) : null,
        rir: rir ? parseInt(rir, 10) : null,
      };

      const { data: fila, error } = guardada
        ? await supabase.from('series_registradas').update(valores).eq('id', guardada.id).select().single()
        : await supabase.from('series_registradas').insert({
            sesion_id: sesionId, ejercicio_id: ejercicioId, numero_serie: i, ...valores,
          }).select().single();

      if (error) {
        document.getElementById('reg-mensaje').innerHTML = `<div class="mensaje error">No se pudo guardar la serie: ${error.message}</div>`;
        btn().disabled = false;
        btn().textContent = guardada ? 'Actualizar' : 'Guardar';
        return;
      }

      const eraNueva = !guardada;
      guardada = fila; // ahora sí existe (o se actualizó) — el próximo clic vuelve a ser "editar"
      btn().disabled = false;
      btn().classList.add('hecha');
      btn().textContent = 'Editar';
      pesoInput().disabled = true;
      repsInput().disabled = true;
      rirInput().disabled = true;

      if (eraNueva && i < numSeries) iniciarDescanso(90);
    };

    btn().onclick = () => {
      if (pesoInput().disabled) {
        // los campos están bloqueados (serie ya guardada) → este clic es "Editar"
        habilitarEdicion();
      } else {
        // campos habilitados (nueva serie, o ya en modo edición) → guardar/actualizar
        guardarOActualizar();
      }
    };
  }
}

// ---- Temporizador de descanso entre series ----
let descansoInterval = null;

function iniciarDescanso(segundosIniciales) {
  detenerDescanso();
  let restante = segundosIniciales;

  const banner = h(`
    <div class="banner-descanso" id="banner-descanso">
      <span>Descanso: <strong id="descanso-num">${formatoTiempo(restante)}</strong></span>
      <button id="descanso-saltar">Saltar</button>
    </div>`);
  document.body.appendChild(banner);
  document.getElementById('descanso-saltar').onclick = detenerDescanso;

  descansoInterval = setInterval(() => {
    restante--;
    const num = document.getElementById('descanso-num');
    if (!num) { detenerDescanso(); return; }
    if (restante <= 0) { detenerDescanso(); return; }
    num.textContent = formatoTiempo(restante);
  }, 1000);
}

function detenerDescanso() {
  if (descansoInterval) clearInterval(descansoInterval);
  descansoInterval = null;
  const banner = document.getElementById('banner-descanso');
  if (banner) banner.remove();
}

function formatoTiempo(segundos) {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Agrupa el mejor valor (peso o reps) por semana calendario (lunes a
// domingo), para detectar estancamientos reales en vez de comparar
// sesiones sueltas.
function pesoMaximoPorSemana(puntosConFecha) {
  const mapa = {};
  for (const p of puntosConFecha) {
    const semana = formatoFecha(inicioDeSemana(p.fecha));
    if (!mapa[semana] || p.valor > mapa[semana]) mapa[semana] = p.valor;
  }
  return Object.entries(mapa).sort(([a], [b]) => (a < b ? -1 : 1)).map(([semana, valor]) => ({ semana, valor }));
}

// Si en las últimas semanas (con datos) no hubo mejora 3 o más veces
// seguidas, se considera un estancamiento real. Con "invertido" (peso de
// asistencia), "mejora" significa que el valor BAJÓ, no que subió.
function detectarEstancamientoSemanas(puntosSemanales, invertido) {
  if (puntosSemanales.length < 3) return null;
  const ultimas = puntosSemanales.slice(-5);
  let racha = 1;
  for (let i = ultimas.length - 1; i > 0; i--) {
    const sinMejora = invertido ? ultimas[i].valor >= ultimas[i - 1].valor : ultimas[i].valor <= ultimas[i - 1].valor;
    if (sinMejora) racha++;
    else break;
  }
  if (racha >= 3) return { semanas: racha, valor: ultimas[ultimas.length - 1].valor };
  return null;
}

// "invertido" = true para peso de asistencia (menos peso = más difícil =
// progreso). "unidad" es solo para el texto ('kg' o 'reps').
function calcularTendencia(puntos, invertido, unidad) {
  if (puntos.length < 2) return { estado: 'sin_datos', texto: '' };
  const u = unidad || 'kg';
  const ultimo = puntos[puntos.length - 1];
  const anterior = puntos[puntos.length - 2];
  const mejoro = invertido ? ultimo < anterior : ultimo > anterior;
  const empeoro = invertido ? ultimo > anterior : ultimo < anterior;

  if (mejoro) {
    return {
      estado: 'progresando',
      texto: invertido
        ? `📈 Progresando: bajaste la asistencia de ${anterior}${u} a ${ultimo}${u} (más difícil).`
        : `📈 Progresando: subiste de ${anterior}${u} a ${ultimo}${u}.`,
    };
  }
  if (empeoro) {
    return {
      estado: 'bajando',
      texto: invertido
        ? `📉 Subiste la asistencia de ${anterior}${u} a ${ultimo}${u} (más fácil) respecto a tu sesión anterior.`
        : `📉 Bajaste de ${anterior}${u} a ${ultimo}${u} respecto a tu sesión anterior.`,
    };
  }
  const ultimosN = puntos.slice(-3);
  const estancado = ultimosN.length === 3 && ultimosN.every((p) => p === ultimosN[0]);
  if (estancado) {
    return { estado: 'estancado', texto: `⏸ Estancado en ${ultimo}${u} las últimas ${ultimosN.length} sesiones — considera ajustar peso o reps.` };
  }
  return { estado: 'igual', texto: `Mismo valor que tu sesión anterior (${ultimo}${u}).` };
}

async function usarAlternativa(alt) {
  const ej = estado.ejercicioActivo;
  const otras = (ej.alternativas || []).filter((a) => a.ejercicio_id !== alt.ejercicio_id);
  const anterior = { ejercicio_id: ej.ejercicio_id, nombre: ej.ejercicios?.nombre || ej.ejercicio_id, motivo: 'Tu ejercicio anterior — regresa a este si prefieres.' };
  const nuevasAlternativas = [anterior, ...otras].slice(0, 2);

  const { error } = await supabase.from('rutina_ejercicios')
    .update({ ejercicio_id: alt.ejercicio_id, alternativas: nuevasAlternativas })
    .eq('id', ej.id);

  if (error) {
    document.getElementById('reg-mensaje').innerHTML = `<div class="mensaje error">No se pudo cambiar el ejercicio: ${error.message}</div>`;
    return;
  }

  if (estado.pantallaOrigenRegistro === 'abdomen') await cargarRutinaAbdomen();
  else await cargarRutina();
  estado.pantalla = estado.pantallaOrigenRegistro || 'rutina';
  render();
}

async function agregarAlternativaManual(resultado) {
  const ej = estado.ejercicioActivo;
  const nueva = { ejercicio_id: resultado.id, nombre: resultado.nombre, motivo: 'Agregado por ti.' };
  // La tuya se guarda primero (más visible); se mantiene como máximo 1 más
  // de las que ya había, para no saturar la lista.
  const nuevasAlternativas = [nueva, ...(ej.alternativas || [])].slice(0, 3);

  const { error } = await supabase.from('rutina_ejercicios')
    .update({ alternativas: nuevasAlternativas })
    .eq('id', ej.id);

  if (error) {
    document.getElementById('reg-mensaje').innerHTML = `<div class="mensaje error">No se pudo agregar: ${error.message}</div>`;
    return;
  }

  ej.alternativas = nuevasAlternativas;
  if (estado.pantallaOrigenRegistro === 'abdomen') cargarRutinaAbdomen();
  else cargarRutina();
  renderRegistro(); // repinta esta pantalla con la nueva alternativa ya incluida
}

// =========================================================================
// Historial
// =========================================================================
async function renderHistorial() {
  app.innerHTML = '<div class="pantalla-carga"><div class="spinner"></div></div>';

  const userId = estado.sesion.user.id;
  const { data: sesiones, error } = await supabase
    .from('sesiones_entrenamiento').select('id, fecha, dia, rutinas(tipo, nombre)')
    .eq('usuario_id', userId).order('fecha', { ascending: false }).limit(30);

  // Registrar actividad extra (escalada, calistenia libre, etc.) vive aquí:
  // es actividad ya hecha, no un plan — Historial es su único acceso.
  const encabezado = `
    <header class="g2-appbar"><h1>Historial</h1><p>Lo que ya entrenaste</p></header>
    <button type="button" class="boton-secundario" id="btn-actividad-extra" style="text-align:left;padding-left:0">➕ Registrar o ver actividad extra</button>`;
  const conectarExtra = () => { document.getElementById('btn-actividad-extra').onclick = () => irAPantalla('extra'); };

  if (error) { app.innerHTML = `<div class="mensaje error">${error.message}</div>`; return; }
  if (!sesiones || sesiones.length === 0) {
    app.innerHTML = `${encabezado}<div class="vacio"><div class="icono-grande">📅</div><p>Todavía no tienes sesiones registradas.</p></div>`;
    conectarExtra();
    return;
  }

  app.innerHTML = `${encabezado}<p class="subtitulo">Tus últimas sesiones (fuerza, core y cardio)</p><div id="hist-lista"></div>`;
  conectarExtra();
  const lista = document.getElementById('hist-lista');

  const iconoPorTipo = { fuerza: '💪', abdominales: '🔥', cardio: '🏃' };
  const nombrePorTipo = { fuerza: 'Fuerza', abdominales: 'Abdomen', cardio: 'Cardio' };

  for (const s of sesiones) {
    const tipo = s.rutinas?.tipo || 'fuerza';
    const etiquetaTipo = `${iconoPorTipo[tipo] || ''} ${nombrePorTipo[tipo] || tipo}`;

    if (tipo === 'cardio') {
      // El detalle real de cardio vive en Extra → Cardio; aquí solo
      // confirmamos que el día se completó, sin fingir que hay series.
      const tarjeta = h(`
        <div class="tarjeta-sesion">
          <div class="fecha">${s.fecha} — ${etiquetaTipo}, Día ${s.dia ?? '?'}</div>
          <div class="linea"><span>Detalle en “Actividad extra” → Cardio</span></div>
        </div>`);
      lista.appendChild(tarjeta);
      continue;
    }

    const { data: series } = await supabase
      .from('series_registradas').select('ejercicio_id, peso_kg, repeticiones, ejercicios(nombre)')
      .eq('sesion_id', s.id);

    const porEjercicio = {};
    for (const serie of series || []) {
      const nombre = serie.ejercicios?.nombre || serie.ejercicio_id;
      porEjercicio[nombre] = (porEjercicio[nombre] || 0) + 1;
    }

    const tarjeta = h(`
      <div class="tarjeta-sesion">
        <div class="fecha">${s.fecha} — ${etiquetaTipo}, Día ${s.dia ?? '?'}</div>
        ${Object.entries(porEjercicio).map(([nombre, num]) => `<div class="linea"><span>${nombre}</span><strong>${num} series</strong></div>`).join('') || '<div class="linea"><span>Sin series registradas</span></div>'}
      </div>`);
    lista.appendChild(tarjeta);
  }
}

// =========================================================================
// Extra: cardio, abdominales, escalada — separado de la rutina de fuerza
// =========================================================================
const TIPOS_EXTRA = [
  { valor: 'cardio', etiqueta: 'Cardio', icono: '🏃' },
  { valor: 'abdominales', etiqueta: 'Abdomen', icono: '🔥' },
  { valor: 'calistenia', etiqueta: 'Calistenia/Casa', icono: '🏠' },
  { valor: 'escalada', etiqueta: 'Escalada', icono: '🧗' },
  { valor: 'otro', etiqueta: 'Otro', icono: '➕' },
];
let tipoExtraActivo = 'cardio';

function esTipoEstructurado(tipo) {
  return tipo === 'abdominales' || tipo === 'escalada' || tipo === 'calistenia';
}

async function renderExtra() {
  app.innerHTML = '';
  app.appendChild(h(`
    <div>
      <button type="button" class="g2-back" id="extra-volver">‹ Historial</button>
      <h1 class="titulo">Actividad extra</h1>
      <p class="subtitulo">Cardio, abdomen, escalada — independiente de tu rutina de fuerza</p>
      <div class="chip-grid" id="extra-tipos"></div>
      <div id="extra-form"></div>
      <div id="extra-mensaje"></div>
      <button class="boton-primario" id="extra-guardar">Guardar</button>
      <h2 class="titulo" style="font-size:16px;margin-top:26px;margin-bottom:10px">Historial</h2>
      <div id="extra-lista"><div class="pantalla-carga"><div class="spinner"></div></div></div>
    </div>`));

  document.getElementById('extra-volver').onclick = () => irAPantalla('historial');
  const tiposDiv = document.getElementById('extra-tipos');
  function pintarTipos() {
    tiposDiv.innerHTML = TIPOS_EXTRA.map((t) =>
      `<button class="chip ${tipoExtraActivo === t.valor ? 'activo' : ''}" data-tipo="${t.valor}">${t.icono} ${t.etiqueta}</button>`,
    ).join('');
    tiposDiv.querySelectorAll('[data-tipo]').forEach((btn) => {
      btn.onclick = () => { tipoExtraActivo = btn.dataset.tipo; pintarTipos(); pintarFormulario(); cargarListaExtra(); };
    });
  }

  function pintarFormulario() {
    const formDiv = document.getElementById('extra-form');
    if (tipoExtraActivo === 'cardio') {
      formDiv.innerHTML = `
        <div class="campo"><label class="etiqueta">Actividad</label><input type="text" id="extra-nombre" placeholder="Ej: Trote, bici, remo" /></div>
        <div class="campo"><label class="etiqueta">Duración (min)</label><input type="number" id="extra-duracion" placeholder="30" /></div>
        <div class="campo"><label class="etiqueta">Notas (velocidad, inclinación, distancia...)</label><input type="text" id="extra-notas" placeholder="Ej: 5km, velocidad 8, inclinación 2%" /></div>`;
    } else if (esTipoEstructurado(tipoExtraActivo)) {
      formDiv.innerHTML = `
        <div class="campo"><label class="etiqueta">Ejercicio</label><input type="text" id="extra-nombre" placeholder="Ej: Crunches, Dead hang dedos, Boulder V3" /></div>
        <div class="fila-2col">
          <div><label class="etiqueta">Series (opcional)</label><input type="number" id="extra-series" placeholder="3" /></div>
          <div><label class="etiqueta">Reps (opcional)</label><input type="text" id="extra-repeticiones" placeholder="15 o 30 seg" /></div>
        </div>
        <div class="campo"><label class="etiqueta">Notas (opcional)</label><input type="text" id="extra-notas" placeholder="Ej: logrado al tercer intento" /></div>`;
    } else {
      formDiv.innerHTML = `
        <div class="campo"><label class="etiqueta">Detalle</label><input type="text" id="extra-nombre" placeholder="Describe qué hiciste" /></div>
        <div class="campo"><label class="etiqueta">Duración (min, opcional)</label><input type="number" id="extra-duracion" placeholder="30" /></div>`;
    }
  }

  pintarTipos();
  pintarFormulario();

  document.getElementById('extra-guardar').onclick = async () => {
    const boton = document.getElementById('extra-guardar');
    const mensajeDiv = document.getElementById('extra-mensaje');
    mensajeDiv.innerHTML = '';

    const nombre = document.getElementById('extra-nombre').value.trim();
    if (!nombre) { mensajeDiv.innerHTML = '<div class="mensaje error">Escribe al menos el nombre de la actividad/ejercicio.</div>'; return; }

    const duracionEl = document.getElementById('extra-duracion');
    const seriesEl = document.getElementById('extra-series');
    const repsEl = document.getElementById('extra-repeticiones');
    const notasEl = document.getElementById('extra-notas');

    boton.disabled = true;
    boton.innerHTML = '<div class="spinner"></div>';

    const { error } = await supabase.from('actividades_extra').insert({
      usuario_id: estado.sesion.user.id,
      tipo: tipoExtraActivo,
      nombre_actividad: nombre,
      duracion_min: duracionEl?.value ? parseInt(duracionEl.value, 10) : null,
      series: seriesEl?.value ? parseInt(seriesEl.value, 10) : null,
      repeticiones: repsEl?.value || null,
      notas: notasEl?.value || null,
    });

    boton.disabled = false;
    boton.textContent = 'Guardar';

    if (error) { mensajeDiv.innerHTML = `<div class="mensaje error">No se pudo guardar: ${error.message}</div>`; return; }

    pintarFormulario(); // limpia el formulario, listo para agregar el siguiente ejercicio del mismo día
    mensajeDiv.innerHTML = '<div class="mensaje info">Guardado. Puedes agregar otro ejercicio de la misma sesión.</div>';
    cargarListaExtra();
  };

  cargarListaExtra();
}

async function cargarListaExtra() {
  const lista = document.getElementById('extra-lista');
  if (!lista) return;
  lista.innerHTML = '<div class="pantalla-carga"><div class="spinner"></div></div>';

  const { data, error } = await supabase
    .from('actividades_extra').select('*')
    .eq('usuario_id', estado.sesion.user.id).eq('tipo', tipoExtraActivo)
    .order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(30);

  if (error) { lista.innerHTML = `<div class="mensaje error">${error.message}</div>`; return; }
  if (!data || data.length === 0) {
    lista.innerHTML = `<div class="vacio"><div class="icono-grande">📭</div><p>Todavía no registras nada aquí.</p></div>`;
    return;
  }

  lista.innerHTML = data.map((a) => {
    const partes = [];
    if (a.series) partes.push(`${a.series} series`);
    if (a.repeticiones) partes.push(`${a.repeticiones} reps`);
    if (a.duracion_min) partes.push(`${a.duracion_min} min`);
    const derecha = partes.join(' · ');
    return `
      <div class="tarjeta-sesion">
        <div class="fecha">${a.fecha}</div>
        <div class="linea"><span>${a.nombre_actividad}</span>${derecha ? `<strong>${derecha}</strong>` : ''}</div>
        ${a.notas ? `<div class="linea"><span style="color:var(--text-muted)">${a.notas}</span></div>` : ''}
      </div>`;
  }).join('');
}

// =========================================================================
// Peso corporal en el tiempo
// =========================================================================
async function renderPesoCorporal() {
  const formDiv = document.getElementById('peso-form');
  if (!formDiv) return;

  formDiv.innerHTML = `
    <div class="fila-2col" style="align-items:end">
      <div><label class="etiqueta">Peso de hoy (kg)</label><input type="number" step="0.1" id="peso-hoy-input" /></div>
      <button class="boton-primario" id="peso-hoy-guardar" style="height:47px">Registrar</button>
    </div>
    <div id="peso-mensaje"></div>`;

  document.getElementById('peso-hoy-guardar').onclick = async () => {
    const boton = document.getElementById('peso-hoy-guardar');
    const input = document.getElementById('peso-hoy-input');
    const mensajeDiv = document.getElementById('peso-mensaje');
    mensajeDiv.innerHTML = '';

    if (!input.value) { mensajeDiv.innerHTML = '<div class="mensaje error">Escribe tu peso de hoy.</div>'; return; }

    boton.disabled = true;
    const { error } = await supabase.from('mediciones_corporales').upsert({
      usuario_id: estado.sesion.user.id,
      fecha: new Date().toISOString().slice(0, 10),
      peso_kg: parseFloat(input.value),
    }, { onConflict: 'usuario_id,fecha' });
    boton.disabled = false;

    if (error) { mensajeDiv.innerHTML = `<div class="mensaje error">No se pudo guardar: ${error.message}</div>`; return; }

    input.value = '';
    mensajeDiv.innerHTML = '<div class="mensaje info">Registrado.</div>';
    cargarPesoCorporal();
  };

  cargarPesoCorporal();
}

async function cargarPesoCorporal() {
  const graficaDiv = document.getElementById('peso-grafica');
  const listaDiv = document.getElementById('peso-lista');
  if (!graficaDiv || !listaDiv) return;

  const { data, error } = await supabase
    .from('mediciones_corporales').select('fecha, peso_kg')
    .eq('usuario_id', estado.sesion.user.id)
    .order('fecha', { ascending: true }).limit(60);

  if (error) { graficaDiv.innerHTML = `<div class="mensaje error">${error.message}</div>`; return; }
  if (!data || data.length === 0) {
    graficaDiv.innerHTML = '';
    listaDiv.innerHTML = '<p class="subtitulo">Todavía no registras tu peso — empieza hoy para ver la tendencia con el tiempo.</p>';
    return;
  }

  graficaDiv.innerHTML = dibujarGraficaPeso(data.slice(-20));

  const recientes = [...data].reverse().slice(0, 10);
  listaDiv.innerHTML = recientes.map((m, i) => {
    const anterior = recientes[i + 1];
    let delta = '';
    if (anterior) {
      const diff = (m.peso_kg - anterior.peso_kg).toFixed(1);
      delta = diff > 0 ? `<span style="color:var(--danger)">+${diff}kg</span>` : diff < 0 ? `<span style="color:var(--success)">${diff}kg</span>` : '<span style="color:var(--text-muted)">=</span>';
    }
    return `<div class="linea"><span>${m.fecha}</span><strong>${m.peso_kg}kg ${delta}</strong></div>`;
  }).join('');
}

function dibujarGraficaPeso(puntos) {
  if (puntos.length < 2) return '';
  const w = 300, hgt = 110, pad = 10;
  const pesos = puntos.map((p) => p.peso_kg);
  const min = Math.min(...pesos) - 0.5;
  const max = Math.max(...pesos) + 0.5;
  const escalaX = (i) => pad + (i * (w - 2 * pad)) / (puntos.length - 1);
  const escalaY = (v) => hgt - pad - ((v - min) * (hgt - 2 * pad)) / (max - min || 1);

  const linea = puntos.map((p, i) => `${escalaX(i)},${escalaY(p.peso_kg)}`).join(' ');
  const puntosSvg = puntos.map((p, i) => `<circle cx="${escalaX(i)}" cy="${escalaY(p.peso_kg)}" r="3" fill="var(--accent)" />`).join('');

  return `
    <svg viewBox="0 0 ${w} ${hgt}" style="width:100%;height:${hgt}px;margin-bottom:14px">
      <polyline points="${linea}" fill="none" stroke="var(--accent)" stroke-width="2" />
      ${puntosSvg}
    </svg>`;
}

// =========================================================================
iniciar();
