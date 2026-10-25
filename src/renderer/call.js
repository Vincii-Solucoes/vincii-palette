'use strict';
// Janelinha de chamada (ver src/main/callpopup.js): mostra quem liga e em qual conta; os botões pedem ao main
// para o WhatsApp da conta atender ou recusar; clicar no resto do cartão abre a conta no Palette.
const CALL_RE = /(chamada|llamada|videollamada)[^.]{0,40}?(recebida|entrante)|incoming[^.]{0,30}?call|is calling|est[áa] (te )?(ligando|chamando)/i;
const $ = (selector) => document.querySelector(selector);
let current = null;

window.callPopup.onState((state) => {
  current = state;
  const avatar = $('#avatar');
  avatar.style.setProperty('--c', state.color || '#00c9b1');
  avatar.replaceChildren();
  if (state.image) {
    const img = document.createElement('img');
    img.src = state.image;
    img.alt = '';
    avatar.append(img);
  } else avatar.textContent = state.initials || '?';
  const text = String(state.text || '').replace(/\s+/g, ' ').trim();
  const match = text.match(CALL_RE);
  const kind = match ? match[0].replace(/\s*(recebida|entrante|incoming)\s*/i, ' ').replace(/\s+/g, ' ').trim() : '';
  const who = (match ? text.replace(match[0], '') : text).replace(/^[\s·:,-]+|[\s·:,-]+$/g, '').trim();
  $('#title').textContent = kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'Chamada recebida';
  $('#who').textContent = who || 'Alguém está ligando';
  $('#account').textContent = `WhatsApp ${state.name || ''}${state.others ? ` · mais ${state.others} chamando` : ''}`;
});

$('#accept').addEventListener('click', () => current && window.callPopup.act(current.id, 'accept'));
$('#decline').addEventListener('click', () => current && window.callPopup.act(current.id, 'decline'));
$('#card').addEventListener('click', (event) => {
  if (!event.target.closest('button') && current) window.callPopup.act(current.id, 'open');
});
