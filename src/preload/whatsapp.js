'use strict';
// Preload das views do WhatsApp (mundo isolado; a página não enxerga nada daqui). Faz duas coisas:
// 1. Envolve window.Notification no mundo da página para (a) avisar o processo principal quando a
//    notificação é clicada — a janela vem para frente já na conta certa — e (b) silenciar a conta:
//    as notificações viram objetos inertes, sem o WhatsApp perceber (ele continua achando que tem
//    permissão, então não mostra o aviso "ative as notificações").
// 2. A comunicação página → preload sai por um evento DOM; não há ponte exposta no window.
const { ipcRenderer, webFrame } = require('electron');

const PATCH = `(() => {
  if (window.__palettePatched) return;
  window.__palettePatched = true;
  const Native = window.Notification;
  if (typeof Native !== 'function') return;
  const inert = (title) => ({
    title, close() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    onclick: null, onclose: null, onerror: null, onshow: null,
  });
  function PaletteNotification(title, options) {
    if (window.__paletteMuted) return inert(title);
    const notification = new Native(title, options);
    notification.addEventListener('click', () => document.dispatchEvent(new CustomEvent('palette:notification-click')));
    return notification;
  }
  PaletteNotification.prototype = Native.prototype;
  Object.defineProperty(PaletteNotification, 'permission', { get: () => Native.permission });
  Object.defineProperty(PaletteNotification, 'maxActions', { get: () => Native.maxActions });
  PaletteNotification.requestPermission = (...args) => Native.requestPermission(...args);
  window.Notification = PaletteNotification;
})();`;

webFrame.executeJavaScript(PATCH).catch(() => {});

document.addEventListener('palette:notification-click', () => ipcRenderer.send('wa:notification-click'));

ipcRenderer.on('wa:muted', (_event, muted) => {
  webFrame.executeJavaScript(`window.__paletteMuted = ${muted ? 'true' : 'false'};`).catch(() => {});
});
