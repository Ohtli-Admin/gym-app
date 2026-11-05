// =========================================================================
// Librería (rediseño 003, US2) — explorar el catálogo de
// Gym-Exercise-Library desde la app: buscar, filtrar por músculo y equipo,
// y abrir la ficha de cada ejercicio con su lámina.
//
// Lee el snapshot que GymApp versiona (src/exercise-library/generated/,
// ver tools/sync-exercise-library.mjs y tools/sync-exercise-media.py);
// nunca el repo de la librería. Script clásico: usa h(), escaparHtml(),
// irAPantalla() y `app` de app.js, que existen cuando estas funciones se
// llaman. Las funciones de clasificación son puras y se prueban en
// tools/libreria.test.mjs.
// =========================================================================

const RUTA_LIBRERIA = 'src/exercise-library/generated/';

const GRUPOS_LIBRERIA = [
  { id: 'pecho', etiqueta: 'Pecho' },
  { id: 'espalda', etiqueta: 'Espalda' },
  { id: 'hombro', etiqueta: 'Hombro' },
  { id: 'brazos', etiqueta: 'Brazos' },
  { id: 'piernas', etiqueta: 'Piernas y glúteo' },
  { id: 'core', etiqueta: 'Core' },
];

const EQUIPOS_LIBRERIA = [
  { id: 'barra', etiqueta: 'Barra', ids: ['barbell', 'ez_bar'] },
  { id: 'mancuernas', etiqueta: 'Mancuernas', ids: ['dumbbell'] },
  { id: 'polea', etiqueta: 'Polea', ids: ['cable_machine'] },
  { id: 'kettlebell', etiqueta: 'Kettlebell', ids: ['kettlebell'] },
  { id: 'sin-equipo', etiqueta: 'Sin equipo', ids: ['bodyweight'] },
  { id: 'otros', etiqueta: 'Bandas y balones', ids: ['resistance_band', 'medicine_ball', 'swiss_ball', 'foam_roller'] },
];

// Nombres en español de la taxonomía de la librería (taxonomy/*.json).
const MUSCULOS_ES = {
  pectorals: 'Pectorales', latissimus_dorsi: 'Dorsal ancho', trapezius: 'Trapecio',
  biceps_group: 'Bíceps', triceps_group: 'Tríceps', gluteals: 'Glúteos',
  quadriceps: 'Cuádriceps', hamstrings: 'Isquiotibiales', hip_adductors: 'Aductores', calves: 'Pantorrilla',
};
const EQUIPO_ES = {
  barbell: 'Barra', ez_bar: 'Barra Z', dumbbell: 'Mancuernas', cable_machine: 'Polea', kettlebell: 'Kettlebell',
  bodyweight: 'Peso corporal', resistance_band: 'Banda elástica', medicine_ball: 'Balón medicinal',
  swiss_ball: 'Balón de estabilidad', foam_roller: 'Rodillo de espuma',
};
const NIVEL_ES = { beginner: 'Principiante', intermediate: 'Intermedio', advanced: 'Avanzado', expert: 'Avanzado' };
const TIPO_ES = {
  strength: 'Fuerza', stretching: 'Estiramiento', powerlifting: 'Powerlifting',
  olympic_weightlifting: 'Halterofilia', plyometrics: 'Pliometría', cardio: 'Cardio',
};

const GRUPO_POR_MUSCULO = {
  pectorals: 'pecho', latissimus_dorsi: 'espalda', trapezius: 'espalda',
  biceps_group: 'brazos', triceps_group: 'brazos',
  quadriceps: 'piernas', hamstrings: 'piernas', calves: 'piernas', hip_adductors: 'piernas', gluteals: 'piernas',
};
const GRUPO_POR_REGION = {
  shoulder_girdle: 'hombro', back: 'espalda', core_trunk: 'core', posterior_core: 'core',
  forearm_hand: 'brazos', hip_pelvis: 'piernas',
};

// Grupos del filtro "músculo" para un registro. Con músculos principales
// manda el músculo; sin ellos (muchos registros de la librería todavía no
// los traen) se usa la región corporal.
function gruposDeEjercicio(registro) {
  const c = registro.classification || {};
  const porMusculo = (c.primary_muscles || []).map((m) => GRUPO_POR_MUSCULO[m]).filter(Boolean);
  const fuente = porMusculo.length ? porMusculo : (c.body_regions || []).map((r) => GRUPO_POR_REGION[r]).filter(Boolean);
  return [...new Set(fuente)];
}

function equiposDeEjercicio(registro) {
  const req = registro.setup?.equipment_required || [];
  return EQUIPOS_LIBRERIA.filter((e) => e.ids.some((id) => req.includes(id))).map((e) => e.id);
}

