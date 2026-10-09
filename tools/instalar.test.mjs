import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { estadoInstalacion } = require('../instalar.js');

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

test('ya abierta como app: no se ofrece instalar', () => {
  assert.equal(estadoInstalacion({ standalone: true, hayPrompt: true, userAgent: ANDROID }), 'instalada');
  assert.equal(estadoInstalacion({ standalone: true, hayPrompt: false, userAgent: IPHONE }), 'instalada');
});

test('el navegador ofreció instalar: botón de un toque', () => {
  assert.equal(estadoInstalacion({ standalone: false, hayPrompt: true, userAgent: ANDROID }), 'disponible');
});

test('Safari en iPhone y iPad: instrucciones manuales', () => {
  assert.equal(estadoInstalacion({ standalone: false, hayPrompt: false, userAgent: IPHONE }), 'ios');
  assert.equal(estadoInstalacion({ standalone: false, hayPrompt: false, userAgent: IPAD, maxTouchPoints: 5 }), 'ios');
});

test('Mac de escritorio o navegador sin soporte: no se muestra nada', () => {
  assert.equal(estadoInstalacion({ standalone: false, hayPrompt: false, userAgent: IPAD, maxTouchPoints: 0 }), 'no-disponible');
  assert.equal(estadoInstalacion({ standalone: false, hayPrompt: false, userAgent: ANDROID }), 'no-disponible');
});
