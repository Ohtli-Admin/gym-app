// =========================================================================
// Estado global
// =========================================================================
const estado = {
  sesion: undefined, // undefined = cargando, null = sin sesión
  pantalla: 'inicio', // GymApp 2.0 (GA-005): "Inicio" es el destino post-login por defecto
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
  // Generación de rutinas (fuerza/abdomen/cardio) — GLOBAL, no local a la
  // pantalla Generador. Antes vivía en variables de DOM capturadas dentro
  // de invocarGeneracionFuerza/generarRutinaAbdomenDesdeGenerador/
  // generarRutinaCardioDesdeGenerador; si el usuario navegaba a otra
  // pantalla mientras la llamada seguía en curso, esas referencias
  // quedaban apuntando a nodos ya destruidos por el siguiente render() y
  // el resultado (o el error) se perdía visualmente aunque la petición
  // siguiera viva. Ahora el estado de "generando"/"mensaje" vive aquí,
  // así sobrevive a cualquier cambio de pantalla — ver
  // actualizarIndicadorGeneracion() y renderGenerador().
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
// Modal editable que se muestra ANTES de generar/regenerar cualquier
// rutina — permite ajustar metas, lesiones, condición médica y días justo
// ahí, sin tener que ir a Perfil primero (ej. "ya se me curó el hombro").
// tipoDias: 'gym' (fuerza/abdomen) o 'cardio' (cardio usa su propio conteo).
async function abrirModalGeneracion({ titulo, tipoDias, onGenerar }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: perfil } = await supabase.from('perfiles')
    .select('metas, lesiones, condiciones_medicas, dias_disponibles, dias_disponibles_cardio')
    .eq('id', user.id).maybeSingle();

  if (!perfil) {
    alert('No encuentro tu perfil guardado — ve a la pestaña Perfil y dale "Guardar perfil" primero (necesita al menos tu peso y edad).');
    return;
  }

  const estadoModal = {
    metas: [...(perfil.metas || [])],
    lesiones: [...(perfil.lesiones || [])],
    dias: tipoDias === 'cardio' ? (perfil.dias_disponibles_cardio || 3) : (perfil.dias_disponibles || 4),
  };

  const fondo = h(`
    <div class="modal-fondo">
      <div class="modal-caja">
        <h2 class="titulo" style="font-size:18px">${titulo}</h2>
        <p class="subtitulo">Ajusta lo que haga falta antes de generar — ej. si ya te recuperaste de una lesión, quítala aquí mismo.</p>
        <label class="etiqueta">Metas (hasta ${MAX_METAS})</label>
        <div class="chip-grid" id="modal-metas"></div>
        <label class="etiqueta">Lesiones o limitaciones</label>
        <div class="chip-grid" id="modal-lesiones"></div>
        <label class="etiqueta">Condición médica específica (opcional)</label>
        <textarea class="input-modal" id="modal-condiciones">${perfil.condiciones_medicas || ''}</textarea>
        <label class="etiqueta" style="margin-top:12px">Días ${tipoDias === 'cardio' ? 'de cardio' : 'de gym'} por semana: <span id="modal-dias-num">${estadoModal.dias}</span></label>
        <div class="chip-grid" id="modal-dias"></div>
        <div id="modal-mensaje"></div>
        <div class="modal-botones">
          <button class="boton-secundario-caja" id="modal-cancelar">Cancelar</button>
          <button class="boton-primario" id="modal-confirmar">Guardar y generar</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(fondo);

  const metasDiv = document.getElementById('modal-metas');
  function pintarMetasModal() {
    metasDiv.innerHTML = METAS.map((m) => {
      const sel = estadoModal.metas.includes(m);
      const deshab = !sel && estadoModal.metas.length >= MAX_METAS;
      return `<button class="chip ${sel ? 'activo' : ''}" data-mm="${m}" ${deshab ? 'disabled' : ''}>${m}</button>`;
    }).join('');
    metasDiv.querySelectorAll('[data-mm]').forEach((btn) => {
      btn.onclick = () => {
        const m = btn.dataset.mm;
        if (estadoModal.metas.includes(m)) estadoModal.metas = estadoModal.metas.filter((x) => x !== m);
        else if (estadoModal.metas.length < MAX_METAS) estadoModal.metas = [...estadoModal.metas, m];
        pintarMetasModal();
      };
    });
  }
  pintarMetasModal();

  const lesionesDiv = document.getElementById('modal-lesiones');
  function pintarLesionesModal() {
    lesionesDiv.innerHTML = LESIONES_COMUNES.map((l) => {
      const sel = estadoModal.lesiones.includes(l);
      return `<button class="chip ${sel ? 'activo' : ''}" data-ml="${l}">${l}${sel ? ' ✕' : ''}</button>`;
    }).join('');
    lesionesDiv.querySelectorAll('[data-ml]').forEach((btn) => {
      btn.onclick = () => {
        const l = btn.dataset.ml;
        estadoModal.lesiones = estadoModal.lesiones.includes(l)
          ? estadoModal.lesiones.filter((x) => x !== l)
          : [...estadoModal.lesiones, l];
        pintarLesionesModal();
      };
    });
  }
  pintarLesionesModal();

  const diasDiv = document.getElementById('modal-dias');
  const opcionesDias = tipoDias === 'cardio' ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6];
  function pintarDiasModal() {
    diasDiv.innerHTML = opcionesDias.map((d) =>
      `<button class="chip ${estadoModal.dias === d ? 'activo' : ''}" data-md="${d}">${d}</button>`,
    ).join('');
    document.getElementById('modal-dias-num').textContent = estadoModal.dias;
    diasDiv.querySelectorAll('[data-md]').forEach((btn) => {
      btn.onclick = () => { estadoModal.dias = Number(btn.dataset.md); pintarDiasModal(); };
    });
  }
  pintarDiasModal();

  document.getElementById('modal-cancelar').onclick = () => fondo.remove();

  document.getElementById('modal-confirmar').onclick = async () => {
    const btn = document.getElementById('modal-confirmar');
    const mensajeDiv = document.getElementById('modal-mensaje');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div>';

    const condicionesMedicas = document.getElementById('modal-condiciones').value.trim();
    const cambios = { condiciones_medicas: condicionesMedicas || null, metas: estadoModal.metas, lesiones: estadoModal.lesiones };
    if (tipoDias === 'cardio') cambios.dias_disponibles_cardio = estadoModal.dias;
    else cambios.dias_disponibles = estadoModal.dias;

    const { error } = await supabase.from('perfiles').update(cambios).eq('id', user.id);
    if (error) {
      mensajeDiv.innerHTML = `<div class="mensaje error">No se pudo guardar: ${error.message}</div>`;
      btn.disabled = false;
      btn.textContent = 'Guardar y generar';
      return;
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

  if (estado.pantalla === 'onboarding') renderOnboarding();
  else if (estado.pantalla === 'generador') renderGenerador();
  else if (estado.pantalla === 'inicio') renderInicio();
  else if (estado.pantalla === 'ajustar') renderAjustar();
  else if (estado.pantalla === 'planes') renderPlanes();
  else if (estado.pantalla === 'calistenia') renderCalistenia();
  else if (estado.pantalla === 'rehabilitacion') renderRehabilitacion();
  else if (estado.pantalla === 'entrenar') renderEntrenar();
  else if (estado.pantalla === 'mas') renderMas();
  else if (estado.pantalla === 'rutina') renderRutina();
  else if (estado.pantalla === 'abdomen') renderAbdomen();
  else if (estado.pantalla === 'cardio') renderCardio();
  else if (estado.pantalla === 'registro') renderRegistro();
  else if (estado.pantalla === 'historial') renderHistorial();
  else if (estado.pantalla === 'extra') renderExtra();

  renderNav();
  actualizarIndicadorGeneracion();
}

// GymApp 2.0 primary nav (GA-005 product-model pass): Inicio / Planes /
// Historial / Perfil — 4 destinations matching the mental model "what do
// I do today / what programs am I following / what have I done / what
// does GymApp know about me". The five training products (Fuerza, Cardio,
// Core, Calistenia, Rehabilitación) live INSIDE Planes, not as their own
// nav tabs — see renderPlanes(). Nothing about the underlying legacy
// screens changed; only how they're reached.
function irAPantalla(destino) {
  estado.pantalla = destino;
  render();
}

function renderNav() {
  const enInicio = ['inicio', 'ajustar', 'entrenar'].includes(estado.pantalla);
  const enPlanes = ['planes', 'rutina', 'abdomen', 'cardio', 'generador', 'calistenia', 'rehabilitacion', 'mas', 'extra'].includes(estado.pantalla);
  navContainer.innerHTML = `
    <div class="nav-inferior">
      <button class="nav-item ${enInicio ? 'activo' : ''}" data-nav="inicio"><span class="icono">🏠</span>Inicio</button>
      <button class="nav-item ${enPlanes ? 'activo' : ''}" data-nav="planes"><span class="icono">📚</span>Planes</button>
      <button class="nav-item ${estado.pantalla === 'historial' ? 'activo' : ''}" data-nav="historial"><span class="icono">📅</span>Historial</button>
      <button class="nav-item ${estado.pantalla === 'onboarding' ? 'activo' : ''}" data-nav="onboarding"><span class="icono">👤</span>Perfil</button>
    </div>`;
  navContainer.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.onclick = () => irAPantalla(btn.dataset.nav);
  });
}

// =========================================================================
// Inicio — GymApp 2.0 (GA-005 product-model pass). Answers "¿qué entreno
// hoy?" by aggregating whatever each product already has scheduled
// (today's Fuerza/Cardio/Core day, via the existing legacy state already
// loaded by cargarRutina/cargarRutinaAbdomen/cargarRutinaCardio) through
// the Today Coordinator (src/today-experience/today-coordinator.mjs) —
// this function does not decide anything about exercises itself, it only
// reads already-generated data and hands it to the coordinator/bridge.
// Calistenia/Rehabilitación are not included in "today" here (they have
// no daily-rotation data model yet — see src/today-experience/README.md);
// they're reachable from Planes.
// =========================================================================
function renderInicio() {
  if (!window.GymAppTodayExperience) {
    app.innerHTML = '<div class="mensaje error">No se pudo cargar Inicio (módulo no disponible). Revisa la consola.</div>';
    return;
  }
  const bridge = window.GymAppTodayExperience;

  const componentes = {
    fuerza: estado.dias && estado.dias.length > 0
      ? { label: 'Fuerza', items: bridge.adaptFuerzaDay(estado.dias[estado.diaActivo]) }
      : null,
    cardio: estado.cardio.dias && estado.cardio.dias.length > 0
      ? { label: 'Cardio', items: bridge.adaptCardioDay(estado.cardio.dias[estado.cardio.diaActivo]) }
      : null,
    core: estado.abdomen.dias && estado.abdomen.dias.length > 0
      ? { label: 'Core', items: bridge.adaptAbdomenDay(estado.abdomen.dias[estado.abdomen.diaActivo]) }
      : null,
  };
  const overview = bridge.buildTodayOverview(componentes);
  const destinoPorProducto = { fuerza: 'rutina', cardio: 'cardio', core: 'abdomen' };

  const tarjetasHtml = overview.components.map((c) => `
    <div class="g2-today-item">
      <div class="g2-today-item-info">
        <div class="g2-today-item-label">${c.label}</div>
        <div class="g2-today-item-meta">${c.itemCount} ejercicio(s) · ~${c.estimatedDurationMinutes} min</div>
      </div>
      <button type="button" class="g2-btn-secondary" data-ver="${c.product}">Ver</button>
    </div>`).join('');

  // Contexto de hoy (texto libre guardado en Ajustar) + el resultado de
  // cualquier generación de Fuerza/Core lanzada desde ahí, para que el
  // usuario vea aquí mismo si se aplicó o falló — sin ir al Generador.
  const intencionHoy = leerIntencionHoy();
  const mensajesGeneracion = ['fuerza', 'abdomen']
    .filter((t) => estado.generacion[t].mensaje)
    .map((t) => `<div class="mensaje ${estado.generacion[t].mensaje.tipo}">
        <strong>${ETIQUETAS_GENERACION[t]}:</strong> ${escaparHtml(estado.generacion[t].mensaje.texto)}
        <button type="button" class="g2-link-btn" data-descartar="${t}">Ocultar</button>
      </div>`).join('');
  const contextoHtml = intencionHoy || mensajesGeneracion ? `
    <section class="g2-card">
      ${intencionHoy ? `<label class="etiqueta">Contexto de hoy</label>
        <p class="g2-contexto-texto">“${escaparHtml(intencionHoy)}”</p>
        <button type="button" class="g2-link-btn" id="btn-editar-contexto">Editar</button>` : ''}
      ${mensajesGeneracion}
    </section>` : '';

  app.innerHTML = '';
  app.appendChild(h(`
    <div>
      <header class="g2-appbar"><h1>Inicio</h1><p>¿Qué entrenamos hoy?</p></header>
      ${contextoHtml}
      ${overview.hasAnything ? `
        <section class="g2-card">
          <label class="etiqueta">Hoy</label>
          ${tarjetasHtml}
          <p class="subtitulo" style="margin-top:10px">Total estimado: ~${overview.totalEstimatedDurationMinutes} min</p>
          <button type="button" class="boton-primario g2-cta" id="btn-empezar-combinado">Empezar entrenamiento</button>
        </section>` : `
        <div class="vacio">
          <div class="icono-grande">📅</div>
          <p>Aún no tienes planes activos para hoy.</p>
        </div>
        <button type="button" class="boton-primario g2-cta" id="btn-ir-planes">Ir a Planes</button>`}
      <button type="button" class="boton-secundario" id="btn-ajustar-contexto" style="text-align:left;padding-left:0;margin-top:14px">🎛️ Ajustar contexto de hoy</button>
      <button type="button" class="boton-secundario" id="btn-ver-planes" style="text-align:left;padding-left:0">📚 Ver todos mis planes</button>
    </div>`));

  app.querySelectorAll('[data-ver]').forEach((btn) => {
    btn.onclick = () => irAPantalla(destinoPorProducto[btn.dataset.ver]);
  });
  const btnCombinado = document.getElementById('btn-empezar-combinado');
  if (btnCombinado) {
    btnCombinado.onclick = () => {
      bridge.startSessionFromItems(overview.combinedItems, 'today-combined');
      irAPantalla('entrenar');
    };
  }
  const btnIrPlanes = document.getElementById('btn-ir-planes');
  if (btnIrPlanes) btnIrPlanes.onclick = () => irAPantalla('planes');
  document.getElementById('btn-ajustar-contexto').onclick = () => irAPantalla('ajustar');
  document.getElementById('btn-ver-planes').onclick = () => irAPantalla('planes');
  const btnEditarContexto = document.getElementById('btn-editar-contexto');
  if (btnEditarContexto) btnEditarContexto.onclick = () => irAPantalla('ajustar');
  app.querySelectorAll('[data-descartar]').forEach((btn) => {
    btn.onclick = () => {
      estado.generacion[btn.dataset.descartar].mensaje = null;
      renderInicio();
    };
  });
}

function escaparHtml(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function leerIntencionHoy() {
  return window.GymAppTodayExperience?.readTodayIntent?.() || '';
}

// Ajustar contexto de hoy (GA-005 fluid-context pass). One place where the
// user can (1) say in their own words what changed / what they need today,
// (2) see — and if needed edit — the restrictions GymApp already has saved
// in their profile, and (3) still use the fast session controls below.
//
// The free-text note is USER INTENT, not a restriction or diagnosis: it is
// stored per-day in this browser (src/today-experience/today-intent.mjs),
// shown on Inicio, and forwarded length-bounded to generate-routine as
// labeled intent. Nothing in code parses it into filters/contraindications.
// Structured restrictions (perfiles.lesiones/condiciones_medicas) stay a
// separate, explicit edit.
function renderAjustar() {
  const maxIntencion = window.GymAppTodayExperience?.TODAY_INTENT_MAX_LENGTH || 500;
  app.innerHTML = '';
  app.appendChild(h(`
    <div>
      <header class="g2-appbar"><h1>Ajustar contexto de hoy</h1><p>Cuéntale a GymApp qué cambió o qué necesitas.</p></header>

      <section class="g2-card">
        <label class="etiqueta" for="ajustar-intencion">¿Qué necesitas hoy?</label>
        <textarea class="input-modal g2-intent-input" id="ajustar-intencion" rows="4" maxlength="${maxIntencion}"
          placeholder="Ej.: Me duele el hombro y quiero evitar cargarlo. Tengo solo 25 minutos. Hoy quiero pierna y cardio.">${escaparHtml(leerIntencionHoy())}</textarea>
        <p class="subtitulo g2-intent-nota">Se usa como contexto al generar tus planes de Fuerza y Core hoy. No es un diagnóstico y no reemplaza las restricciones guardadas en tu perfil.</p>
        <div id="ajustar-mensaje"></div>
        <button type="button" class="boton-primario g2-cta" id="ajustar-guardar">Guardar y volver a Inicio</button>
        <label class="etiqueta">Aplicar ahora (genera un plan nuevo que reemplaza al activo)</label>
        <div class="g2-intent-acciones">
          <button type="button" class="g2-btn-secondary" data-aplicar="fuerza">Generar Fuerza</button>
          <button type="button" class="g2-btn-secondary" data-aplicar="abdomen">Generar Core</button>
        </div>
      </section>

      <section class="g2-card" id="ajustar-perfil">
        <label class="etiqueta">Lo que GymApp ya sabe de ti</label>
        <p class="subtitulo">Cargando tu perfil…</p>
      </section>

      <label class="etiqueta" style="margin-top:18px">Sesión rápida con controles</label>
      <div id="today-root"></div>
    </div>`));

  const textarea = document.getElementById('ajustar-intencion');
  const guardarIntencion = () => window.GymAppTodayExperience?.saveTodayIntent?.(textarea.value) ?? '';

  document.getElementById('ajustar-guardar').onclick = () => {
    guardarIntencion();
    irAPantalla('inicio');
  };

  app.querySelectorAll('[data-aplicar]').forEach((btn) => {
    btn.onclick = () => {
      const tipo = btn.dataset.aplicar;
      const tienePlan = tipo === 'fuerza' ? (estado.dias && estado.dias.length > 0) : (estado.abdomen.dias && estado.abdomen.dias.length > 0);
      if (tienePlan && !confirm(`Esto genera un plan nuevo de ${ETIQUETAS_GENERACION[tipo]} que reemplaza al activo. ¿Continuar?`)) return;
      guardarIntencion();
      if (tipo === 'fuerza') invocarGeneracionFuerza();
      else generarRutinaAbdomenDesdeGenerador();
      irAPantalla('inicio');
    };
  });

  if (window.GymAppTodayExperience) {
    window.GymAppTodayExperience.mount(document.getElementById('today-root'), { screen: 'home', navigate: irAPantalla, title: null });
  }

  pintarPerfilEnAjustar();
}

// Read-only summary of the saved profile restrictions, with an explicit
// in-place "Editar" that writes the same perfiles fields the legacy
// Generador/modal already write (lesiones, condiciones_medicas) — so the
// user never has to leave this screen just to correct them.
async function pintarPerfilEnAjustar() {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: perfil } = await supabase.from('perfiles')
    .select('metas, lesiones, condiciones_medicas, dias_disponibles')
    .eq('id', user.id).maybeSingle();

  const seccion = document.getElementById('ajustar-perfil');
  if (!seccion || estado.pantalla !== 'ajustar') return; // el usuario ya navegó a otra pantalla

  if (!perfil) {
    seccion.innerHTML = `<label class="etiqueta">Lo que GymApp ya sabe de ti</label>
      <p class="subtitulo">Aún no tienes perfil guardado. Guárdalo desde Perfil para poder generar planes.</p>`;
    return;
  }

  const edicion = { lesiones: [...(perfil.lesiones || [])], abierta: false, verTodo: false };
  const LIMITE_RESUMEN = 160;

  function pintar() {
    const condiciones = perfil.condiciones_medicas || '';
    const condicionesCorta = condiciones.length > LIMITE_RESUMEN && !edicion.verTodo
      ? `${condiciones.slice(0, LIMITE_RESUMEN)}…`
      : condiciones;
    const lesionesHtml = (perfil.lesiones || []).length
      ? perfil.lesiones.map((l) => `<span class="chip activo g2-chip-lectura">${escaparHtml(l)}</span>`).join('')
      : '<span class="subtitulo">Ninguna registrada</span>';

    seccion.innerHTML = `
      <label class="etiqueta">Lo que GymApp ya sabe de ti</label>
      ${edicion.abierta ? `
        <label class="etiqueta">Lesiones o limitaciones</label>
        <div class="chip-grid" id="ajustar-lesiones"></div>
        <label class="etiqueta">Condición médica específica (opcional)</label>
        <textarea class="input-modal" id="ajustar-condiciones">${escaparHtml(condiciones)}</textarea>
        <div id="ajustar-perfil-mensaje"></div>
        <div class="g2-intent-acciones">
          <button type="button" class="g2-btn-secondary" id="ajustar-perfil-cancelar">Cancelar</button>
          <button type="button" class="g2-btn-secondary" id="ajustar-perfil-guardar">Guardar restricciones</button>
        </div>` : `
        <div class="chip-grid">${lesionesHtml}</div>
        ${condiciones ? `<p class="subtitulo g2-condiciones-resumen">${escaparHtml(condicionesCorta)}
          ${condiciones.length > LIMITE_RESUMEN ? `<button type="button" class="g2-link-btn" id="ajustar-ver-todo">${edicion.verTodo ? 'Ver menos' : 'Ver todo'}</button>` : ''}</p>` : ''}
        <p class="subtitulo">Metas: ${escaparHtml((perfil.metas || []).join(', ') || '—')} · ${perfil.dias_disponibles || '—'} día(s) de gym por semana</p>
        <p class="subtitulo">Estas restricciones se guardan en tu perfil y se usan en cada generación hasta que tú las cambies.</p>
        <button type="button" class="g2-btn-secondary" id="ajustar-perfil-editar">Editar restricciones</button>`}`;

    if (!edicion.abierta) {
      document.getElementById('ajustar-perfil-editar').onclick = () => { edicion.abierta = true; pintar(); };
      const verTodo = document.getElementById('ajustar-ver-todo');
      if (verTodo) verTodo.onclick = () => { edicion.verTodo = !edicion.verTodo; pintar(); };
      return;
    }

    const lesionesDiv = document.getElementById('ajustar-lesiones');
    const pintarLesiones = () => {
      lesionesDiv.innerHTML = LESIONES_COMUNES.map((l) => `<button type="button" class="chip ${edicion.lesiones.includes(l) ? 'activo' : ''}" data-al="${l}">${l}</button>`).join('');
      lesionesDiv.querySelectorAll('[data-al]').forEach((b) => {
        b.onclick = () => {
          const l = b.dataset.al;
          edicion.lesiones = edicion.lesiones.includes(l) ? edicion.lesiones.filter((x) => x !== l) : [...edicion.lesiones, l];
          pintarLesiones();
        };
      });
    };
    pintarLesiones();

    document.getElementById('ajustar-perfil-cancelar').onclick = () => {
      edicion.lesiones = [...(perfil.lesiones || [])];
      edicion.abierta = false;
      pintar();
    };
    document.getElementById('ajustar-perfil-guardar').onclick = async () => {
      const btn = document.getElementById('ajustar-perfil-guardar');
      btn.disabled = true;
      const condicionesNuevas = document.getElementById('ajustar-condiciones').value.trim() || null;
      const { error } = await supabase.from('perfiles')
        .update({ lesiones: edicion.lesiones, condiciones_medicas: condicionesNuevas })
        .eq('id', user.id);
      if (error) {
        document.getElementById('ajustar-perfil-mensaje').innerHTML = `<div class="mensaje error">No se pudo guardar: ${escaparHtml(error.message)}</div>`;
        btn.disabled = false;
        return;
      }
      perfil.lesiones = edicion.lesiones;
      perfil.condiciones_medicas = condicionesNuevas;
      edicion.abierta = false;
      pintar();
    };
  }

  pintar();
}

// =========================================================================
// Planes — product hub for the five training products. Each card reuses
// existing legacy generation/regeneration behavior where it already works
// (Fuerza/Cardio/Core just open the existing, unchanged renderRutina/
// renderCardio/renderAbdomen screens); Calistenia uses the new engine
// (no legacy equivalent exists); Rehabilitación is an honest "not yet"
// placeholder — see renderRehabilitacion().
// =========================================================================
function renderPlanes() {
  const fuerzaActiva = estado.dias && estado.dias.length > 0;
  const cardioActivo = estado.cardio.dias && estado.cardio.dias.length > 0;
  const coreActivo = estado.abdomen.dias && estado.abdomen.dias.length > 0;

  app.innerHTML = '';
  app.appendChild(h(`
    <div>
      <header class="g2-appbar"><h1>Planes</h1><p>Tus programas de entrenamiento</p></header>

      <div class="g2-product-card">
        <div class="g2-product-info">
          <div class="g2-product-name">💪 Fuerza / Gimnasio</div>
          <div class="g2-product-status">${fuerzaActiva ? `${estado.dias.length} día(s) activos` : 'Sin plan activo'}</div>
        </div>
        <button type="button" class="g2-btn-secondary" data-plan-btn="rutina">${fuerzaActiva ? 'Ver plan' : 'Crear plan'}</button>
      </div>

      <div class="g2-product-card">
        <div class="g2-product-info">
          <div class="g2-product-name">🏃 Cardio</div>
          <div class="g2-product-status">${cardioActivo ? `${estado.cardio.dias.length} día(s) activos` : 'Sin plan activo'}</div>
        </div>
        <button type="button" class="g2-btn-secondary" data-plan-btn="cardio">${cardioActivo ? 'Ver plan' : 'Crear plan'}</button>
      </div>

      <div class="g2-product-card">
        <div class="g2-product-info">
          <div class="g2-product-name">🔥 Core / Abdomen</div>
          <div class="g2-product-status">${coreActivo ? `${estado.abdomen.dias.length} día(s) activos` : 'Sin plan activo'}</div>
        </div>
        <button type="button" class="g2-btn-secondary" data-plan-btn="abdomen">${coreActivo ? 'Ver plan' : 'Crear plan'}</button>
      </div>

      <div class="g2-product-card">
        <div class="g2-product-info">
          <div class="g2-product-name">🤸 Calistenia</div>
          <div class="g2-product-status">Generación bajo demanda</div>
        </div>
        <button type="button" class="g2-btn-secondary" data-plan-btn="calistenia">Crear sesión</button>
      </div>

      <div class="g2-product-card g2-product-card-soon">
        <div class="g2-product-info">
          <div class="g2-product-name">🩹 Rehabilitación / Adaptaciones</div>
          <div class="g2-product-status">Próximamente</div>
        </div>
        <button type="button" class="g2-btn-secondary" data-plan-btn="rehabilitacion">Ver</button>
      </div>

      <button type="button" class="boton-secundario" id="btn-mas-herramientas" style="text-align:left;padding-left:0;margin-top:10px">⋯ Más herramientas (Extra, Salir)</button>
    </div>`));

  app.querySelectorAll('[data-plan-btn]').forEach((btn) => {
    btn.onclick = () => irAPantalla(btn.dataset.planBtn);
  });
  document.getElementById('btn-mas-herramientas').onclick = () => irAPantalla('mas');
}

// Calistenia: no legacy generator exists for this product, so it uses the
// new deterministic pipeline directly (Context Engine -> Compatibility
// Engine -> Workout Planner), locked to the calisthenics modality — same
// underlying flow as "Ajustar", just product-scoped.
function renderCalistenia() {
  montarTodayExperience('home', {
    lockedModalities: ['calisthenics'],
    title: 'Calistenia',
    subtitle: 'Genera tu sesión de calistenia de hoy.',
  });
}

// Rehabilitación: an honest placeholder, not a fabricated feature.
// GymApp's restriction model (src/context-engine) can filter exercises
// away from a declared restriction, but there is no rehabilitation
// plan/program concept yet (see docs/REENGINEERING_DECISION_FRAME.md's
// "Rehabilitation activity" — a future domain concept, not built). Do not
// invent one tonight; showing "próximamente" is the honest choice.
function renderRehabilitacion() {
  app.innerHTML = '';
  app.appendChild(h(`
    <div>
      <header class="g2-appbar"><h1>Rehabilitación / Adaptaciones</h1><p>Próximamente</p></header>
      <div class="vacio">
        <div class="icono-grande">🩹</div>
        <p>GymApp todavía no genera planes de rehabilitación.</p>
      </div>
      <p class="subtitulo">Esto requiere un modelo de restricciones/lesiones más completo que el actual — preferimos no inventar una recomendación sin ese soporte.</p>
      <button type="button" class="boton-secundario" id="btn-volver-planes" style="text-align:left;padding-left:0">← Volver a Planes</button>
    </div>`));
  document.getElementById('btn-volver-planes').onclick = () => irAPantalla('planes');
}

// Entrenar: shows the in-progress active workout (state lives in
// src/today-experience/workout-session.mjs's shared store, not in this
// mount, so it survives navigating away and back). If nothing is in
// progress, the module itself renders an empty state pointing back to
// Inicio. Used both for the Today Coordinator's combined session (started
// from Inicio) and for Calistenia's individual session.
function renderEntrenar() {
  montarTodayExperience('active');
}

function montarTodayExperience(pantallaModulo, opciones = {}) {
  app.innerHTML = '<div id="today-root"></div>';
  const contenedor = document.getElementById('today-root');
  if (window.GymAppTodayExperience) {
    window.GymAppTodayExperience.mount(contenedor, { screen: pantallaModulo, navigate: irAPantalla, ...opciones });
  } else {
    contenedor.innerHTML = '<div class="mensaje error">No se pudo cargar el módulo de entrenamiento. Revisa la consola.</div>';
  }
}

// =========================================================================
// Más — acceso temporal a pantallas heredadas (GA-005). Nada de su
// contenido cambió; solo se movieron un nivel más profundo en la
// navegación para que Hoy/Entrenar/Progreso/Perfil sean lo primario.
// =========================================================================
function renderMas() {
  app.innerHTML = '';
  app.appendChild(h(`
    <div>
      <h1 class="titulo">Más</h1>
      <p class="subtitulo">Herramientas y pantallas anteriores de GymApp</p>
      <div class="tarjeta-sesion" data-mas="generador"><div class="fecha">⚙️ Generador</div><span class="subtitulo">Preferencias y generación de rutinas (versión clásica)</span></div>
      <div class="tarjeta-sesion" data-mas="rutina"><div class="fecha">📋 Rutina clásica</div><span class="subtitulo">Rutina de fuerza por días</span></div>
      <div class="tarjeta-sesion" data-mas="abdomen"><div class="fecha">🔥 Abdomen</div><span class="subtitulo">Rutina de abdomen por días</span></div>
      <div class="tarjeta-sesion" data-mas="cardio"><div class="fecha">🏃 Cardio</div><span class="subtitulo">Plan de cardio por días</span></div>
      <div class="tarjeta-sesion" data-mas="extra"><div class="fecha">🧗 Extra</div><span class="subtitulo">Actividad extra (escalada, calistenia, otro)</span></div>
      <div class="tarjeta-sesion" data-mas="salir"><div class="fecha">🚪 Salir</div><span class="subtitulo">Cerrar sesión</span></div>
    </div>`));
  app.querySelectorAll('[data-mas]').forEach((el) => {
    el.style.cursor = 'pointer';
    el.onclick = () => {
      const destino = el.dataset.mas;
      if (destino === 'salir') { supabase.auth.signOut(); return; }
      irAPantalla(destino);
    };
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
// Perfil / Onboarding
// =========================================================================
const perfilForm = {
  nombre: '', peso: '', edad: '', metas: ['Hipertrofia'], lesiones: ['Rodilla'], condicionesMedicas: '', dias: 4, diasCardio: 3, evitarMaquinas: false,
};
let perfilPrecargado = false;

function renderOnboarding() {
  app.innerHTML = '';
  app.appendChild(h(`
    <div>
      <h1 class="titulo">${perfilForm.nombre ? `Hola, ${perfilForm.nombre} 👋` : 'Cuéntanos de ti'}</h1>
      <p class="subtitulo">Tus datos básicos — las preferencias de rutina están en la pestaña Generador</p>
      <div class="campo">
        <label class="etiqueta">Tu nombre</label>
        <input type="text" id="p-nombre" placeholder="¿Cómo te llamas?" value="${perfilForm.nombre}" />
      </div>
      <div class="fila-2col">
        <div><label class="etiqueta">Peso (kg)</label><input type="number" id="p-peso" placeholder="70" value="${perfilForm.peso}" /></div>
        <div><label class="etiqueta">Edad</label><input type="number" id="p-edad" placeholder="28" value="${perfilForm.edad}" /></div>
      </div>
      <div id="p-mensaje"></div>
      <button class="boton-primario" id="p-guardar">Guardar perfil</button>
      <p class="subtitulo" style="margin-top:8px">Para configurar metas, lesiones, condición médica y generar tu rutina, ve a la pestaña <strong>Generador</strong>.</p>

      <h2 class="titulo" style="font-size:16px;margin-top:30px;margin-bottom:2px">Tu peso corporal</h2>
      <p class="subtitulo">Independiente del peso que usa la rutina — esto es tu historial en el tiempo</p>
      <div id="peso-form"></div>
      <div id="peso-grafica"></div>
      <div id="peso-lista"></div>
    </div>`));

  document.getElementById('p-guardar').onclick = guardarPerfil;
  renderPesoCorporal();
}

async function guardarPerfil() {
  const mensajeDiv = document.getElementById('p-mensaje');
  const boton = document.getElementById('p-guardar');
  const nombre = document.getElementById('p-nombre').value.trim();
  const peso = document.getElementById('p-peso').value;
  const edad = document.getElementById('p-edad').value;

  mensajeDiv.innerHTML = '';
  if (!peso || !edad) {
    mensajeDiv.innerHTML = '<div class="mensaje error">Completa tu peso y edad antes de continuar.</div>';
    return;
  }

  boton.disabled = true;
  boton.innerHTML = '<div class="spinner"></div>';

  try {
    const { data: { user } } = await supabase.auth.getUser();

    // Solo nombre/peso/edad — 'upsert' porque el registro podría no existir
    // aún (usuario nuevo); si ya existe, esto NO toca metas/lesiones/etc.
    // que se guardan desde Generador, gracias a que Postgres solo actualiza
    // las columnas que se le pasan explícitamente.
    const { error: perfilError } = await supabase.from('perfiles').upsert({
      id: user.id,
      nombre: nombre || null,
      peso_kg: parseFloat(peso),
      edad: parseInt(edad, 10),
      nivel: 'intermedio',
    });
    if (perfilError) throw new Error(`No se pudo guardar tu perfil: ${perfilError.message}`);
    perfilForm.nombre = nombre;
    const tituloEl = document.querySelector('#app h1.titulo');
    if (tituloEl && nombre) tituloEl.textContent = `Hola, ${nombre} 👋`;

    mensajeDiv.innerHTML = '<div class="mensaje info">Perfil guardado.</div>';
  } catch (err) {
    mensajeDiv.innerHTML = `<div class="mensaje error">${err.message}</div>`;
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar perfil';
  }
}

// Reutilizable desde la pestaña Rutina — asume que el perfil ya se guardó
// antes desde Perfil (no vuelve a pedir peso/edad/metas aquí).
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
  if (estado.pantalla === 'generador') renderGenerador();
  else if (estado.pantalla === 'inicio') renderInicio();
  actualizarIndicadorGeneracion();

  // Contexto libre de hoy ("¿Qué necesitas hoy?", ver renderAjustar): solo
  // generate-routine lo acepta, como intención etiquetada — nunca como
  // restricción. Sin nota, el cuerpo queda exactamente como antes.
  const intencionHoy = nombreFuncion === 'generate-routine' ? leerIntencionHoy() : '';
  const cuerpoPeticion = intencionHoy ? { ...(body || {}), intencion_hoy: intencionHoy } : body;

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

  if (estado.pantalla === 'generador') renderGenerador();
  else if (estado.pantalla === 'inicio') renderInicio();
  actualizarIndicadorGeneracion();
}

function invocarGeneracionFuerza() {
  return invocarGeneracion('fuerza', 'generate-routine');
}

// =========================================================================
// Cargar rutina + estadísticas de días
// =========================================================================
async function regenerarDia(diaNumero, tipo) {
  const esAbdomen = tipo === 'abdominales';
  abrirModalGeneracion({
    titulo: `Regenerar Día ${diaNumero} de ${esAbdomen ? 'abdomen' : 'fuerza'}`,
    tipoDias: 'gym',
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
    titulo: `Regenerar Día ${diaNumero} de cardio`,
    tipoDias: 'cardio',
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
  if (estado.pantalla === 'rutina' || estado.pantalla === 'inicio') render();

  const userId = estado.sesion.user.id;

  const { data: perfilExistente } = await supabase
    .from('perfiles').select('nombre, peso_kg, edad, metas, lesiones, condiciones_medicas, dias_disponibles, dias_disponibles_cardio, evitar_maquinas')
    .eq('id', userId).maybeSingle();
  if (perfilExistente) {
    perfilForm.nombre = perfilExistente.nombre || '';
    perfilForm.peso = perfilExistente.peso_kg ?? '';
    perfilForm.edad = perfilExistente.edad ?? '';
    perfilForm.metas = perfilExistente.metas || perfilForm.metas;
    perfilForm.lesiones = perfilExistente.lesiones || perfilForm.lesiones;
    perfilForm.condicionesMedicas = perfilExistente.condiciones_medicas || '';
    perfilForm.dias = perfilExistente.dias_disponibles || perfilForm.dias;
    perfilForm.diasCardio = perfilExistente.dias_disponibles_cardio || perfilForm.diasCardio;
    perfilForm.evitarMaquinas = perfilExistente.evitar_maquinas || false;

    // Solo la PRIMERA vez que se precargan datos (al abrir la app), refresca
    // la pantalla de Perfil para que se vean — si lo hiciéramos siempre,
    // borraríamos el mensaje de éxito justo después de generar una rutina.
    if (!perfilPrecargado) {
      perfilPrecargado = true;
      if (estado.pantalla === 'onboarding' || estado.pantalla === 'generador') render();
    }
  }

  const { data: rutina, error: rutinaError } = await supabase
    .from('rutinas').select('id')
    .eq('usuario_id', userId).eq('activa', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (rutinaError) {
    estado.errorRutina = `No se pudo cargar tu rutina: ${rutinaError.message}`;
    estado.cargandoRutina = false;
    if (estado.pantalla === 'rutina' || estado.pantalla === 'inicio') render();
    return;
  }

  if (!rutina) {
    estado.rutinaId = null;
    estado.dias = [];
    estado.cargandoRutina = false;
    if (estado.pantalla === 'rutina' || estado.pantalla === 'inicio') render();
    return;
  }

  estado.rutinaId = rutina.id;

  const { data: ejercicios, error: ejerciciosError } = await supabase
    .from('rutina_ejercicios').select('*, ejercicios(nombre, grupo_muscular)')
    .eq('rutina_id', rutina.id).order('dia').order('orden');

  if (ejerciciosError) {
    estado.errorRutina = `No se pudieron cargar los ejercicios: ${ejerciciosError.message}`;
    estado.cargandoRutina = false;
    if (estado.pantalla === 'rutina' || estado.pantalla === 'inicio') render();
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
  if (estado.pantalla === 'rutina' || estado.pantalla === 'inicio') render();
}

async function cargarRutinaAbdomen() {
  const ab = estado.abdomen;
  ab.cargando = true;
  ab.error = null;
  if (estado.pantalla === 'abdomen' || estado.pantalla === 'inicio') render();

  const userId = estado.sesion.user.id;

  const { data: rutina, error: rutinaError } = await supabase
    .from('rutinas').select('id')
    .eq('usuario_id', userId).eq('activa', true).eq('tipo', 'abdominales')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (rutinaError) {
    ab.error = `No se pudo cargar tu rutina de abdomen: ${rutinaError.message}`;
    ab.cargando = false;
    if (estado.pantalla === 'abdomen' || estado.pantalla === 'inicio') render();
    return;
  }

  if (!rutina) {
    ab.rutinaId = null;
    ab.dias = [];
    ab.cargando = false;
    if (estado.pantalla === 'abdomen' || estado.pantalla === 'inicio') render();
    return;
  }

  ab.rutinaId = rutina.id;

  const { data: ejercicios, error: ejerciciosError } = await supabase
    .from('rutina_ejercicios').select('*, ejercicios(nombre, grupo_muscular)')
    .eq('rutina_id', rutina.id).order('dia').order('orden');

  if (ejerciciosError) {
    ab.error = `No se pudieron cargar los ejercicios: ${ejerciciosError.message}`;
    ab.cargando = false;
    if (estado.pantalla === 'abdomen' || estado.pantalla === 'inicio') render();
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
  if (estado.pantalla === 'abdomen' || estado.pantalla === 'inicio') render();
}

// =========================================================================
// Cardio: plan generado por IA (fases, no series/reps) + marcar completado
// =========================================================================
async function cargarRutinaCardio() {
  const c = estado.cardio;
  c.cargando = true;
  c.error = null;
  if (estado.pantalla === 'cardio' || estado.pantalla === 'inicio') render();

  const userId = estado.sesion.user.id;

  const { data: rutina, error: rutinaError } = await supabase
    .from('rutinas').select('id')
    .eq('usuario_id', userId).eq('activa', true).eq('tipo', 'cardio')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (rutinaError) {
    c.error = `No se pudo cargar tu plan de cardio: ${rutinaError.message}`;
    c.cargando = false;
    if (estado.pantalla === 'cardio' || estado.pantalla === 'inicio') render();
    return;
  }
  if (!rutina) {
    c.rutinaId = null;
    c.dias = [];
    c.cargando = false;
    if (estado.pantalla === 'cardio' || estado.pantalla === 'inicio') render();
    return;
  }
  c.rutinaId = rutina.id;

  const { data: fases, error: fasesError } = await supabase
    .from('cardio_plan').select('*').eq('rutina_id', rutina.id).order('dia').order('orden');

  if (fasesError) {
    c.error = `No se pudieron cargar las fases: ${fasesError.message}`;
    c.cargando = false;
    if (estado.pantalla === 'cardio' || estado.pantalla === 'inicio') render();
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
  if (estado.pantalla === 'cardio' || estado.pantalla === 'inicio') render();
}

function renderCardio() {
  app.innerHTML = '';
  const c = estado.cardio;

  const botonGenerar = `
    <button class="boton-secundario" id="btn-generar-cardio" style="text-align:left;padding-left:0">
      ⚙️ Ir a Generador (${c.dias && c.dias.length > 0 ? 'regenerar' : 'generar'} plan de cardio)
    </button>
    <div id="cardio-gen-mensaje"></div>`;

  if (c.cargando) {
    app.appendChild(h('<div class="pantalla-carga"><div class="spinner"></div></div>'));
    return;
  }
  if (c.error) app.appendChild(h(`<div class="mensaje error">${c.error}</div>`));

  if (!c.dias || c.dias.length === 0) {
    app.appendChild(h(`
      <div>
        <div class="vacio"><div class="icono-grande">🏃</div><p>Aún no tienes plan de cardio.</p></div>
        ${botonGenerar}
      </div>`));
    document.getElementById('btn-generar-cardio').onclick = irAGenerador;
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
      <h1 class="titulo">Plan de cardio</h1>
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
      ${botonGenerar}
      <button class="boton-secundario" id="btn-regenerar-dia-cardio" style="text-align:left;padding-left:0">🔄 Regenerar solo este día con IA</button>
      <div id="regen-mensaje-cardio"></div>
      <div id="fases-cardio"></div>
      <div id="cardio-mensaje"></div>
      <button class="boton-primario" id="btn-marcar-cardio" ${yaCompletadoHoy ? 'disabled' : ''}>
        ${yaCompletadoHoy ? 'Ya completaste esto hoy ✓' : 'Marcar como completado hoy'}
      </button>
    </div>`));
  app.appendChild(cont);

  document.getElementById('btn-generar-cardio').onclick = irAGenerador;
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

