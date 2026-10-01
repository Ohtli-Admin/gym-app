// DOM rendering for the GymApp 2.0 on-demand session builder and the
// active workout. The ONLY file in src/today-experience that touches
// `document`. It never runs domain rules itself: generation and the
// prepared/active lifecycle live in session-builder.mjs (DOM-free, tested),
// the workout state machine in workout-session.mjs, and storage in
// session-slots.mjs. See README.md for how app.js wires this in.
import { runTodayOrchestration } from './orchestrator.mjs';
import { loadLibraryProvider, LibrarySnapshotError } from '../exercise-library/provider.mjs';
import {
  generatePreparedSession,
  getBuilderState,
  preparedViewModel,
  regenerateWarning,
  startPreparedSession,
  startWarning,
} from './session-builder.mjs';
import { buildPhysicalContextMessages } from './physical-context.mjs';
import {
  TIME_OPTIONS_MINUTES,
  ENVIRONMENT_OPTIONS,
  MODALITY_OPTIONS,
  LEVEL_OPTIONS,
  EQUIPMENT_OPTIONS,
  TODAY_DEFAULT_TRAINING_GOAL,
  defaultTodayUiState,
  buildTodayViewModel,
  buildActiveSessionViewModel,
  buildSessionSummaryViewModel,
} from './today-view-model.mjs';
import {
  createSessionFromPlan,
  logSet,
  completeExercise,
  goToExercise,
  finishSession,
  buildSessionSummary,
  getActiveSession,
  setActiveSession,
  getSessionSlots,
} from './workout-session.mjs';

const MODALITY_ICONS = { gym: '💪', calisthenics: '🤸', cardio: '🏃', core: '🧘' };
const TONE_TO_MENSAJE_CLASS = { success: 'info', warning: 'warning', danger: 'error' };
const GOAL_LABELS = { general_fitness: 'Acondicionamiento general' };
const DEFAULT_GOAL_LABEL = GOAL_LABELS[TODAY_DEFAULT_TRAINING_GOAL] ?? TODAY_DEFAULT_TRAINING_GOAL;

// Exercise names and user-authored text are external/free text, so they
// are escaped before being placed into innerHTML templates.
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function iconForExercise(item) {
  return MODALITY_ICONS[item.modality] ?? '🏋️';
}

function renderChipGroup(target, options, selected, { multi }) {
  if (!target) return; // e.g. the modalities group is omitted when locked
  target.innerHTML = options
    .map(({ value, label }) => {
      const isSelected = multi ? selected.includes(value) : selected === value;
      return `<button type="button" class="chip ${isSelected ? 'activo' : ''}" data-value="${value}">${label}</button>`;
    })
    .join('');
}

// Entry point. `screen`: 'home' shows the session builder; 'active' shows
// the in-progress session, the last finished session's summary, or an
// empty state. `navigate(pantalla)` asks app.js to switch screens (app.js
// owns routing). `lockedModalities`/`title`/`subtitle` let one builder
// serve Calistenia and Entrenamiento especial → independiente.
// `showDevControls` reveals the demo-only restriction toggle (?dev=1).
//
// `catalogSource: 'exercise_library'` (what app.js always uses) generates
// from the Gym-Exercise-Library snapshot and persists the result as the
// prepared session for `origin` ('calistenia' | 'especial'); remounting
// restores it instead of regenerating. `getPhysicalContextInputs()` returns
// { legacyChips, profileText, sessionText } and is read only when the user
// presses Generar (see physical-context.mjs). The default 'demo' source is
// kept only for tests and is not persisted.
export function mount(
  container,
  {
    screen = 'home',
    navigate = () => {},
    lockedModalities = null,
    title = 'Hoy',
    subtitle = '¿Qué entrenamos hoy?',
    showDevControls = false,
    catalogSource = 'demo',
    origin = 'calistenia',
    getPhysicalContextInputs = () => ({}),
  } = {},
) {
  if (screen === 'active') {
    renderActiveScreen(container, navigate);
  } else {
    renderHomeScreen(container, navigate, {
      lockedModalities,
      title,
      subtitle,
      showDevControls,
      catalogSource,
      origin,
      getPhysicalContextInputs,
    });
  }
}

