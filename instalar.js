// Instalar GymApp como app (PWA) — script clásico, cargado ANTES de app.js.
//
// Chrome/Edge/Android disparan `beforeinstallprompt` una sola vez y muy
// pronto; si nadie lo guarda en ese momento, ya no se puede ofrecer el
// botón "Instalar". Por eso este archivo se carga antes que app.js y solo
// guarda el evento; app.js decide dónde y cuándo mostrar el botón.
// Safari en iPhone/iPad no tiene ese evento: ahí solo se puede explicar
// "Compartir → Agregar a inicio".
//
// También se exporta con module.exports para probar `estadoInstalacion`
// en Node (tools/instalar.test.mjs).
(function (global) {
  // 'instalada'     ya se abrió como app (no mostrar nada)
  // 'disponible'    el navegador ofrece instalar con un toque
  // 'ios'           Safari en iOS: instalar a mano desde Compartir
  // 'no-disponible' el navegador no permite instalar (o aún no lo ofrece)
  function estadoInstalacion({ standalone, hayPrompt, userAgent, maxTouchPoints }) {
    if (standalone) return 'instalada';
    if (hayPrompt) return 'disponible';
    const ua = userAgent || '';
    // iPadOS se presenta como "Macintosh", pero con pantalla táctil.
    const esIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (maxTouchPoints || 0) > 1);
    if (esIOS) return 'ios';
    return 'no-disponible';
  }

  const instalacion = {
    estadoInstalacion,
    _prompt: null,
    _oyentes: [],
    estado() {
      const nav = global.navigator || {};
      const standalone = Boolean(
        nav.standalone
        || (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches),
      );
      return estadoInstalacion({
        standalone,
        hayPrompt: Boolean(this._prompt),
        userAgent: nav.userAgent,
        maxTouchPoints: nav.maxTouchPoints,
      });
    },
    // Avisa cuando cambia lo que se puede ofrecer (llega el evento o se
    // instaló), para que la pantalla repinte solo el bloque de instalar.
    alCambiar(fn) { this._oyentes.push(fn); },
    _avisar() { this._oyentes.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); },
    // Abre el diálogo nativo. El evento solo se puede usar una vez; si el
    // usuario lo cancela, el navegador puede volver a dispararlo después.
    async instalar() {
      const evt = this._prompt;
      if (!evt) return 'no-disponible';
      this._prompt = null;
      evt.prompt();
      const { outcome } = await evt.userChoice;
      this._avisar();
      return outcome; // 'accepted' | 'dismissed'
    },
  };

  if (global.addEventListener) {
    global.addEventListener('beforeinstallprompt', (evt) => {
      evt.preventDefault(); // sin la mini-barra automática: usamos nuestro botón
      instalacion._prompt = evt;
      instalacion._avisar();
    });
    global.addEventListener('appinstalled', () => {
      instalacion._prompt = null;
      instalacion._avisar();
    });
  }

  global.instalacionApp = instalacion;
  if (typeof module !== 'undefined' && module.exports) module.exports = instalacion;
})(typeof window !== 'undefined' ? window : globalThis);