function irAGenerador() {
  estado.pantalla = 'generador';
  render();
}

// =========================================================================
// Pantalla Generador — configura preferencias y genera/regenera cada tipo
// de rutina, todo en un solo lugar.
// =========================================================================
function renderGenerador() {
  app.innerHTML = '';
  app.appendChild(h(`
    <div>
      <h1 class="titulo">Generador</h1>
      <p class="subtitulo">Ajusta esto cuando tu situación cambie (ej. una lesión que ya sanó), y genera cada rutina abajo.</p>

      <label class="etiqueta">Tus metas (hasta ${MAX_METAS})</label>
      <div class="chip-grid" id="g-metas"></div>
      <div id="g-prioridad"></div>

      <label class="etiqueta">¿Alguna lesión o limitación? (rápido, general)</label>
      <div class="chip-grid" id="g-lesiones"></div>

      <div class="campo">
        <label class="etiqueta">Condiciones médicas específicas (opcional, pero importante)</label>
        <textarea class="input-modal" id="g-condiciones">${perfilForm.condicionesMedicas}</textarea>
        <p class="subtitulo" style="margin-top:6px;margin-bottom:0">
          Esto NO sustituye la valoración de tu médico o fisioterapeuta.
        </p>
      </div>

      <div class="toggle-fila ${perfilForm.evitarMaquinas ? 'activo' : ''}" id="g-evitar-maquinas">
        <div class="toggle-dot"></div>
        <div class="toggle-texto">
          <strong>Priorizar equipo con más disponibilidad</strong>
          <span>Barra, mancuernas, polea y peso corporal en vez de máquinas.</span>
        </div>
      </div>

      <label class="etiqueta">Días de gym (fuerza/abdomen) por semana: <span id="g-dias-num">${perfilForm.dias}</span></label>
      <div class="chip-grid" id="g-dias"></div>
      <label class="etiqueta">Días de cardio por semana: <span id="g-dias-cardio-num">${perfilForm.diasCardio}</span></label>
      <div class="chip-grid" id="g-dias-cardio"></div>

      <div id="g-mensaje"></div>
      <button class="boton-primario" id="g-guardar">Guardar preferencias</button>

      <h2 class="titulo" style="font-size:16px;margin-top:28px;margin-bottom:10px">Generar rutinas</h2>

      <div class="tarjeta-sesion">
        <div class="fecha">💪 Fuerza</div>
        <button class="boton-secundario" id="g-btn-fuerza" style="text-align:left;padding-left:0" ${estado.generacion.fuerza.activo ? 'disabled' : ''}>
          ${estado.generacion.fuerza.activo ? '<div class="spinner"></div>' : `${estado.dias?.length ? 'Regenerar' : 'Generar'} rutina de fuerza`}
        </button>
        <div id="g-mensaje-fuerza">${estado.generacion.fuerza.mensaje ? `<div class="mensaje ${estado.generacion.fuerza.mensaje.tipo}">${estado.generacion.fuerza.mensaje.texto}</div>` : ''}</div>
      </div>
      <div class="tarjeta-sesion">
        <div class="fecha">🔥 Abdomen</div>
        <button class="boton-secundario" id="g-btn-abdomen" style="text-align:left;padding-left:0" ${estado.generacion.abdomen.activo ? 'disabled' : ''}>
          ${estado.generacion.abdomen.activo ? '<div class="spinner"></div>' : `${estado.abdomen.dias?.length ? 'Regenerar' : 'Generar'} rutina de abdomen`}
        </button>
        <div id="g-mensaje-abdomen">${estado.generacion.abdomen.mensaje ? `<div class="mensaje ${estado.generacion.abdomen.mensaje.tipo}">${estado.generacion.abdomen.mensaje.texto}</div>` : ''}</div>
      </div>
      <div class="tarjeta-sesion">
        <div class="fecha">🏃 Cardio</div>
        <button class="boton-secundario" id="g-btn-cardio" style="text-align:left;padding-left:0" ${estado.generacion.cardio.activo ? 'disabled' : ''}>
          ${estado.generacion.cardio.activo ? '<div class="spinner"></div>' : `${estado.cardio.dias?.length ? 'Regenerar' : 'Generar'} plan de cardio`}
        </button>
        <div id="g-mensaje-cardio">${estado.generacion.cardio.mensaje ? `<div class="mensaje ${estado.generacion.cardio.mensaje.tipo}">${estado.generacion.cardio.mensaje.texto}</div>` : ''}</div>
      </div>
    </div>`));

  const metasDiv = document.getElementById('g-metas');
  const prioridadDiv = document.getElementById('g-prioridad');

  function pintarMetas() {
    metasDiv.innerHTML = METAS.map((m) => {
      const sel = perfilForm.metas.includes(m);
      const deshab = !sel && perfilForm.metas.length >= MAX_METAS;
      return `<button class="chip ${sel ? 'activo' : ''}" data-meta="${m}" ${deshab ? 'disabled' : ''}>${m}</button>`;
    }).join('');
    metasDiv.querySelectorAll('[data-meta]').forEach((btn) => {
      btn.onclick = () => {
        const m = btn.dataset.meta;
        if (perfilForm.metas.includes(m)) perfilForm.metas = perfilForm.metas.filter((x) => x !== m);
        else if (perfilForm.metas.length < MAX_METAS) perfilForm.metas = [...perfilForm.metas, m];
        pintarMetas();
        pintarPrioridad();
      };
    });
  }

  function pintarPrioridad() {
    if (perfilForm.metas.length <= 1) { prioridadDiv.innerHTML = ''; return; }
    prioridadDiv.innerHTML = `
      <label class="etiqueta">¿Cuál es tu prioridad principal?</label>
      <div class="chip-grid">
        ${perfilForm.metas.map((m, i) => `<button class="chip ${i === 0 ? 'activo' : ''}" data-prio="${m}">${i === 0 ? '★ ' : ''}${m}</button>`).join('')}
      </div>`;
    prioridadDiv.querySelectorAll('[data-prio]').forEach((btn) => {
      btn.onclick = () => {
        const m = btn.dataset.prio;
        perfilForm.metas = [m, ...perfilForm.metas.filter((x) => x !== m)];
        pintarMetas();
        pintarPrioridad();
      };
    });
  }

  const lesionesDiv = document.getElementById('g-lesiones');
  function pintarLesiones() {
    lesionesDiv.innerHTML = LESIONES_COMUNES.map((l) => {
      const sel = perfilForm.lesiones.includes(l);
      return `<button class="chip ${sel ? 'activo' : ''}" data-lesion="${l}">${l}${sel ? ' ✕' : ''}</button>`;
    }).join('');
    lesionesDiv.querySelectorAll('[data-lesion]').forEach((btn) => {
      btn.onclick = () => {
        const l = btn.dataset.lesion;
        perfilForm.lesiones = perfilForm.lesiones.includes(l)
          ? perfilForm.lesiones.filter((x) => x !== l)
          : [...perfilForm.lesiones, l];
        pintarLesiones();
      };
    });
  }
  pintarLesiones();

  document.getElementById('g-evitar-maquinas').onclick = () => {
    perfilForm.evitarMaquinas = !perfilForm.evitarMaquinas;
    renderGenerador();
  };

  const diasDiv = document.getElementById('g-dias');
  function pintarDias() {
    diasDiv.innerHTML = [1, 2, 3, 4, 5, 6].map((d) => `<button class="chip ${perfilForm.dias === d ? 'activo' : ''}" data-dia="${d}">${d}</button>`).join('');
    document.getElementById('g-dias-num').textContent = perfilForm.dias;
    diasDiv.querySelectorAll('[data-dia]').forEach((btn) => {
      btn.onclick = () => { perfilForm.dias = Number(btn.dataset.dia); pintarDias(); };
    });
  }
  pintarDias();

  const diasCardioDiv = document.getElementById('g-dias-cardio');
  function pintarDiasCardio() {
    diasCardioDiv.innerHTML = [1, 2, 3, 4, 5, 6, 7].map((d) => `<button class="chip ${perfilForm.diasCardio === d ? 'activo' : ''}" data-dia-cardio="${d}">${d}</button>`).join('');
    document.getElementById('g-dias-cardio-num').textContent = perfilForm.diasCardio;
    diasCardioDiv.querySelectorAll('[data-dia-cardio]').forEach((btn) => {
      btn.onclick = () => { perfilForm.diasCardio = Number(btn.dataset.diaCardio); pintarDiasCardio(); };
    });
  }
  pintarDiasCardio();

  pintarMetas();
  pintarPrioridad();

  document.getElementById('g-guardar').onclick = guardarPreferenciasGenerador;
  document.getElementById('g-btn-fuerza').onclick = () => invocarGeneracionFuerza();
  document.getElementById('g-btn-abdomen').onclick = () => generarRutinaAbdomenDesdeGenerador();
  document.getElementById('g-btn-cardio').onclick = () => generarRutinaCardioDesdeGenerador();
}