// Loaded once per page and reused; a failed load is not cached so a
// re-sync followed by another click works without a reload.
let libraryProviderPromise = null;
function getLibraryProvider() {
  if (!libraryProviderPromise) {
    libraryProviderPromise = loadLibraryProvider().catch((error) => {
      libraryProviderPromise = null;
      throw error;
    });
  }
  return libraryProviderPromise;
}

// =========================================================================
// Home: session builder + prepared routine
// =========================================================================
function renderHomeScreen(
  container,
  navigate,
  { lockedModalities, title, subtitle, showDevControls, catalogSource, origin, getPhysicalContextInputs },
) {
  const persistent = catalogSource === 'exercise_library';
  const slots = getSessionSlots();
  const uiState = defaultTodayUiState();
  // Restore the form from the prepared routine (never regenerate it).
  const restored = persistent ? getBuilderState(slots, origin).prepared : null;
  if (restored) Object.assign(uiState, structuredClone(restored.request));
  if (lockedModalities) {
    uiState.modalities = [...lockedModalities];
  }
  // Tracked outside renderForm() so re-rendering after a chip click (the
  // whole form is rebuilt from a template string) doesn't collapse a
  // <details> the user just opened.
  let advancedOpen = false;
  let demoOpen = false;
  // Demo-only (tests / non-persistent path): last in-memory result.
  let demoResult = null;

  function renderForm() {
    const state = persistent ? getBuilderState(slots, origin) : { prepared: null, otherPrepared: null };
    // `title: null` lets the host screen render its own header above this
    // form (app.js's Entrenamiento especial puts the user's request first).
    container.innerHTML = `
      ${title ? `<header class="g2-appbar"><h1>${title}</h1><p>${subtitle}</p></header>` : ''}

      <div id="today-resume"></div>

      <section class="g2-card">
        <label class="etiqueta">Tiempo disponible</label>
        <div class="chip-grid" data-group="time"></div>

        <label class="etiqueta">Entorno</label>
        <div class="chip-grid" data-group="environment"></div>

        ${
          lockedModalities
            ? ''
            : `<label class="etiqueta">Modalidades</label>
        <div class="chip-grid" data-group="modalities"></div>`
        }

        <details class="g2-disclosure" ${advancedOpen ? 'open' : ''}>
          <summary>Opciones avanzadas</summary>
          <label class="etiqueta">Nivel de experiencia</label>
          <div class="chip-grid" data-group="level"></div>
          <label class="etiqueta">Equipo disponible</label>
          <div class="chip-grid" data-group="equipment"></div>
          <div class="toggle-fila ${uiState.allowConditional ? 'activo' : ''}" data-toggle="allowConditional">
            <div class="toggle-dot"></div>
            <div class="toggle-texto">
              <strong>Incluir ejercicios "con precaución" si hace falta</strong>
              <span>Solo se usan cuando no alcanzan los ejercicios totalmente compatibles.</span>
            </div>
          </div>
        </details>

        ${showDevControls ? `<details class="g2-disclosure g2-disclosure-demo" ${demoOpen ? 'open' : ''}>
          <summary>Modo demo / desarrollo</summary>
          <div class="toggle-fila ${uiState.demoShoulderRestriction ? 'activo' : ''}" data-toggle="demoShoulderRestriction">
            <div class="toggle-dot"></div>
            <div class="toggle-texto">
              <strong>DEMO: restricción de hombro</strong>
              <span>Simula una restricción activa (no viene de tu perfil) para ver ejercicios "con precaución".</span>
            </div>
          </div>
        </details>` : ''}

        <p class="subtitulo g2-goal-note">Objetivo de esta vista previa: ${DEFAULT_GOAL_LABEL}.</p>

        <button class="boton-primario g2-cta" data-action="generar">${state.prepared ? 'Regenerar rutina' : 'Generar rutina de hoy'}</button>
      </section>

      <div id="today-result"></div>
    `;

    renderChipGroup(
      container.querySelector('[data-group="time"]'),
      TIME_OPTIONS_MINUTES.map((minutes) => ({ value: minutes, label: `${minutes} min` })),
      uiState.timeAvailableMinutes,
      { multi: false },
    );
    renderChipGroup(container.querySelector('[data-group="environment"]'), ENVIRONMENT_OPTIONS, uiState.environment, {
      multi: false,
    });
    renderChipGroup(container.querySelector('[data-group="modalities"]'), MODALITY_OPTIONS, uiState.modalities, {
      multi: true,
    });
    renderChipGroup(container.querySelector('[data-group="level"]'), LEVEL_OPTIONS, uiState.experienceLevel, {
      multi: false,
    });
    renderChipGroup(container.querySelector('[data-group="equipment"]'), EQUIPMENT_OPTIONS, uiState.equipment, {
      multi: true,
    });

    const bindSingle = (group, key) =>
      container.querySelectorAll(`[data-group="${group}"] [data-value]`).forEach((btn) => {
        btn.onclick = () => {
          uiState[key] = group === 'time' ? Number(btn.dataset.value) : btn.dataset.value;
          renderForm();
        };
      });
    const bindMulti = (group, key) =>
      container.querySelectorAll(`[data-group="${group}"] [data-value]`).forEach((btn) => {
        btn.onclick = () => {
          const value = btn.dataset.value;
          uiState[key] = uiState[key].includes(value) ? uiState[key].filter((v) => v !== value) : [...uiState[key], value];
          renderForm();
        };
      });
    bindSingle('time', 'timeAvailableMinutes');
    bindSingle('environment', 'environment');
    bindMulti('modalities', 'modalities');
    bindSingle('level', 'experienceLevel');
    bindMulti('equipment', 'equipment');

    const [advancedDetails, demoDetails] = container.querySelectorAll('details.g2-disclosure');
    advancedDetails.ontoggle = () => { advancedOpen = advancedDetails.open; };
    if (demoDetails) {
      demoDetails.ontoggle = () => { demoOpen = demoDetails.open; };
      container.querySelector('[data-toggle="demoShoulderRestriction"]').onclick = () => {
        uiState.demoShoulderRestriction = !uiState.demoShoulderRestriction;
        renderForm();
      };
    }
    container.querySelector('[data-toggle="allowConditional"]').onclick = () => {
      uiState.allowConditional = !uiState.allowConditional;
      renderForm();
    };

    const target = container.querySelector('#today-result');
    container.querySelector('[data-action="generar"]').onclick = async () => {
      if (!persistent) {
        demoResult = runTodayOrchestration(uiState);
        renderDemoResult(target, demoResult, navigate);
        return;
      }
      const warning = regenerateWarning(slots);
      if (warning && !window.confirm(warning)) return;

      target.innerHTML = '<div class="mensaje info">Generando…</div>';
      let provider;
      try {
        provider = await getLibraryProvider();
      } catch (error) {
        if (!(error instanceof LibrarySnapshotError)) throw error;
        renderError(target, { ok: false, errorKind: 'catalog_missing', error });
        return;
      }
      const { result } = generatePreparedSession({
        slots,
        origin,
        uiState: structuredClone(uiState),
        provider,
        physicalInputs: getPhysicalContextInputs(),
      });
      if (!result.ok) {
        renderError(target, result);
        return;
      }
      renderForm(); // re-render from the persisted prepared routine
    };

    renderResumeBanner(container.querySelector('#today-resume'), navigate);
    if (state.prepared) renderPrepared(target, state.prepared, slots, navigate);
    else if (state.otherPrepared) renderOtherPreparedNote(target, state.otherPrepared);
    else if (demoResult) renderDemoResult(target, demoResult, navigate);
  }

  renderForm();
}

