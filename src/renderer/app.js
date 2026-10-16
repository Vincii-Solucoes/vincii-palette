'use strict';
// Barra lateral do Palette: lista de contas (trocar, reordenar arrastando, menu de contexto),
// boas-vindas sem conta, diálogo de nova conta/edição e configurações. O WhatsApp de cada conta
// é uma view nativa desenhada por cima da área de conteúdo — enquanto um diálogo está aberto, o
// processo principal esconde as views (api.setModal).
const api = window.palette;

const $ = (selector, root = document) => root.querySelector(selector);
const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'checked' || key === 'disabled' || key === 'draggable') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) if (child != null) node.append(child);
  return node;
};

const ICONS = {
  phone: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8z"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M18.6 13A17.9 17.9 0 0 1 18 8"/><path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.3-5"/><path d="M1 1l22 22"/></svg>',
};
const MEDIA_LABELS = {
  granted: ['Permitido', 'ok'],
  denied: ['Negado — libere nos ajustes de privacidade', 'bad'],
  restricted: ['Restrito pelo sistema', 'bad'],
  'not-determined': ['Será pedido na primeira chamada', ''],
  unknown: ['Desconhecido', ''],
};

let state = { accounts: [], activeId: null, settings: {}, platform: api.platform, colors: [], spellOptions: [], media: null, version: '', versions: {} };
let modal = null; // { type: 'account', id? } | { type: 'settings' }
let contentKey = '';
let dragId = null;
let lastOverlay = -1;

const initials = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const text = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return text.toUpperCase();
};
const shortcut = (n) => (state.platform === 'darwin' ? `⌘${n}` : `Ctrl+${n}`);
const unreadTotal = () => state.accounts.reduce((sum, a) => sum + (a.muted ? 0 : a.unread), 0);

// ---------- diálogos ----------

// Diagnóstico (lido pelo smoke): quem abriu/fechou cada diálogo
const modalLog = [];
const logModal = (action, next) => {
  modalLog.push({ t: Date.now(), action, type: next ? next.type : null, stack: String(new Error().stack).split('\n').slice(3, 6).map((l) => l.trim()).join(' | ') });
  if (modalLog.length > 30) modalLog.shift();
};

function openModal(next) {
  logModal('open', next);
  modal = next;
  api.setModal(true);
  render();
}

function closeModal() {
  if (!modal) return;
  logModal('close', modal);
  modal = null;
  api.setModal(false);
  render();
}

/** Fecha o diálogo atual ou volta ao que o abriu (ex.: Editar conta aberto pelas configurações). */
function dismiss() {
  if (modal && modal.back) openModal({ type: modal.back });
  else closeModal();
}

// ---------- render ----------

function render() {
  document.body.dataset.platform = state.platform;
  renderRail();
  renderContent();
  renderOverlay();
}