async function guardarPreferenciasGenerador() {
  const mensajeDiv = document.getElementById('g-mensaje');
  const boton = document.getElementById('g-guardar');
  const condicionesMedicas = document.getElementById('g-condiciones').value.trim();
  mensajeDiv.innerHTML = '';
  boton.disabled = true;
  boton.innerHTML = '<div class="spinner"></div>';

  const { data: { user } } = await supabase.auth.getUser();
  const equipoDisponible = ['barra', 'mancuernas', 'polea', 'maquina', 'peso_corporal'];

  const { error } = await supabase.from('perfiles').update({
    metas: perfilForm.metas,
    lesiones: perfilForm.lesiones,
    condiciones_medicas: condicionesMedicas || null,
    dias_disponibles: perfilForm.dias,
    dias_disponibles_cardio: perfilForm.diasCardio,
    equipo_disponible: equipoDisponible,
    evitar_maquinas: perfilForm.evitarMaquinas,
  }).eq('id', user.id);

  boton.disabled = false;
  boton.textContent = 'Guardar preferencias';

  if (error) {
    mensajeDiv.innerHTML = `<div class="mensaje error">No se pudo guardar: ${error.message}</div>`;
    return;
  }
  perfilForm.condicionesMedicas = condicionesMedicas;
  mensajeDiv.innerHTML = '<div class="mensaje info">Preferencias guardadas.</div>';
}