function renderResumeBanner(target, navigate) {
  if (!getActiveSession()) return;
  target.innerHTML = `
    <div class="mensaje info g2-resume-banner">
      Sesión en curso.
      <button type="button" class="g2-link-btn" data-action="continue">Continuar →</button>
    </div>`;
  target.querySelector('[data-action="continue"]').onclick = () => navigate('entrenar');
}

function renderOtherPreparedNote(target, prepared) {
  const label = prepared.origin === 'especial' ? 'Entrenamiento especial' : 'Calistenia';
  target.innerHTML = `<div class="mensaje info">Tienes una rutina preparada en ${label}. Si generas una aquí, la reemplaza.</div>`;
}

function renderError(target, result) {
  const viewModel = buildTodayViewModel(result);
  target.innerHTML = `
    <div class="mensaje ${TONE_TO_MENSAJE_CLASS[viewModel.tone]}">
      <strong>${viewModel.headline}</strong><br>${escapeHtml(viewModel.message)}
    </div>`;
  if (viewModel.debug) console.error('[Today experience]', viewModel.debug);
}

function planHtml(viewModel) {
  const warningsHtml = viewModel.warnings.length
    ? `<ul class="today-warnings">${viewModel.warnings.map((w) => `<li>${w}</li>`).join('')}</ul>`
    : '';

  const exercisesHtml = viewModel.exercises.length
    ? viewModel.exercises
        .map(
          (item) => `
        <div class="g2-exercise-row">
          <div class="g2-exercise-icon">${iconForExercise(item)}</div>
          <div class="g2-exercise-info">
            <div class="g2-exercise-name">${item.order}. ${escapeHtml(item.name)}</div>
            <div class="g2-exercise-meta">${item.modalityLabel} · ${item.prescriptionText} · ~${item.estimatedDurationMinutes} min</div>
            ${
              item.isConditional
                ? `<span class="etiqueta-precaucion">Con precaución</span>`
                : ''
            }
          </div>
        </div>`,
        )
        .join('')
    : '<div class="vacio"><div class="icono-grande">🧐</div>No hay ejercicios en el plan.</div>';

  return `
    <div class="mensaje ${TONE_TO_MENSAJE_CLASS[viewModel.tone]}"><strong>${viewModel.headline}</strong></div>
    <div class="today-resumen">
      <div class="item"><span class="num">${viewModel.estimatedDurationMinutes}</span><span class="txt">min estimados</span></div>
      <div class="item"><span class="num">${viewModel.requestedDurationMinutes}</span><span class="txt">min solicitados</span></div>
      <div class="item"><span class="num">${viewModel.exercises.length}</span><span class="txt">ejercicios</span></div>
    </div>
    <p class="subtitulo">Modalidades cubiertas: ${viewModel.modalitiesCovered.join(', ') || 'ninguna'}</p>
    ${viewModel.sourceNote ? `<p class="subtitulo g2-nota">${viewModel.sourceNote}</p>` : ''}
    ${warningsHtml}
    ${exercisesHtml}`;
}