function renderRail() {
  const list = $('#accounts');
  list.replaceChildren();
  state.accounts.forEach((account, index) => {
    const classes = ['acc'];
    if (account.id === state.activeId) classes.push('active');
    if (account.muted) classes.push('muted');
    if (!account.loaded) classes.push('loading');
    if (account.ringing) classes.push('ringing');
    else if (account.audible && account.id !== state.activeId) classes.push('audible');
    const button = el('button', {
      type: 'button',
      class: classes.join(' '),
      'data-id': account.id,
      title: `${account.ringing ? 'Chamada recebida · ' : ''}${account.name}${index < 9 ? ` (${shortcut(index + 1)})` : ''} · duplo clique ou botão direito: nome, cor, silenciar`,
      draggable: true,
      onclick: () => {
        if (modal) closeModal();
        api.select(account.id);
      },
      ondblclick: () => openModal({ type: 'account', id: account.id }),
      oncontextmenu: (event) => {
        event.preventDefault();
        api.contextMenu(account.id);
      },
    });
    button.style.setProperty('--c', account.color);
    button.append(el('span', { class: 'avatar', text: initials(account.name) }));
    if (account.unread) button.append(el('span', { class: 'badge', text: account.unread > 99 ? '99+' : String(account.unread) }));
    if (account.muted) button.append(el('span', { class: 'mute', html: ICONS.mute }));
    if (account.ringing) button.append(el('span', { class: 'call', html: ICONS.phone }));
    else if (account.audible && account.id !== state.activeId) button.append(el('span', { class: 'audible' }));

    button.addEventListener('dragstart', (event) => {
      dragId = account.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', account.id);
      button.classList.add('dragging');
    });
    button.addEventListener('dragend', () => {
      dragId = null;
      button.classList.remove('dragging');
    });
    button.addEventListener('dragover', (event) => {
      if (!dragId || dragId === account.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    button.addEventListener('drop', (event) => {
      event.preventDefault();
      if (!dragId || dragId === account.id) return;
      const ids = state.accounts.map((a) => a.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(account.id);
      if (from < 0 || to < 0) return;
      ids.splice(from, 1);
      ids.splice(to, 0, dragId);
      api.reorder(ids);
    });
    list.append(button);
  });
}

function renderContent() {
  const key = modal ? `${modal.type}:${modal.id || ''}` : state.accounts.length ? 'blank' : 'welcome';
  // Não reconstrói o formulário a cada atualização (perderia o que está sendo digitado);
  // as configurações são reconstruídas sempre, pois só refletem o estado.
  if (key === contentKey && key !== 'settings:') return;
  contentKey = key;
  const main = $('#content');
  main.className = key;
  main.replaceChildren();
  if (key === 'blank') {
    main.append(el('div', { class: 'frame' })); // moldura em volta da conta ativa (a view nativa fica por cima)
    return;
  }
  if (state.platform === 'darwin') main.append(el('div', { class: 'drag-strip' }));
  if (modal && modal.type === 'account') {
    main.append(accountForm(modal.id));
    const input = $('.input', main);
    if (input) {
      input.focus();
      input.select();
    }
  } else if (modal && modal.type === 'settings') main.append(settingsPanel());
  else main.append(welcome());
}

function welcome() {
  return el('div', { class: 'panel welcome' }, [
    el('img', { class: 'welcome-logo', src: '../../assets/brand/vincii-v.png', alt: 'Vincii', draggable: false }),
    el('h1', { text: 'Palette' }),
    el('p', { class: 'lead', text: 'Várias contas do WhatsApp num só lugar — mensagens, notificações e chamadas de voz e vídeo.' }),
    el('ol', { class: 'steps' }, [
      el('li', { html: '<b>Adicione uma conta</b> e dê um nome e uma cor a ela (Suporte, Vendas, Pessoal…); dá para mudar depois.' }),
      el('li', { html: 'No celular desse número: <b>WhatsApp › Dispositivos conectados › Conectar dispositivo</b> e escaneie o QR code.' }),
      el('li', { html: 'Repita para cada número. Cada conta fica <b>isolada</b>, como se estivesse em outro computador.' }),
    ]),
    el('button', { type: 'button', class: 'btn primary', text: 'Adicionar conta', onclick: () => openModal({ type: 'account' }) }),
  ]);
}

function accountForm(id) {
  const existing = id ? state.accounts.find((a) => a.id === id) : null;
  const used = new Set(state.accounts.map((a) => a.color));
  let color = existing ? existing.color : state.colors.find((c) => !used.has(c)) || state.colors[state.accounts.length % state.colors.length] || '#00C9B1';
  const nameInput = el('input', { class: 'input', type: 'text', maxlength: 32, placeholder: 'Ex.: Suporte, Vendas, Pessoal', value: existing ? existing.name : '', spellcheck: 'false' });
  const swatches = el('div', { class: 'swatches' });
  const drawSwatches = () => {
    swatches.replaceChildren(
      ...state.colors.map((c) => {
        const swatch = el('button', { type: 'button', class: `swatch${c === color ? ' selected' : ''}`, title: c, 'aria-label': `Cor ${c}`, onclick: () => { color = c; drawSwatches(); } });
        swatch.style.setProperty('--c', c);
        return swatch;
      }),
    );
  };
  drawSwatches();

  return el('form', {
    class: 'panel',
    onsubmit: async (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return nameInput.focus();
      if (existing) await api.update(existing.id, { name, color });
      else await api.add({ name, color });
      dismiss();
    },
  }, [
    el('h2', { text: existing ? 'Editar conta' : 'Nova conta' }),
    el('p', { class: 'hint', text: existing ? 'O nome e a cor aparecem só na barra lateral.' : 'Cada conta é um aparelho vinculado separado: depois de criar, escaneie o QR code com o celular desse número.' }),
    el('label', { class: 'field' }, [el('span', { text: 'Nome' }), nameInput]),
    el('div', { class: 'field' }, [el('span', { text: 'Cor' }), swatches]),
    el('div', { class: 'actions' }, [
      el('button', { type: 'button', class: 'btn ghost', text: 'Cancelar', onclick: dismiss }),
      el('button', { type: 'submit', class: 'btn primary', text: existing ? 'Salvar' : 'Adicionar' }),
    ]),
  ]);
}

function toggle({ label, hint, checked, disabled, onchange }) {
  return el('label', { class: `toggle${disabled ? ' disabled' : ''}` }, [
    el('input', { type: 'checkbox', checked: !!checked, disabled: !!disabled, onchange: (event) => onchange(event.target.checked) }),
    el('span', { class: 'track' }),
    el('span', { class: 'toggle-text' }, [el('b', { text: label }), hint ? el('small', { text: hint }) : null]),
  ]);
}

function settingsPanel() {
  const settings = state.settings || {};
  const mac = state.platform === 'darwin';
  const devHint = state.isPackaged ? '' : ' (só no app instalado)';
  const items = [el('h2', { text: 'Configurações' })];

  if (state.accounts.length) {
    items.push(el('h3', { text: 'Contas' }));
    items.push(el('p', { class: 'hint small', text: 'Nome e cor podem ser mudados a qualquer momento (também com duplo clique ou botão direito na barra lateral).' }));
    for (const account of state.accounts) {
      const avatar = el('span', { class: 'avatar mini', text: initials(account.name) });
      avatar.style.setProperty('--c', account.color);
      items.push(
        el('div', { class: 'account-row' }, [
          avatar,
          el('b', { text: account.name, title: account.name }),
          el('button', { type: 'button', class: 'btn ghost small', text: 'Editar', onclick: () => openModal({ type: 'account', id: account.id, back: 'settings' }) }),
          el('button', { type: 'button', class: 'btn ghost small danger', text: 'Remover', onclick: () => api.remove(account.id) }),
        ]),
      );
    }
  }

  items.push(el('h3', { text: 'Geral' }));

  items.push(
    toggle({
      label: 'Abrir ao iniciar o sistema',
      hint: (state.platform === 'linux' ? 'Cria uma entrada em ~/.config/autostart.' : 'Abre escondido, direto no Dock ou na bandeja.') + devHint,
      checked: settings.startAtLogin,
      disabled: !state.isPackaged,
      onchange: (value) => api.setSetting('startAtLogin', value),
    }),
  );
  items.push(
    toggle({
      label: 'Trocar para a conta que recebe a chamada',
      hint: 'Ao tocar, a conta vem para a frente; o avatar pisca com um telefone de qualquer jeito.',
      checked: settings.switchOnCall !== false,
      onchange: (value) => api.setSetting('switchOnCall', value),
    }),
  );
  if (!mac) {
    items.push(
      toggle({
        label: 'Fechar a janela mantém o Palette na bandeja',
        hint: 'Mensagens e chamadas continuam chegando com a janela fechada.',
        checked: settings.closeToTray !== false,
        onchange: (value) => api.setSetting('closeToTray', value),
      }),
    );
  }
  items.push(
    toggle({
      label: 'Abrir links whatsapp:// no Palette',
      hint: 'Links "clique para conversar" abrem na conta ativa.' + devHint,
      checked: settings.protocolDefault,
      disabled: !state.isPackaged,
      onchange: (value) => api.setSetting('protocolDefault', value),
    }),
  );

  items.push(el('h3', { text: 'Aparência' }));
  items.push(el('p', { class: 'hint small', text: 'O WhatsApp segue este tema; "Sistema" acompanha o modo claro/escuro do computador.' }));
  items.push(
    el('div', { class: 'chips' }, [['dark', 'Escuro'], ['light', 'Claro'], ['system', 'Sistema']].map(([value, label]) =>
      el('button', { type: 'button', class: `chip${(settings.theme || 'dark') === value ? ' on' : ''}`, text: label, onclick: () => api.setSetting('theme', value) }),
    )),
  );

  if (!mac && state.spellOptions.length) {
    const selected = new Set(settings.spellLanguages || []);
    items.push(el('h3', { text: 'Corretor ortográfico' }));
    items.push(
      el('div', { class: 'chips' }, state.spellOptions.map((lang) =>
        el('button', {
          type: 'button',
          class: `chip${selected.has(lang) ? ' on' : ''}`,
          text: lang,
          onclick: () => {
            if (selected.has(lang)) selected.delete(lang);
            else selected.add(lang);
            api.setSetting('spellLanguages', [...selected]);
          },
        }),
      )),
    );
  }

  items.push(el('h3', { text: 'Chamadas de voz e vídeo' }));
  if (state.media) {
    for (const [kind, label] of [['microphone', 'Microfone'], ['camera', 'Câmera']]) {
      const [text, cls] = MEDIA_LABELS[state.media[kind]] || MEDIA_LABELS.unknown;
      items.push(el('div', { class: `status ${cls}` }, [el('b', { text: label }), el('span', { text })]));
    }
    items.push(el('div', { class: 'actions' }, [el('button', { type: 'button', class: 'btn ghost small', text: 'Abrir ajustes de privacidade', onclick: () => api.openPrivacy() })]));
  } else {
    items.push(el('p', { class: 'hint', text: 'O microfone e a câmera são pedidos pelo WhatsApp na primeira chamada; o sistema controla o acesso.' }));
  }

  const update = state.update || { status: 'unsupported' };
  const checked = update.checkedAt ? ` (verificado às ${new Date(update.checkedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})` : '';
  const UPDATE_LABELS = {
    unsupported: state.isPackaged ? 'Este build não verifica atualizações; instale pelo .dmg, .exe, .AppImage ou .deb do Release.' : 'Só no app instalado.',
    idle: 'Verificação automática ligada: ao abrir, a cada hora e ao voltar à janela.',
    checking: 'Verificando…',
    'up-to-date': `Você está na versão mais recente${checked}.`,
    available: `Versão ${update.version} disponível${checked}.`,
    downloading: `Baixando a versão ${update.version}… ${update.percent || 0}%`,
    downloaded: `Versão ${update.version} baixada e pronta para instalar.`,
    error: `Falha ao verificar: ${update.message}${checked}`,
  };
  const updateActions = [];
  if (update.status === 'downloaded') updateActions.push(el('button', { type: 'button', class: 'btn primary small', text: 'Reiniciar e atualizar', onclick: () => api.installUpdate() }));
  else if (update.status === 'available') updateActions.push(el('button', { type: 'button', class: 'btn primary small', text: `Baixar ${update.version}`, onclick: () => api.openExternal(state.releasesUrl) }));
  if (['idle', 'up-to-date', 'available', 'error'].includes(update.status)) updateActions.push(el('button', { type: 'button', class: 'btn ghost small', text: 'Verificar agora', onclick: () => api.checkUpdate() }));

  items.push(
    el('h3', { text: 'Sobre' }),
    el('p', { class: 'hint small', text: `Palette ${state.version} · Vincii · Electron ${state.versions.electron || ''} · Chrome ${state.versions.chrome || ''}` }),
    el('div', { class: `status ${update.status === 'error' ? 'bad' : update.status === 'downloaded' || update.status === 'available' ? 'ok' : ''}` }, [el('b', { text: 'Atualizações' }), el('span', { text: UPDATE_LABELS[update.status] || '' })]),
    updateActions.length ? el('div', { class: 'actions' }, updateActions) : null,
    el('p', { class: 'hint small', text: 'Cada conta usa o WhatsApp Web oficial numa sessão isolada; o Palette só organiza as janelas, notificações e permissões.' }),
    el('div', { class: 'actions' }, [el('button', { type: 'button', class: 'btn primary', text: 'Fechar', onclick: closeModal })]),
  );
  return el('div', { class: 'panel' }, items);
}

/** Windows: contador de não lidas sobre o ícone da barra de tarefas (desenhado aqui, enviado ao main). */
function renderOverlay() {
  if (state.platform !== 'win32') return;
  const total = unreadTotal();
  if (total === lastOverlay) return;
  lastOverlay = total;
  if (!total) return api.setOverlay(null, 0);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FF3B30';
  ctx.beginPath();
  ctx.arc(16, 16, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${total > 99 ? 13 : 18}px Inter, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total > 99 ? '99+' : String(total), 16, 17);
  api.setOverlay(canvas.toDataURL('image/png'), total);
}

// ---------- eventos ----------

$('#add').addEventListener('click', () => openModal({ type: 'account' }));
$('#settings').addEventListener('click', () => (modal && modal.type === 'settings' ? closeModal() : openModal({ type: 'settings' })));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modal) dismiss();
});
// Clique fora do painel (no fundo escuro) fecha o diálogo
$('#content').addEventListener('click', (event) => {
  if (modal && (event.target === event.currentTarget || event.target.classList.contains('drag-strip'))) dismiss();
});
// Links dentro da área de conteúdo abrem no navegador
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!link) return;
  event.preventDefault();
  api.openExternal(link.href);
});

api.onCommand((command, arg) => {
  if (command === 'new-account') openModal({ type: 'account' });
  else if (command === 'edit-account') openModal({ type: 'account', id: arg });
  else if (command === 'settings') (modal && modal.type === 'settings' ? closeModal() : openModal({ type: 'settings' }));
});
api.onState((next) => {
  state = next;
  render();
});
api.ready().then((next) => {
  state = next;
  render();
});
