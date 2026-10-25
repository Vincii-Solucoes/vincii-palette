'use strict';
// Preload das views do WhatsApp (mundo isolado; a página não enxerga nada daqui). Faz três coisas:
// 1. Envolve window.Notification no mundo da página para (a) avisar o processo principal quando a
//    notificação é clicada — a janela vem para frente já na conta certa — e (b) silenciar a conta:
//    as notificações viram objetos inertes, sem o WhatsApp perceber (ele continua achando que tem
//    permissão, então não mostra o aviso "ative as notificações").
// 2. Detecta ligação recebida por um poll de 1 s (callSnapshot): botão [data-testid=voip-accept-call-button] do
//    mini player, título da aba "Ligação de voz/vídeo recebida de X" (CALL_RE) — a Notification da página só dá o
//    nome. Avisa o main (wa:incoming-call / wa:call-ended após 3 s sem sinal), que marca a conta, mostra a
//    janelinha e, opcionalmente, troca para ela; atender/recusar (wa:call-action) clica o botão do WhatsApp.
// 3. A comunicação página → preload sai por eventos DOM e atributos; não há ponte exposta no window.
const { ipcRenderer, webFrame } = require('electron');

// pt-BR do WhatsApp Web: "Ligação de voz recebida (de X)" (título da aba, Notification e mini player); "chamada" fica por garantia
const CALL_RE = /(liga[çc][ãa]o|chamada|llamada|videollamada)[^.]{0,40}?(recebida|entrante)|incoming[^.]{0,30}?call|is calling|est[áa] (te )?(ligando|chamando)/i;
// Corpo da Notification de chamada do WhatsApp ("📞 Ligação de voz recebida", "Ligação de vídeo recebida de X" em grupo)
const CALL_BODY_RE = /^\W*((liga[çc][ãa]o|chamada) de (voz|v[ií]deo) recebida|incoming (voice|video) call|(video)?llamada( de (voz|video))? entrante)\b/i;