// The persisted prepared routine: exactly what was generated.
function renderPrepared(target, prepared, slots, navigate) {
  const viewModel = preparedViewModel(prepared);
  const messages = buildPhysicalContextMessages(prepared.physicalContext);
  target.innerHTML = `
    <p class="subtitulo g2-nota">Rutina preparada · variante ${prepared.seed.attempt + 1} del ${prepared.seed.date}</p>
    ${messages.length ? `<div class="mensaje warning">${messages.map((m) => `<p>${escapeHtml(m)}</p>`).join('')}</div>` : ''}
    ${planHtml(viewModel)}
    ${
      viewModel.exercises.length
        ? '<button type="button" class="boton-primario g2-cta" data-action="start" style="margin-top:16px">Empezar entrenamiento</button>'
        : ''
    }`;

  const startBtn = target.querySelector('[data-action="start"]');
  if (startBtn) {
    startBtn.onclick = () => {
      const warning = startWarning(slots);
      if (warning && !window.confirm(warning)) return;
      startPreparedSession(slots);
      navigate('entrenar');
    };
  }
}

// Non-persistent demo path (tests only; no app.js screen uses it).
function renderDemoResult(target, result, navigate) {
  if (!result.ok) {
    renderError(target, result);
    return;
  }
  const viewModel = buildTodayViewModel(result);
  target.innerHTML = `${planHtml(viewModel)}
    ${viewModel.exercises.length ? '<button type="button" class="boton-primario g2-cta" data-action="start" style="margin-top:16px">Empezar entrenamiento</button>' : ''}`;
  const startBtn = target.querySelector('[data-action="start"]');
  if (startBtn) {
    startBtn.onclick = () => {
      setActiveSession(createSessionFromPlan(result.plan));
      navigate('entrenar');
    };
  }
}

