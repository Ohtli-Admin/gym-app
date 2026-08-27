// =========================================================================
// Estado global
// =========================================================================
const estado = {
  sesion: undefined, // undefined = cargando, null = sin sesión
  pantalla: 'onboarding',
  authModo: 'login', // 'login' | 'registro' | 'reset'
  dias: null,
  rutinaId: null,
  conteoDias: {}, // { 1: {total, estaSemana}, 2: {...} }
  cargandoRutina: false,
  errorRutina: null,
  diaActivo: 0,
  ejercicioActivo: null,
};

const LESIONES_COMUNES = ['Rodilla', 'Hombro', 'Espalda baja', 'Muñeca', 'Tobillo', 'Cadera'];
const METAS = ['Hipertrofia', 'Fuerza', 'Resistencia', 'Pérdida de grasa'];
const MAX_METAS = 3;

const app = document.getElementById('app');
const navContainer = document.getElementById('nav-container');

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
async function iniciar() {
  const { data } = await supabase.auth.getSession();
  estado.sesion = data.session;
  render();

  supabase.auth.onAuthStateChange((_evt, nuevaSesion) => {
    estado.sesion = nuevaSesion;
    if (nuevaSesion) cargarRutina();
    render();
  });

  if (estado.sesion) cargarRutina();
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
  else if (estado.pantalla === 'rutina') renderRutina();
  else if (estado.pantalla === 'registro') renderRegistro();
  else if (estado.pantalla === 'historial') renderHistorial();
  else if (estado.pantalla === 'extra') renderExtra();

  renderNav();
}

function renderNav() {
  navContainer.innerHTML = `
    <div class="nav-inferior">
      <button class="nav-item ${estado.pantalla === 'onboarding' ? 'activo' : ''}" data-nav="onboarding"><span class="icono">👤</span>Perfil</button>
      <button class="nav-item ${estado.pantalla === 'rutina' ? 'activo' : ''}" data-nav="rutina"><span class="icono">📋</span>Rutina</button>
      <button class="nav-item ${estado.pantalla === 'registro' ? 'activo' : ''}" data-nav="registro"><span class="icono">✏️</span>Registro</button>
      <button class="nav-item ${estado.pantalla === 'extra' ? 'activo' : ''}" data-nav="extra"><span class="icono">🏃</span>Extra</button>
      <button class="nav-item ${estado.pantalla === 'historial' ? 'activo' : ''}" data-nav="historial"><span class="icono">📅</span>Historial</button>
      <button class="nav-item" data-nav="salir"><span class="icono">🚪</span>Salir</button>
    </div>`;
  navContainer.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.onclick = () => {
      const destino = btn.dataset.nav;
      if (destino === 'salir') { supabase.auth.signOut(); return; }
      estado.pantalla = destino;
      render();
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
  peso: '', edad: '', metas: ['Hipertrofia'], lesiones: ['Rodilla'], dias: 4, evitarMaquinas: false,
};

function renderOnboarding() {
  app.innerHTML = '';
  app.appendChild(h(`
    <div>
      <h1 class="titulo">Cuéntanos de ti</h1>
      <p class="subtitulo">Esto define tu rutina inicial</p>
      <div class="fila-2col">
        <div><label class="etiqueta">Peso (kg)</label><input type="number" id="p-peso" placeholder="70" value="${perfilForm.peso}" /></div>
        <div><label class="etiqueta">Edad</label><input type="number" id="p-edad" placeholder="28" value="${perfilForm.edad}" /></div>
      </div>
      <label class="etiqueta">Tus metas (hasta ${MAX_METAS})</label>
      <div class="chip-grid" id="p-metas"></div>
      <div id="p-prioridad"></div>
      <label class="etiqueta">¿Alguna lesión o limitación?</label>
      <div class="chip-grid" id="p-lesiones"></div>
      <div class="toggle-fila ${perfilForm.evitarMaquinas ? 'activo' : ''}" id="p-evitar-maquinas">
        <div class="toggle-dot"></div>
        <div class="toggle-texto">
          <strong>Priorizar equipo con más disponibilidad</strong>
          <span>Barra, mancuernas, polea y peso corporal en vez de máquinas — útil en horas pico.</span>
        </div>
      </div>
      <label class="etiqueta">Días disponibles por semana: <span id="p-dias-num">${perfilForm.dias}</span></label>
      <div class="chip-grid" id="p-dias"></div>
      <div id="p-mensaje"></div>
      <button class="boton-primario" id="p-generar">Generar mi rutina</button>
    </div>`));

  const metasDiv = document.getElementById('p-metas');
  const prioridadDiv = document.getElementById('p-prioridad');

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

  const lesionesDiv = document.getElementById('p-lesiones');
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
      renderOnboarding();
    };
  });

  document.getElementById('p-evitar-maquinas').onclick = () => {
    perfilForm.evitarMaquinas = !perfilForm.evitarMaquinas;
    renderOnboarding();
  };

  const diasDiv = document.getElementById('p-dias');
  diasDiv.innerHTML = [1, 2, 3, 4, 5, 6].map((d) => `<button class="chip ${perfilForm.dias === d ? 'activo' : ''}" data-dia="${d}">${d}</button>`).join('');
  diasDiv.querySelectorAll('[data-dia]').forEach((btn) => {
    btn.onclick = () => { perfilForm.dias = Number(btn.dataset.dia); renderOnboarding(); };
  });

  pintarMetas();
  pintarPrioridad();

  document.getElementById('p-generar').onclick = generarRutina;
}