const STRIP_FSA = process.platform === 'linux';
const PATCH = `(() => {
  if (window.__palettePatched) return;
  window.__palettePatched = true;
  if (${STRIP_FSA}) for (const k of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) { try { delete window[k]; if (k in window) Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true }); } catch {} }
  const Native = window.Notification;
  // Conta em segundo plano (não selecionada ou com diálogo aberto): a página se vê como aba em segundo plano — sem
  // foco e oculta — para o WhatsApp notificar e não marcar como lidas mensagens que ninguém viu. Conta na tela com a
  // janela do Palette em foco: a página se vê focada mesmo com o foco real na barra lateral (sem notificar o que o
  // usuário está olhando). Fora disso, vale o foco real.
  let background = false;
  let foreground = false;
  const nativeHasFocus = Document.prototype.hasFocus;
  const hiddenGet = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden').get;
  const visibilityGet = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState').get;
  Object.defineProperty(Document.prototype, 'hasFocus', { configurable: true, writable: true, value: function hasFocus() { return background ? false : foreground ? true : nativeHasFocus.call(this); } });
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get() { return background ? true : hiddenGet.call(this); } });
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return background ? 'hidden' : visibilityGet.call(this); } });
  window.__paletteSetBackground = (value, focused) => {
    value = !!value;
    focused = !value && !!focused;
    const wasBackground = background;
    const wasForeground = foreground;
    background = value;
    foreground = focused;
    if (value !== wasBackground) document.dispatchEvent(new Event('visibilitychange'));
    if (value && !wasBackground) window.dispatchEvent(new Event('blur'));
    else if (focused && !wasForeground) window.dispatchEvent(new Event('focus'));
    else if (!focused && wasForeground && !value) window.dispatchEvent(new Event('blur'));
  };
  if (typeof Native !== 'function') return;
  const CALL_BODY_RE = ${CALL_BODY_RE.toString()};
  const inert = (title) => ({
    title, close() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    onclick: null, onclose: null, onerror: null, onshow: null,
  });
  const signalCall = (text) => {
    document.documentElement.dataset.paletteCall = String(text || '').slice(0, 120);
    document.dispatchEvent(new CustomEvent('palette:incoming-call'));
  };
  function PaletteNotification(title, options) {
    const body = String((options && options.body) || '');
    if (CALL_BODY_RE.test(body)) signalCall(title); // só o corpo no formato do WhatsApp conta; o título é o nome do contato
    if (window.__paletteMuted) return inert(title);
    const account = window.__paletteAccountName;
    const shownTitle = account && !String(title).endsWith(' · ' + account) ? String(title) + ' · ' + account : title;
    document.documentElement.dataset.paletteNotified = JSON.stringify({ background, foreground });
    document.dispatchEvent(new CustomEvent('palette:notified'));
    const notification = new Native(shownTitle, options);
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
ipcRenderer.on('wa:background', (_event, background, focused, name) => {
  webFrame.executeJavaScript(`window.__paletteAccountName = ${JSON.stringify(String(name || ''))}; window.__paletteSetBackground && window.__paletteSetBackground(${background ? 'true' : 'false'}, ${focused ? 'true' : 'false'});`).catch(() => {});
});
document.addEventListener('palette:notified', () => ipcRenderer.send('wa:notified', document.documentElement.dataset.paletteNotified || ''));


// ---------- chamada recebida ----------
// Fonte da verdade é a UI do próprio WhatsApp Web (lida nos bundles em 25/10/2026): o mini player da chamada recebida
// nasce DENTRO da página com data-testid estáveis (voip-accept-call-button, voip-reject-call-button,
// voip-call-header-name, voip-call-participant-info-call-state-text), o título da aba alterna a cada 2 s com
// "Ligação de voz recebida de X" enquanto toca, e sai uma Notification "X — Ligação de voz recebida" (quando passa
// por window.Notification). Um poll leve de 1 s decide começo e fim do toque; nada de heurística de MutationObserver.
const ACCEPT_SELECTOR = '[data-testid="voip-accept-call-button"]';
const REJECT_SELECTOR = '[data-testid="voip-reject-call-button"]';
const CALL_NAME_SELECTOR = '[data-testid="voip-call-header-name"]';
const CALL_STATE_SELECTOR = '[data-testid="voip-call-participant-info-call-state-text"]';
const ACCEPT_RE = /aceitar|atender|accept|answer|aceptar|contestar/i;
const DECLINE_RE = /recusar|decline|reject|rechazar/i;
let ringing = null; // { since, text }
let callMisses = 0;
let callNotificationAt = 0;
let callNotificationText = '';
let callTitleAt = 0;
let callTitleCaller = '';
let callTitleKind = '';

const callKind = (text) => (/v[ií]deo/i.test(text || '') ? 'Ligação de vídeo recebida' : 'Ligação de voz recebida');

function callSnapshot() {
  const acceptEl = document.querySelector(ACCEPT_SELECTOR);
  const accept = acceptEl && acceptEl.getClientRects().length ? acceptEl : null; // só conta se estiver na tela
  const title = document.title || '';
  const now = Date.now();
  if (ringing && ringing.sawButton && !accept) return null; // o mini player apareceu e sumiu: atendida, recusada ou ignorada
  if (CALL_RE.test(title)) {
    // o WhatsApp alterna o título (2 s normal, 2 s chamada): vale como sinal por 4,5 s depois da última vez visto
    callTitleAt = now;
    callTitleCaller = title.replace(/^.*?(recebida|entrante|call)\s*(de|from|von)?\s*/i, '').trim();
    callTitleKind = title;
  }
  const recentTitle = now - callTitleAt < 4500;
  // A Notification da página só dá o nome do contato: quem começa e mantém o toque é o que só o WhatsApp controla
  // (botão do mini player ou título da aba) — uma mensagem cujo texto fale de ligação não vira chamada falsa
  if (!accept && !recentTitle) return null;
  const name = ((document.querySelector(CALL_NAME_SELECTOR) || {}).textContent || '').trim();
  const state = ((document.querySelector(CALL_STATE_SELECTOR) || {}).textContent || '').trim();
  const caller = name || (recentTitle ? callTitleCaller : '') || callNotificationText;
  const kind = callKind(`${state} ${recentTitle ? callTitleKind : ''} ${callNotificationText}`);
  return { text: caller ? `${kind} · ${caller}` : kind, button: !!accept };
}

function stopRinging() {
  if (!ringing) return;
  ringing = null;
  callMisses = 0;
  callNotificationAt = 0;
  callNotificationText = '';
  callTitleAt = 0;
  ipcRenderer.send('wa:call-ended');
}

function pollCall() {
  const snap = callSnapshot();
  if (snap) {
    callMisses = 0;
    if (!ringing) {
      ringing = { since: Date.now(), text: snap.text, sawButton: snap.button };
      ipcRenderer.send('wa:incoming-call', snap.text);
    } else if (snap.button) ringing.sawButton = true;
    if (ringing && snap.text !== ringing.text && snap.text.length > ringing.text.length) {
      ringing.text = snap.text; // o nome do contato chegou depois do primeiro sinal
      ipcRenderer.send('wa:incoming-call', snap.text);
    }
    return;
  }
  if (ringing && ++callMisses >= 3) stopRinging(); // 3 s sem botão, título ou notificação: atendida, recusada ou perdida
}
setInterval(pollCall, 1000);

// Notification da página com texto de chamada (o proxy avisa por evento DOM): entra como sinal por 12 s
document.addEventListener('palette:incoming-call', () => {
  callNotificationAt = Date.now();
  callNotificationText = (document.documentElement.dataset.paletteCall || '').trim();
  pollCall();
});

// Atender/recusar pela janelinha do Palette: clica no botão do próprio WhatsApp (seletor exato; senão, rótulo dentro
// da UI de chamada). Nunca procura no documento inteiro, para não clicar em outra coisa.
const clickable = (el) => (el && !el.matches('button, [role="button"]') ? el.querySelector('button, [role="button"]') || el.closest('button, [role="button"]') || el : el);
ipcRenderer.on('wa:call-action', (_event, action) => {
  const re = action === 'accept' ? ACCEPT_RE : DECLINE_RE;
  const label = (el) => `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.textContent || ''}`;
  const exact = clickable(document.querySelector(action === 'accept' ? ACCEPT_SELECTOR : REJECT_SELECTOR));
  const fallback = () => Array.from(document.querySelectorAll('[data-testid^="voip-"] button, [data-testid^="voip-"][role="button"], button[data-testid^="voip-"]')).find((el) => re.test(label(el)));
  const target = exact || fallback();
  if (target) {
    target.click();
    stopRinging(); // o usuário agiu: encerra o toque na hora (o WhatsApp some com o botão em seguida)
  }
  ipcRenderer.send('wa:call-action-result', action, !!target);
});

// ---------- estado de login (QR code x app logado) e foto do perfil ----------
let lastLogin;
function checkLogin() {
  const loggedIn = !!document.querySelector('#pane-side, #side');
  const heading = document.querySelector('h1, h2');
  const loggedOut = !loggedIn && (!!document.querySelector('div[data-ref]') || /escaneie|scan to log in|escanea para/i.test(heading ? heading.textContent : ''));
  const state = loggedIn ? true : loggedOut ? false : null;
  if (state === lastLogin) return;
  lastLogin = state;
  ipcRenderer.send('wa:login-state', state);
  if (state === true && !lastPhotoHash) setTimeout(sendProfilePhoto, 8000); // depois disso, só a cada 10 min
}

/** Avatar do próprio usuário na navegação do WhatsApp (botão "Você"/"Perfil", imagem blob da mesma origem). */
function findProfilePhoto() {
  for (const img of document.querySelectorAll('img[src^="blob:"]')) {
    const holder = img.closest('[aria-label], [title]');
    const label = holder ? holder.getAttribute('aria-label') || holder.getAttribute('title') || '' : '';
    if (/^(você|you|tú|usted|perfil|profile|foto do perfil|profile photo)$/i.test(label.trim())) return img;
  }
  return null;
}

// Hash perceptual 8x8 (média de cinza): a mesma foto em outra resolução dá quase o mesmo hash, então o avatar
// só é trocado quando a foto realmente muda (trocar à toa fazia o avatar piscar).
function photoHash(canvas) {
  const small = document.createElement('canvas');
  small.width = small.height = 8;
  const ctx = small.getContext('2d');
  ctx.drawImage(canvas, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  const gray = [];
  let sum = 0;
  for (let i = 0; i < 64; i++) {
    const g = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
    gray.push(g);
    sum += g;
  }
  const avg = sum / 64;
  return gray.map((g) => (g >= avg ? '1' : '0')).join('');
}
const hamming = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

let lastPhotoHash = null;
function sendProfilePhoto() {
  const img = findProfilePhoto();
  if (!img || !img.complete || !img.naturalWidth) return;
  try {
    const size = 96;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    const hash = photoHash(canvas);
    if (lastPhotoHash && hamming(hash, lastPhotoHash) <= 6) return;
    lastPhotoHash = hash;
    ipcRenderer.send('wa:profile-photo', canvas.toDataURL('image/jpeg', 0.85));
  } catch {}
}

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(checkLogin, 2500);
  setInterval(checkLogin, 5000);
  setInterval(sendProfilePhoto, 10 * 60 * 1000);
});