function generarRutinaAbdomenDesdeGenerador() {
  return invocarGeneracion('abdomen', 'generate-routine', { tipo: 'abdominales' });
}

function generarRutinaCardioDesdeGenerador() {
  return invocarGeneracion('cardio', 'generate-cardio-plan');
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
        <div class="vacio">
          <div class="icono-grande">📋</div>
          <p>Aún no tienes rutina de fuerza.</p>
        </div>
        <button class="boton-secundario" id="btn-generar-fuerza" style="text-align:left;padding-left:0">⚙️ Ir a Generador</button>
      </div>`));
    document.getElementById('btn-generar-fuerza').onclick = () => { estado.pantalla = 'generador'; render(); };
    return;
  }

  const diasCompletadosEstaSemana = estado.semanaActual.filter((c) => c.dia != null).length;
  const dia = estado.dias[estado.diaActivo];
  const info = estado.conteoDias[dia.dia] || { total: 0 };

  const cont = h('<div></div>');
  cont.appendChild(h(`
    <div>
      <h1 class="titulo">Mi rutina</h1>
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
      <button class="boton-secundario" id="btn-generar-fuerza" style="text-align:left;padding-left:0">⚙️ Ir a Generador (para regenerar toda la rutina)</button>
      <button class="boton-secundario" id="btn-regenerar-dia" style="text-align:left;padding-left:0">🔄 Regenerar solo este día con IA</button>
      <div id="regen-mensaje"></div>
      <div id="lista-ejercicios"></div>
    </div>`));
  app.appendChild(cont);

  document.getElementById('btn-generar-fuerza').onclick = () => { estado.pantalla = 'generador'; render(); };

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

  const botonGenerar = `
    <button class="boton-secundario" id="btn-generar-abdomen" style="text-align:left;padding-left:0">
      ⚙️ Ir a Generador (${ab.dias && ab.dias.length > 0 ? 'regenerar' : 'generar'} rutina de abdomen)
    </button>
    <div id="abdomen-gen-mensaje"></div>`;

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
        <div class="vacio">
          <div class="icono-grande">🔥</div>
          <p>Aún no tienes rutina de abdomen.</p>
        </div>
        ${botonGenerar}
      </div>`));
    document.getElementById('btn-generar-abdomen').onclick = irAGenerador;
    return;
  }

  const diasCompletadosEstaSemana = ab.semanaActual.filter((c) => c.dia != null).length;
  const dia = ab.dias[ab.diaActivo];
  const info = ab.conteoDias[dia.dia] || { total: 0 };

  const cont = h('<div></div>');
  cont.appendChild(h(`
    <div>
      <h1 class="titulo">Rutina de abdomen</h1>
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
      ${botonGenerar}
      <button class="boton-secundario" id="btn-regenerar-dia-ab" style="text-align:left;padding-left:0">🔄 Regenerar solo este día con IA</button>
      <div id="regen-mensaje-ab"></div>
      <div id="lista-ejercicios-ab"></div>
    </div>`));
  app.appendChild(cont);

  document.getElementById('btn-generar-abdomen').onclick = irAGenerador;
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

  if (error) { app.innerHTML = `<div class="mensaje error">${error.message}</div>`; return; }
  if (!sesiones || sesiones.length === 0) {
    app.innerHTML = `<div class="vacio"><div class="icono-grande">📅</div><p>Todavía no tienes sesiones registradas.</p></div>`;
    return;
  }

  app.innerHTML = '<h1 class="titulo">Historial</h1><p class="subtitulo">Tus últimas sesiones (fuerza, abdomen y cardio)</p><div id="hist-lista"></div>';
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
          <div class="linea"><span>Ver detalle en Extra → Cardio</span></div>
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
      <h1 class="titulo">Actividad extra</h1>
      <p class="subtitulo">Cardio, abdomen, escalada — independiente de tu rutina de fuerza</p>
      <div class="chip-grid" id="extra-tipos"></div>
      <div id="extra-form"></div>
      <div id="extra-mensaje"></div>
      <button class="boton-primario" id="extra-guardar">Guardar</button>
      <h2 class="titulo" style="font-size:16px;margin-top:26px;margin-bottom:10px">Historial</h2>
      <div id="extra-lista"><div class="pantalla-carga"><div class="spinner"></div></div></div>
    </div>`));

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