async function generarRutina() {
  const mensajeDiv = document.getElementById('p-mensaje');
  const boton = document.getElementById('p-generar');
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
    const equipoDisponible = ['barra', 'mancuernas', 'polea', 'maquina', 'peso_corporal'];

    const { error: perfilError } = await supabase.from('perfiles').upsert({
      id: user.id,
      peso_kg: parseFloat(peso),
      edad: parseInt(edad, 10),
      nivel: 'intermedio',
      metas: perfilForm.metas,
      lesiones: perfilForm.lesiones,
      dias_disponibles: perfilForm.dias,
      equipo_disponible: equipoDisponible,
      evitar_maquinas: perfilForm.evitarMaquinas,
    });
    if (perfilError) throw new Error(`No se pudo guardar tu perfil: ${perfilError.message}`);

    const { data, error: funcionError } = await supabase.functions.invoke('generate-routine');
    if (funcionError) {
      let detalle = funcionError.message;
      try {
        const cuerpo = await funcionError.context.json();
        detalle = [cuerpo.error, cuerpo.detalle, ...(cuerpo.detalles || [])].filter(Boolean).join(' | ') || detalle;
      } catch (e) {}
      throw new Error(`No se pudo generar la rutina: ${detalle}`);
    }

    mensajeDiv.innerHTML = `<div class="mensaje info">¡Listo! Rutina de ${data.dias.length} días generada y guardada. ${data.rutina.resumen}</div>`;
    await cargarRutina();
  } catch (err) {
    mensajeDiv.innerHTML = `<div class="mensaje error">${err.message}</div>`;
  } finally {
    boton.disabled = false;
    boton.textContent = 'Generar mi rutina';
  }
}

