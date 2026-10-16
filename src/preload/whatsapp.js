'use strict';
// Preload das views do WhatsApp (mundo isolado; a página não enxerga nada daqui). Faz três coisas:
// 1. Envolve window.Notification no mundo da página para (a) avisar o processo principal quando a
//    notificação é clicada — a janela vem para frente já na conta certa — e (b) silenciar a conta:
//    as notificações viram objetos inertes, sem o WhatsApp perceber (ele continua achando que tem
//    permissão, então não mostra o aviso "ative as notificações").
// 2. Detecta chamada recebida: o aviso que o WhatsApp Web desenha ("Chamada de voz recebida" +
//    Aceitar/Recusar — pt, en, es) via MutationObserver, ou uma notificação com esse texto. Avisa o
//    processo principal (wa:incoming-call / wa:call-ended), que marca a conta e troca para ela.
// 3. A comunicação página → preload sai por eventos DOM e atributos; não há ponte exposta no window.
const { ipcRenderer, webFrame } = require('electron');

const CALL_RE = /(chamada|llamada|videollamada)[^.]{0,40}(recebida|entrante)|incoming[^.]{0,30}call|is calling|est[áa] (te )?(ligando|chamando)/i;
const ANSWER_RE = /aceitar|atender|recusar|accept|answer|decline|reject|aceptar|contestar|rechazar/i;

const PATCH = `(() => {
  if (window.__palettePatched) return;
  window.__palettePatched = true;
  const Native = window.Notification;
  if (typeof Native !== 'function') return;
  const CALL_RE = ${CALL_RE.toString()};
  const inert = (title) => ({
    title, close() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    onclick: null, onclose: null, onerror: null, onshow: null,
  });
  const signalCall = (text) => {
    document.documentElement.dataset.paletteCall = String(text || '').slice(0, 120);
    document.dispatchEvent(new CustomEvent('palette:incoming-call'));
  };
  function PaletteNotification(title, options) {
    const text = [title, options && options.body].filter(Boolean).join(' — ');
    if (CALL_RE.test(text)) signalCall(text);
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

// ---------- chamada recebida ----------
let ringing = null; // { node?: Element, timer, timeout }

function stopRinging() {
  if (!ringing) return;
  clearInterval(ringing.timer);
  clearTimeout(ringing.timeout);
  ringing = null;
  ipcRenderer.send('wa:call-ended');
}

function startRinging(node, text) {
  if (ringing) return;
  ringing = { node };
  ipcRenderer.send('wa:incoming-call', String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120));
  // Termina quando o aviso some da tela (atendida, recusada ou perdida); sem nó (notificação), em 45 s
  ringing.timer = setInterval(() => {
    if (node && (!node.isConnected || !CALL_RE.test(node.textContent || ''))) stopRinging();
  }, 1500);
  ringing.timeout = setTimeout(stopRinging, node ? 90000 : 45000);
}

// Nó com mais de 80 elementos não é o aviso de chamada: descarta sem montar o texto (custo constante)
function smallEnough(node) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
  let count = 0;
  while (walker.nextNode()) if (++count > 80) return false;
  return true;
}

const describe = (node) => {
  const labels = Array.from(node.querySelectorAll('[aria-label]'), (el) => el.getAttribute('aria-label')).join(' ');
  return `${node.textContent || ''} ${labels}`;
};

const observer = new MutationObserver((mutations) => {
  if (ringing) return;
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1 || !smallEnough(node)) continue;
      const text = describe(node);
      if (text.length > 600 || !CALL_RE.test(text) || !ANSWER_RE.test(text)) continue;
      startRinging(node, (node.textContent || '').trim());
      return;
    }
  }
});

document.addEventListener('palette:incoming-call', () => {
  if (ringing) return;
  startRinging(null, document.documentElement.dataset.paletteCall || 'Chamada recebida');
});

window.addEventListener('DOMContentLoaded', () => observer.observe(document.body, { childList: true, subtree: true }));