function normalizarBusqueda(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Filtra y ordena (con lámina primero, luego alfabético) el catálogo.
function filtrarLibreria(registros, { texto = '', grupo = null, equipo = null } = {}, conImagen = new Set()) {
  const q = normalizarBusqueda(texto);
  return registros
    .filter((r) => !grupo || gruposDeEjercicio(r).includes(grupo))
    .filter((r) => !equipo || equiposDeEjercicio(r).includes(equipo))
    .filter((r) => !q || normalizarBusqueda(`${r.names?.es || ''} ${r.names?.en || ''}`).includes(q))
    .sort((a, b) => (conImagen.has(b.exercise_id) - conImagen.has(a.exercise_id))
      || (a.names?.es || a.names?.en || '').localeCompare(b.names?.es || b.names?.en || '', 'es'));
}

function nombreEjercicioLibreria(registro) {
  return registro.names?.es || registro.names?.en || registro.exercise_id;
}

// ---- Carga del snapshot (una vez por sesión) ----
const libreria = { registros: null, conImagen: new Set(), error: null, cargando: null, filtros: { texto: '', grupo: null, equipo: null }, fichaId: null, limite: 40, espera: null };

function cargarLibreria() {
  if (libreria.registros || libreria.cargando) return libreria.cargando || Promise.resolve();
  libreria.cargando = Promise.all([
    fetch(`${RUTA_LIBRERIA}catalog.json`).then((r) => { if (!r.ok) throw new Error(`catálogo ${r.status}`); return r.json(); }),
    fetch(`${RUTA_LIBRERIA}media/index.json`).then((r) => (r.ok ? r.json() : { ids: [] })).catch(() => ({ ids: [] })),
  ]).then(([catalogo, media]) => {
    libreria.registros = catalogo;
    libreria.conImagen = new Set(media.ids || []);
  }).catch((e) => {
    libreria.error = `No se pudo cargar la librería (${e.message}).`;
  }).finally(() => {
    libreria.cargando = null;
    if (estado.pantalla === 'libreria' || estado.pantalla === 'ficha') render();
  });
  return libreria.cargando;
}

function imagenLibreria(id, mini) {
  return libreria.conImagen.has(id) ? `${RUTA_LIBRERIA}media/${id}${mini ? '-mini' : ''}.webp` : null;
}

function marcadorSinImagen(registro) {
  const grupo = GRUPOS_LIBRERIA.find((g) => g.id === gruposDeEjercicio(registro)[0]);
  return `<span class="g3-sin-lamina">${escaparHtml(grupo ? grupo.etiqueta : 'Ejercicio')}</span>`;
}

function renderLibreria() {
  // Una búsqueda pendiente de la vista anterior ya no aplica.
  clearTimeout(libreria.espera);
  if (!libreria.registros) {
    app.innerHTML = libreria.error
      ? `<header class="g3-header"><h1>Librería</h1></header><div class="mensaje error">${escaparHtml(libreria.error)}</div><button type="button" class="boton-secundario" id="lib-reintentar">Reintentar</button>`
      : '<header class="g3-header"><h1>Librería</h1></header><div class="pantalla-carga"><div class="spinner"></div></div>';
    if (libreria.error) {
      document.getElementById('lib-reintentar').onclick = () => { libreria.error = null; renderLibreria(); };
    } else {
      cargarLibreria();
    }
    return;
  }
  const f = libreria.filtros;
  const chips = (lista, campo) => lista.map((x) => `<button type="button" class="g3-tab ${f[campo] === x.id ? 'activo' : ''}" aria-pressed="${f[campo] === x.id}" data-filtro-${campo}="${x.id}">${x.etiqueta}</button>`).join('');

  app.innerHTML = '';
  app.appendChild(h(`
    <div>
      <header class="g3-header"><h1>Librería</h1></header>
      <label class="g3-buscar">
        <span class="sr-only">Buscar ejercicio</span>
        <input type="search" id="lib-buscar" placeholder="Buscar ejercicio" value="${escaparHtml(f.texto)}" autocomplete="off" />
      </label>
      <div class="g3-tabs" aria-label="Músculo">${chips(GRUPOS_LIBRERIA, 'grupo')}</div>
      <div class="g3-tabs" aria-label="Equipo">${chips(EQUIPOS_LIBRERIA, 'equipo')}</div>
      <p class="g3-nota" id="lib-conteo"></p>
      <div class="g3-galeria" id="lib-galeria"></div>
      <button type="button" class="boton-secundario" id="lib-mas" hidden>Ver más</button>
    </div>`));

  const pintarResultados = () => {
    const lista = filtrarLibreria(libreria.registros, f, libreria.conImagen);
    document.getElementById('lib-conteo').textContent = `${lista.length} ejercicio${lista.length === 1 ? '' : 's'}`;
    const galeria = document.getElementById('lib-galeria');
    galeria.innerHTML = lista.length ? lista.slice(0, libreria.limite).map((r) => {
      const img = imagenLibreria(r.exercise_id, true);
      return `
        <button type="button" class="g3-tarjeta" data-ficha="${escaparHtml(r.exercise_id)}">
          ${img ? `<img src="${img}" alt="" loading="lazy" />` : marcadorSinImagen(r)}
          <span>${escaparHtml(nombreEjercicioLibreria(r))}</span>
        </button>`;
    }).join('') : '<p class="g3-nota">Nada coincide con esos filtros.</p>';
    galeria.querySelectorAll('[data-ficha]').forEach((btn) => {
      btn.onclick = () => abrirFicha(btn.dataset.ficha);
    });
    const mas = document.getElementById('lib-mas');
    mas.hidden = lista.length <= libreria.limite;
    mas.onclick = () => { libreria.limite += 40; pintarResultados(); };
  };

  const buscar = document.getElementById('lib-buscar');
  buscar.oninput = () => {
    // El texto se guarda al momento; solo el repintado espera.
    f.texto = buscar.value;
    libreria.limite = 40;
    clearTimeout(libreria.espera);
    libreria.espera = setTimeout(() => { if (buscar.isConnected) pintarResultados(); }, 150);
  };
  ['grupo', 'equipo'].forEach((campo) => {
    app.querySelectorAll(`[data-filtro-${campo}]`).forEach((btn) => {
      btn.onclick = () => {
        const valor = btn.getAttribute(`data-filtro-${campo}`);
        f[campo] = f[campo] === valor ? null : valor;
        libreria.limite = 40;
        renderLibreria();
      };
    });
  });
  pintarResultados();
}

function abrirFicha(id) {
  libreria.fichaId = id;
  estado.pantalla = 'ficha';
  render();
  window.scrollTo(0, 0);
}

function renderFicha() {
  if (!libreria.registros) { renderLibreria(); return; }
  const r = libreria.registros.find((x) => x.exercise_id === libreria.fichaId);
  if (!r) { irAPantalla('libreria'); return; }
  const c = r.classification || {};
  const img = imagenLibreria(r.exercise_id, false);
  const lista = (ids, mapa) => ids.map((id) => mapa[id]).filter(Boolean);
  const principales = lista(c.primary_muscles || [], MUSCULOS_ES);
  const secundarios = lista(c.secondary_muscles || [], MUSCULOS_ES);
  const equipo = lista(r.setup?.equipment_required || [], EQUIPO_ES);
  const etiquetas = [
    ...gruposDeEjercicio(r).map((g) => GRUPOS_LIBRERIA.find((x) => x.id === g).etiqueta),
    ...equipo,
    NIVEL_ES[r.difficulty?.overall],
    ...lista(c.training_types || [], TIPO_ES),
  ].filter(Boolean);

  app.innerHTML = '';
  app.appendChild(h(`
    <div class="g3-ficha">
      <button type="button" class="g2-back" id="ficha-volver">‹ Librería</button>
      ${img ? `<img class="g3-ficha-img" src="${img}" alt="Lámina de ${escaparHtml(nombreEjercicioLibreria(r))}: posición inicial, final y músculos" />` : `<div class="g3-ficha-img g3-ficha-vacia">${marcadorSinImagen(r)}<p>Todavía no tiene lámina.</p></div>`}
      <h1 class="titulo">${escaparHtml(nombreEjercicioLibreria(r))}</h1>
      ${r.names?.en && r.names.en !== r.names.es ? `<p class="g3-nota">En inglés: ${escaparHtml(r.names.en)}</p>` : ''}
      <div class="g3-etiquetas">${etiquetas.map((e) => `<span>${escaparHtml(e)}</span>`).join('')}</div>
      ${principales.length || secundarios.length ? `
        <dl class="g3-datos">
          ${principales.length ? `<div><dt>Trabaja</dt><dd>${escaparHtml(principales.join(', '))}</dd></div>` : ''}
          ${secundarios.length ? `<div><dt>También</dt><dd>${escaparHtml(secundarios.join(', '))}</dd></div>` : ''}
        </dl>` : ''}
      ${r.biomechanics?.movement_summary ? `<p>${escaparHtml(r.biomechanics.movement_summary)}</p>` : ''}
    </div>`));
  document.getElementById('ficha-volver').onclick = () => irAPantalla('libreria');
}

// Para pruebas en Node (tools/libreria.test.mjs); en el navegador no hay `module`.
if (typeof module !== 'undefined') {
  module.exports = { gruposDeEjercicio, equiposDeEjercicio, filtrarLibreria, normalizarBusqueda, GRUPOS_LIBRERIA, EQUIPOS_LIBRERIA };
}