// =========================================================================
// Cargar rutina + estadísticas de días
// =========================================================================
async function cargarRutina() {
  estado.cargandoRutina = true;
  estado.errorRutina = null;
  if (estado.pantalla === 'rutina') render();

  const userId = estado.sesion.user.id;

  const { data: rutina, error: rutinaError } = await supabase
    .from('rutinas').select('id')
    .eq('usuario_id', userId).eq('activa', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (rutinaError) {
    estado.errorRutina = `No se pudo cargar tu rutina: ${rutinaError.message}`;
    estado.cargandoRutina = false;
    if (estado.pantalla === 'rutina') render();
    return;
  }

  if (!rutina) {
    estado.rutinaId = null;
    estado.dias = [];
    estado.cargandoRutina = false;
    if (estado.pantalla === 'rutina') render();
    return;
  }

  estado.rutinaId = rutina.id;

  const { data: ejercicios, error: ejerciciosError } = await supabase
    .from('rutina_ejercicios').select('*, ejercicios(nombre, grupo_muscular)')
    .eq('rutina_id', rutina.id).order('dia').order('orden');

  if (ejerciciosError) {
    estado.errorRutina = `No se pudieron cargar los ejercicios: ${ejerciciosError.message}`;
    estado.cargandoRutina = false;
    if (estado.pantalla === 'rutina') render();
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
  if (estado.pantalla === 'rutina') render();
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
      <div class="vacio">
        <div class="icono-grande">📋</div>
        <p>Aún no tienes rutina.</p>
        <p>Ve a la pestaña Perfil y dale "Generar mi rutina".</p>
      </div>`));
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
      <div id="lista-ejercicios"></div>
    </div>`));
  app.appendChild(cont);

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
    tarjeta.onclick = () => { estado.ejercicioActivo = ej; estado.pantalla = 'registro'; render(); };
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

  document.getElementById('reg-volver').onclick = () => { estado.pantalla = 'rutina'; render(); };

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

  // ---- Progreso / estancamiento ----
  supabase.from('series_registradas')
    .select('peso_kg, sesiones_entrenamiento!inner(fecha)')
    .eq('ejercicio_id', ej.ejercicio_id).not('peso_kg', 'is', null)
    .then(({ data }) => {
      const cont = document.getElementById('reg-progreso');
      if (!cont || !data) return;
      const mejorPorFecha = {};
      for (const s of data) {
        const f = s.sesiones_entrenamiento.fecha;
        if (!mejorPorFecha[f] || s.peso_kg > mejorPorFecha[f]) mejorPorFecha[f] = s.peso_kg;
      }
      const puntos = Object.entries(mejorPorFecha).sort(([a], [b]) => (a < b ? -1 : 1)).map(([, p]) => p);
      const prog = calcularTendencia(puntos);
      if (prog.estado !== 'sin_datos') {
        let extra = '';
        const bajaConsistencia = estado.tasaConsistenciaReciente != null && estado.tasaConsistenciaReciente < 0.7;
        if ((prog.estado === 'estancado' || prog.estado === 'bajando') && bajaConsistencia) {
          const pct = Math.round(estado.tasaConsistenciaReciente * 100);
          extra = `<div style="margin-top:6px;font-weight:400">Además, en tus semanas recientes solo completaste ~${pct}% de tus días planeados — la falta de consistencia probablemente esté contribuyendo a esto, no solo el ejercicio en sí.</div>`;
        }
        cont.innerHTML = `<div class="bloque-progreso ${prog.estado}">${prog.texto}${extra}</div>`;
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
  buscadorDiv.appendChild(h(`
    <button class="boton-secundario" id="alt-mostrar-buscador" style="text-align:left;padding-left:0">+ Agregar un ejercicio que tú conozcas</button>
    <div id="alt-buscador-form" style="display:none">
      <input type="text" id="alt-busqueda-input" placeholder="Nombre del ejercicio (ej. Zancada búlgara)" style="margin-top:8px" />
      <div id="alt-busqueda-resultados"></div>
    </div>`));

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
    .eq('usuario_id', userId).eq('rutina_id', estado.rutinaId).eq('fecha', hoy).eq('dia', ej.dia)
    .maybeSingle();

  let sesionId;
  if (sesionExistente) {
    sesionId = sesionExistente.id;
  } else {
    const { data: nueva, error } = await supabase
      .from('sesiones_entrenamiento')
      .insert({ usuario_id: userId, rutina_id: estado.rutinaId, fecha: hoy, dia: ej.dia })
      .select('id').single();
    if (error) {
      document.getElementById('reg-tabla').innerHTML = `<div class="mensaje error">No se pudo crear la sesión: ${error.message}</div>`;
      return;
    }
    sesionId = nueva.id;
  }

  // Traer lo que YA se guardó hoy para este ejercicio, para no perderlo al salir y volver.
  const { data: seriesGuardadas } = await supabase
    .from('series_registradas').select('numero_serie, peso_kg, repeticiones, rir')
    .eq('sesion_id', sesionId).eq('ejercicio_id', ej.ejercicio_id).order('numero_serie');

  const guardadasPorNumero = {};
  for (const s of seriesGuardadas || []) guardadasPorNumero[s.numero_serie] = s;

  // ---- Sugerencia de peso, basada en tu RIR de la última sesión (no hoy) ----
  const sugerencia = await sugerirProgresion(ej.ejercicio_id, userId, hoy);
  if (sugerencia) {
    const cont = document.getElementById('reg-guia');
    cont.insertAdjacentHTML('beforebegin', `<div class="mensaje info">💡 ${sugerencia.texto}</div>`);
  }

  const numSeries = ej.series || 3;
  pintarTablaSeries(sesionId, ej.ejercicio_id, numSeries, guardadasPorNumero, sugerencia?.peso ?? null);
}

async function sugerirProgresion(ejercicioId, userId, hoyStr) {
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
    const nuevoPeso = Math.round((pesoMax + 2.5) * 2) / 2;
    return { peso: nuevoPeso, texto: `Sugerido: sube a ${nuevoPeso}kg — la última vez te sobró margen (RIR ${rirPromedio.toFixed(1)}).` };
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
    const guardada = guardadasPorNumero[i];
    const valorPeso = guardada?.peso_kg ?? (pesoSugerido != null ? pesoSugerido : '');
    const fila = h(`
      <div class="fila-serie">
        <span class="num">${i}</span>
        <input type="number" id="peso-${i}" value="${valorPeso}" ${guardada ? 'disabled' : ''} />
        <input type="number" id="reps-${i}" value="${guardada?.repeticiones ?? ''}" ${guardada ? 'disabled' : ''} />
        <input type="number" id="rir-${i}" value="${guardada?.rir ?? ''}" ${guardada ? 'disabled' : ''} />
        <button class="btn-guardar-serie ${guardada ? 'hecha' : ''}" id="btn-${i}">${guardada ? 'Guardado ✓' : 'Guardar'}</button>
      </div>`);
    filasDiv.appendChild(fila);

    if (!guardada) {
      document.getElementById(`btn-${i}`).onclick = async () => {
        const btn = document.getElementById(`btn-${i}`);
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner"></div>';

        const peso = document.getElementById(`peso-${i}`).value;
        const reps = document.getElementById(`reps-${i}`).value;
        const rir = document.getElementById(`rir-${i}`).value;

        const { error } = await supabase.from('series_registradas').insert({
          sesion_id: sesionId,
          ejercicio_id: ejercicioId,
          numero_serie: i,
          peso_kg: peso ? parseFloat(peso) : null,
          repeticiones: reps ? parseInt(reps, 10) : null,
          rir: rir ? parseInt(rir, 10) : null,
        });

        if (error) {
          document.getElementById('reg-mensaje').innerHTML = `<div class="mensaje error">No se pudo guardar la serie: ${error.message}</div>`;
          btn.disabled = false;
          btn.textContent = 'Guardar';
          return;
        }

        btn.classList.add('hecha');
        btn.textContent = 'Guardado ✓';
        document.getElementById(`peso-${i}`).disabled = true;
        document.getElementById(`reps-${i}`).disabled = true;
        document.getElementById(`rir-${i}`).disabled = true;

        if (i < numSeries) iniciarDescanso(90);
      };
    }
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

function calcularTendencia(puntos) {
  if (puntos.length < 2) return { estado: 'sin_datos', texto: '' };
  const ultimo = puntos[puntos.length - 1];
  const anterior = puntos[puntos.length - 2];
  if (ultimo > anterior) return { estado: 'progresando', texto: `📈 Progresando: subiste de ${anterior}kg a ${ultimo}kg.` };
  if (ultimo < anterior) return { estado: 'bajando', texto: `📉 Bajaste de ${anterior}kg a ${ultimo}kg respecto a tu sesión anterior.` };
  const ultimosN = puntos.slice(-3);
  const estancado = ultimosN.length === 3 && ultimosN.every((p) => p === ultimosN[0]);
  if (estancado) return { estado: 'estancado', texto: `⏸ Estancado en ${ultimo}kg las últimas ${ultimosN.length} sesiones — considera subir peso o reps.` };
  return { estado: 'igual', texto: `Mismo peso que tu sesión anterior (${ultimo}kg).` };
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

  await cargarRutina();
  estado.pantalla = 'rutina';
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
  cargarRutina(); // refresca en segundo plano la lista de "Rutina"
  renderRegistro(); // repinta esta pantalla con la nueva alternativa ya incluida
}

// =========================================================================
// Historial
// =========================================================================
async function renderHistorial() {
  app.innerHTML = '<div class="pantalla-carga"><div class="spinner"></div></div>';

  const userId = estado.sesion.user.id;
  const { data: sesiones, error } = await supabase
    .from('sesiones_entrenamiento').select('id, fecha, dia')
    .eq('usuario_id', userId).order('fecha', { ascending: false }).limit(30);

  if (error) { app.innerHTML = `<div class="mensaje error">${error.message}</div>`; return; }
  if (!sesiones || sesiones.length === 0) {
    app.innerHTML = `<div class="vacio"><div class="icono-grande">📅</div><p>Todavía no tienes sesiones registradas.</p></div>`;
    return;
  }

  app.innerHTML = '<h1 class="titulo">Historial</h1><p class="subtitulo">Tus últimas sesiones</p><div id="hist-lista"></div>';
  const lista = document.getElementById('hist-lista');

  for (const s of sesiones) {
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
        <div class="fecha">${s.fecha} — Día ${s.dia ?? '?'}</div>
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
  { valor: 'escalada', etiqueta: 'Escalada', icono: '🧗' },
  { valor: 'otro', etiqueta: 'Otro', icono: '➕' },
];
let tipoExtraActivo = 'cardio';

function esTipoEstructurado(tipo) {
  return tipo === 'abdominales' || tipo === 'escalada';
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
iniciar();