// =========================================================================
// Active workout (Entrenar)
// =========================================================================
function renderActiveScreen(container, navigate) {
  const session = getActiveSession();

  if (!session) {
    const lastCompleted = getSessionSlots().getLastCompleted();
    if (lastCompleted) {
      renderSummaryScreen(container, lastCompleted, navigate);
      return;
    }
    container.innerHTML = `
      <div class="vacio">
        <div class="icono-grande">🏋️</div>
        <p>No tienes un entrenamiento en curso.</p>
        <button type="button" class="boton-primario g2-cta" data-action="go-home" style="margin-top:16px">Ir a Entrenamiento</button>
      </div>`;
    container.querySelector('[data-action="go-home"]').onclick = () => navigate('entrenamiento');
    return;
  }

  renderActiveWorkout(container, session, navigate);
}

function renderActiveWorkout(container, session, navigate) {
  const vm = buildActiveSessionViewModel(session);
  const progressPct = Math.round((vm.currentIndex / vm.totalExercises) * 100);

  const loggerHtml =
    vm.current.prescriptionType === 'sets_reps'
      ? `
      <div class="g2-set-logger">
        ${vm.current.loggedSets
          .map((s) => `<div class="g2-set-row-done">Serie ${s.setNumber}: ${s.reps ?? '—'} reps${s.weight ? ` · ${s.weight} kg` : ''}</div>`)
          .join('')}
        <div class="g2-set-input-row">
          <input type="number" inputmode="numeric" id="log-reps" placeholder="Reps" />
          <input type="number" inputmode="decimal" id="log-weight" placeholder="Peso kg (opcional)" />
          <button type="button" class="g2-btn-log" data-action="log-set">Marcar serie</button>
        </div>
      </div>`
      : `<button type="button" class="g2-btn-log g2-btn-log-wide" data-action="log-duration" ${vm.current.completed ? 'disabled' : ''}>${vm.current.completed ? 'Completado ✓' : 'Marcar como completado'}</button>`;

  container.innerHTML = `
    <div class="g2-session-header">
      <button type="button" class="g2-icon-btn" data-action="exit" aria-label="Volver a Entrenamiento">←</button>
      <span class="g2-progress-label">Ejercicio ${vm.currentIndex + 1} de ${vm.totalExercises}</span>
    </div>
    <div class="g2-progress-track"><div class="g2-progress-fill" style="width:${progressPct}%"></div></div>

    <div class="g2-current-exercise">
      <div class="g2-modality-tag">${vm.current.modalityLabel}</div>
      <h1>${escapeHtml(vm.current.name)}</h1>
      <p class="g2-prescription">${vm.current.prescriptionText}</p>
      ${
        vm.current.isConditional
          ? `<div class="g2-caution"><span class="etiqueta-precaucion">Con precaución</span>${vm.current.cautionMessages
              .map((m) => `<p>${m}</p>`)
              .join('')}</div>`
          : ''
      }
    </div>

    ${loggerHtml}

    <div class="g2-session-controls">
      <button type="button" class="g2-btn-secondary" data-action="prev" ${vm.isFirst ? 'disabled' : ''}>‹ Anterior</button>
      <button type="button" class="g2-btn-secondary" data-action="complete">Completar ejercicio</button>
      <button type="button" class="g2-btn-secondary" data-action="next" ${vm.isLast ? 'disabled' : ''}>Siguiente ›</button>
    </div>

    <button type="button" class="boton-primario g2-cta" data-action="finish">Finalizar entrenamiento</button>

    <div class="g2-exercise-list">
      ${vm.exerciseList
        .map(
          (e) =>
            `<button type="button" class="g2-mini-item ${e.isCurrent ? 'activo' : ''} ${e.completed ? 'hecho' : ''}" data-goto="${e.index}">${e.index + 1}. ${escapeHtml(e.name)}${e.completed ? ' ✓' : ''}</button>`,
        )
        .join('')}
    </div>
  `;

  const rerender = () => renderActiveWorkout(container, session, navigate);

  container.querySelector('[data-action="exit"]').onclick = () => navigate('entrenamiento');
  container.querySelector('[data-action="prev"]').onclick = () => {
    setActiveSession(goToExercise(session, session.currentIndex - 1));
    rerender();
  };
  container.querySelector('[data-action="next"]').onclick = () => {
    setActiveSession(goToExercise(session, session.currentIndex + 1));
    rerender();
  };
  container.querySelector('[data-action="complete"]').onclick = () => {
    setActiveSession(completeExercise(session, session.currentIndex));
    rerender();
  };
  container.querySelector('[data-action="finish"]').onclick = () => {
    setActiveSession(finishSession(session));
    renderActiveScreen(container, navigate);
  };
  container.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.onclick = () => {
      setActiveSession(goToExercise(session, Number(btn.dataset.goto)));
      rerender();
    };
  });

  const logSetBtn = container.querySelector('[data-action="log-set"]');
  if (logSetBtn) {
    logSetBtn.onclick = () => {
      const reps = container.querySelector('#log-reps').value;
      const weight = container.querySelector('#log-weight').value;
      setActiveSession(
        logSet(session, session.currentIndex, {
          reps: reps === '' ? null : Number(reps),
          weight: weight === '' ? null : Number(weight),
        }),
      );
      rerender();
    };
  }
  const logDurationBtn = container.querySelector('[data-action="log-duration"]');
  if (logDurationBtn) {
    logDurationBtn.onclick = () => {
      setActiveSession(completeExercise(session, session.currentIndex));
      rerender();
    };
  }
}

function renderSummaryScreen(container, session, navigate) {
  const summary = buildSessionSummary(session);
  const vm = buildSessionSummaryViewModel(summary);

  container.innerHTML = `
    <div class="g2-summary">
      <div class="g2-summary-icon">${vm.completedExercises === vm.totalExercises ? '✓' : '•'}</div>
      <h1 class="titulo">${vm.headline}</h1>
      <div class="today-resumen">
        <div class="item"><span class="num">${vm.completedExercises}/${vm.totalExercises}</span><span class="txt">ejercicios</span></div>
        <div class="item"><span class="num">${vm.totalSets}</span><span class="txt">series</span></div>
        <div class="item"><span class="num">${vm.durationMinutes ?? '—'}</span><span class="txt">min</span></div>
      </div>
      <button type="button" class="boton-primario g2-cta" data-action="done">Volver a Entrenamiento</button>
    </div>`;

  container.querySelector('[data-action="done"]').onclick = () => {
    getSessionSlots().dismissLastCompleted();
    navigate('entrenamiento');
  };
}
