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
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M18.6 13A17.9 17.9 0 0 1 18 8"/><path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.3-5"/><path d="M1 1l22 22"/></svg>',
};
const SVG = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
/** Ícones de avatar (chaves validadas no main: ACCOUNT_ICON_KEYS). */
const ACCOUNT_ICONS = {
  briefcase: ['Trabalho', SVG('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>')],
  home: ['Casa', SVG('<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>')],
  headset: ['Suporte', SVG('<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>')],
  cart: ['Vendas', SVG('<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>')],
  star: ['Favorito', SVG('<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>')],
  heart: ['Pessoal', SVG('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/>')],
  phone: ['Telefone', SVG('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>')],
  building: ['Empresa', SVG('<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M8 6h2M8 10h2M8 14h2M14 6h2M14 10h2M14 14h2"/>')],
  bell: ['Avisos', SVG('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>')],
  users: ['Equipe', SVG('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>')],
  globe: ['Global', SVG('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>')],
  bolt: ['Urgente', SVG('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>')],
  coffee: ['Café', SVG('<path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3"/>')],
  wrench: ['Técnico', SVG('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-7 7a2.1 2.1 0 0 1-3-3l7-7a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/>')],
  truck: ['Entregas', SVG('<rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>')],
  shield: ['Segurança', SVG('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>')],
};
const AVATAR_KINDS = [['initials', 'Iniciais'], ['icon', 'Ícone'], ['image', 'Imagem'], ['photo', 'Foto do WhatsApp']];

/** Preenche um .avatar conforme o tipo escolhido (sem refazer o DOM quando nada mudou). */
function paintAvatar(node, account) {
  const kind = account.avatar || 'initials';
  const src = kind === 'image' ? account.image : kind === 'photo' ? account.photo : null;
  const sig = kind === 'icon' && ACCOUNT_ICONS[account.icon] ? `icon:${account.icon}` : src ? `${kind}:${src.length}:${src.slice(-24)}` : `initials:${initials(account.name)}`;
  if (node.dataset.sig === sig) return;
  node.dataset.sig = sig;
  node.classList.toggle('has-image', !!src && kind !== 'icon');
  if (sig.startsWith('icon:')) node.innerHTML = ACCOUNT_ICONS[account.icon][1];
  else if (src && kind !== 'icon') {
    // Troca de imagem só depois de decodificada: a anterior fica na tela até lá (sem instante em branco)
    const img = el('img', { src, alt: '', draggable: false });
    img.decoding = 'sync';
    const swap = () => {
      if (node.dataset.sig === sig) node.replaceChildren(img);
    };
    if (node.querySelector('img') && typeof img.decode === 'function') img.decode().then(swap, swap);
    else swap();
  }
  else node.textContent = initials(account.name);
}

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
let settingsKey = '';
let dragId = null;
let lastOverlay = -1;
let fileDialogTest = null; // resultado do último "Testar seletor" (Linux)
let picker = null; // seletor de arquivos do Palette: { spec, dir, parent, entries, selected, error, els }

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
  if (modal && modal.type === 'picker' && picker && next.type !== 'picker') {
    picker = null;
    api.pickerResult(null);
  }
  modal = next;
  api.setModal(true);
  render();
}

function closeModal() {
  if (!modal) return;
  logModal('close', modal);
  if (modal.type === 'picker' && picker) {
    picker = null;
    api.pickerResult(null);
  }
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

/** Cria o botão de uma conta uma única vez; os handlers leem o id do próprio botão (nunca um estado antigo). */
function createAccountButton() {
  const button = el('button', { type: 'button', class: 'acc', draggable: true });
  button.append(
    el('span', { class: 'avatar' }),
    el('span', { class: 'badge', hidden: true }),
    el('span', { class: 'warn', text: '!', hidden: true, title: 'Precisa vincular de novo (QR code)' }),
    el('span', { class: 'mute', html: ICONS.mute, hidden: true }),
    el('span', { class: 'call', html: ICONS.phone, hidden: true }),
    el('span', { class: 'audible', hidden: true }),
  );
  button.addEventListener('click', () => {
    if (modal) closeModal();
    api.select(button.dataset.id);
  });
  button.addEventListener('dblclick', () => openModal({ type: 'account', id: button.dataset.id }));
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    api.contextMenu(button.dataset.id);
  });
  button.addEventListener('dragstart', (event) => {
    dragId = button.dataset.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragId);
    button.classList.add('dragging');
  });
  button.addEventListener('dragend', () => {
    dragId = null;
    button.classList.remove('dragging');
  });
  button.addEventListener('dragover', (event) => {
    if (!dragId || dragId === button.dataset.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });
  button.addEventListener('drop', (event) => {
    event.preventDefault();
    const target = button.dataset.id;
    if (!dragId || dragId === target) return;
    const ids = state.accounts.map((a) => a.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(target);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    api.reorder(ids);
  });
  return button;
}

function updateAccountButton(button, account, index) {
  const active = account.id === state.activeId;
  button.dataset.id = account.id;
  button.classList.toggle('active', active);
  button.classList.toggle('muted', !!account.muted);
  button.classList.toggle('loading', !account.loaded);
  button.classList.toggle('ringing', !!account.ringing);
  button.classList.toggle('audible', !account.ringing && !!account.audible && !active);
  button.classList.toggle('warn-state', !!account.needsLink);
  button.style.setProperty('--c', account.color);
  const parts = [];
  if (account.ringing) parts.push('Chamada recebida');
  if (account.needsLink) parts.push('Precisa vincular de novo (QR code)');
  parts.push(`${account.name}${index < 9 ? ` (${shortcut(index + 1)})` : ''}`);
  button.title = `${parts.join(' · ')} · duplo clique ou botão direito: nome, cor, silenciar`;
  paintAvatar(button.querySelector('.avatar'), account);
  const badge = button.querySelector('.badge');
  badge.hidden = !account.unread;
  if (account.unread) badge.textContent = account.unread > 99 ? '99+' : String(account.unread);
  button.querySelector('.warn').hidden = !account.needsLink || !!account.unread;
  button.querySelector('.mute').hidden = !account.muted;
  button.querySelector('.call').hidden = !account.ringing;
  button.querySelector('.audible').hidden = !!account.ringing || !account.audible || active;
}

/** Atualiza a barra no lugar (sem recriar botões): um clique ou arrasto em andamento não se perde quando chega mensagem. */
function renderRail() {
  const list = $('#accounts');
  const existing = new Map(Array.from(list.children, (node) => [node.dataset.id, node]));
  const ordered = state.accounts.map((account, index) => {
    const button = existing.get(account.id) || createAccountButton();
    existing.delete(account.id);
    updateAccountButton(button, account, index);
    return button;
  });
  for (const node of existing.values()) node.remove();
  ordered.forEach((node, i) => {
    if (list.children[i] !== node) list.insertBefore(node, list.children[i] || null);
  });
}

function renderContent() {
  const key = modal ? `${modal.type}:${modal.id || ''}` : state.accounts.length ? 'blank' : 'welcome';
  // Não reconstrói o formulário a cada atualização (perderia o que está sendo digitado); as configurações
  // só são reconstruídas quando algo que elas mostram muda (não a cada som ou mensagem), mantendo a rolagem.
  const isSettings = key === 'settings:';
  const nextSettingsKey = isSettings ? JSON.stringify([state.settings, state.update, state.media, state.spellOptions, state.accounts.map((a) => [a.id, a.name, a.color, a.avatar, a.icon, (a.image || '').length, (a.photo || '').length, a.needsLink]), fileDialogTest]) : '';
  if (key === contentKey && (!isSettings || nextSettingsKey === settingsKey)) return;
  contentKey = key;
  settingsKey = nextSettingsKey;
  const main = $('#content');
  const scrollTop = isSettings ? main.scrollTop : 0;
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
  } else if (modal && modal.type === 'settings') {
    main.append(settingsPanel());
    main.scrollTop = scrollTop;
  } else if (modal && modal.type === 'picker' && picker) {
    main.append(pickerPanel());
    renderPickerList();
  } else main.append(welcome());
}

// ---------- seletor de arquivos do Palette ----------

const joinPath = (dir, name) => (state.platform === 'win32' ? (dir.endsWith('\\') ? dir + name : `${dir}\\${name}`) : dir.endsWith('/') ? dir + name : `${dir}/${name}`);
const formatSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`);

function openPicker(spec) {
  picker = { spec, dir: spec.start, parent: null, entries: [], selected: new Set(), error: '', els: null };
  openModal({ type: 'picker' });
  loadDir(spec.start);
}

async function loadDir(dir) {
  const current = picker;
  if (!current) return;
  const result = await api.pickerList(dir);
  if (!result || picker !== current) return;
  current.dir = result.dir;
  current.parent = result.parent;
  current.entries = result.entries || [];
  current.error = result.error || '';
  current.selected.clear();
  renderPickerList();
}

function finishPicker(result) {
  if (!picker) return;
  picker = null;
  api.pickerResult(result);
  closeModal();
}

function submitPicker() {
  const p = picker;
  if (!p) return;
  if (p.spec.kind === 'save') {
    const name = (p.els.nameInput.value || '').trim();
    if (!name) return p.els.nameInput.focus();
    finishPicker(joinPath(p.dir, name));
  } else {
    const paths = [...p.selected].map((n) => joinPath(p.dir, n));
    if (paths.length) finishPicker(paths);
  }
}

function pickerPanel() {
  const p = picker;
  const spec = p.spec;
  const pathBar = el('div', { class: 'picker-path' });
  const list = el('div', { class: 'picker-list' });
  const status = el('p', { class: 'hint small picker-status' });
  const nameInput = spec.kind === 'save' ? el('input', { class: 'input', type: 'text', value: spec.suggestedName || '', spellcheck: 'false' }) : null;
  const okBtn = el('button', { type: 'submit', class: 'btn primary', text: spec.kind === 'save' ? 'Salvar aqui' : spec.multiple ? 'Anexar selecionados' : 'Escolher' });
  p.els = { pathBar, list, status, nameInput, okBtn };
  return el('form', { class: 'panel picker', onsubmit: (event) => { event.preventDefault(); submitPicker(); } }, [
    el('h2', { text: spec.title }),
    el('div', { class: 'chips' }, (spec.places || []).map((place) => el('button', { type: 'button', class: 'chip', text: place.label, onclick: () => loadDir(place.path) }))),
    el('div', { class: 'picker-bar' }, [el('button', { type: 'button', class: 'btn ghost small', text: '↑ Pasta acima', onclick: () => p.parent && loadDir(p.parent) }), pathBar]),
    list,
    status,
    nameInput ? el('label', { class: 'field' }, [el('span', { text: 'Nome do arquivo' }), nameInput]) : null,
    el('p', { class: 'hint small', text: spec.kind === 'save' ? 'Escolha a pasta, confira o nome e clique em Salvar aqui.' : spec.multiple ? 'Clique para marcar vários arquivos; duplo clique abre pastas ou escolhe um arquivo.' : 'Duplo clique escolhe o arquivo; clique simples marca e Escolher confirma.' }),
    el('div', { class: 'actions' }, [el('button', { type: 'button', class: 'btn ghost', text: 'Cancelar', onclick: () => finishPicker(null) }), okBtn]),
  ]);
}

function renderPickerList() {
  const p = picker;
  if (!p || !p.els) return;
  const { list, pathBar, status, okBtn } = p.els;
  pathBar.textContent = p.dir || '';
  list.replaceChildren(
    ...p.entries.map((entry) => {
      const row = el('div', { class: `picker-row${p.selected.has(entry.name) ? ' selected' : ''}`, html: entry.dir ? ICONS.folder : ICONS.file, title: entry.name });
      row.append(el('span', { class: 'picker-name', text: entry.name }), el('span', { class: 'picker-size', text: entry.dir ? '' : formatSize(entry.size) }));
      row.addEventListener('click', () => {
        if (entry.dir) return;
        if (p.spec.multiple) {
          if (p.selected.has(entry.name)) p.selected.delete(entry.name);
          else p.selected.add(entry.name);
        } else {
          p.selected.clear();
          p.selected.add(entry.name);
        }
        if (p.els.nameInput) p.els.nameInput.value = entry.name;
        renderPickerList();
      });
      row.addEventListener('dblclick', () => {
        if (entry.dir) loadDir(joinPath(p.dir, entry.name));
        else if (p.spec.kind === 'open') finishPicker([joinPath(p.dir, entry.name)]);
      });
      return row;
    }),
  );
  status.textContent = p.error || (p.entries.length === 1 ? '1 item' : p.entries.length ? `${p.entries.length} itens` : p.spec.exts ? 'Nenhum arquivo deste tipo nesta pasta.' : 'Pasta vazia.');
  okBtn.disabled = p.spec.kind === 'open' && !p.selected.size;
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
  let avatar = (existing && existing.avatar) || 'initials';
  let icon = (existing && existing.icon) || 'briefcase';
  let image = (existing && existing.image) || null;
  const photo = existing ? existing.photo : null;
  if (avatar === 'photo' && !photo) avatar = 'initials';
  if (avatar === 'image' && !image) avatar = 'initials';

  const nameInput = el('input', { class: 'input', type: 'text', maxlength: 32, placeholder: 'Ex.: Suporte, Vendas, Pessoal', value: existing ? existing.name : '', spellcheck: 'false' });
  const swatches = el('div', { class: 'swatches' });
  const preview = el('span', { class: 'avatar preview' });
  const kinds = el('div', { class: 'chips' });
  const detail = el('div', { class: 'avatar-detail' });

  const current = () => ({ name: nameInput.value || (existing ? existing.name : 'Conta'), color, avatar, icon, image, photo });
  const refresh = () => {
    preview.style.setProperty('--c', color);
    paintAvatar(preview, current());
    swatches.replaceChildren(
      ...state.colors.map((c) => {
        const swatch = el('button', { type: 'button', class: `swatch${c === color ? ' selected' : ''}`, title: c, 'aria-label': `Cor ${c}`, onclick: () => { color = c; refresh(); } });
        swatch.style.setProperty('--c', c);
        return swatch;
      }),
    );
    kinds.replaceChildren(
      ...AVATAR_KINDS.filter(([kind]) => kind !== 'photo' || photo).map(([kind, label]) =>
        el('button', { type: 'button', class: `chip${avatar === kind ? ' on' : ''}`, text: label, onclick: () => { avatar = kind; if (kind === 'image' && !image) pickImage(); refresh(); } }),
      ),
    );
    detail.replaceChildren();
    if (avatar === 'icon') {
      detail.append(
        el('div', { class: 'icon-grid' }, Object.entries(ACCOUNT_ICONS).map(([key, [label, svg]]) => {
          const button = el('button', { type: 'button', class: `icon-btn${icon === key ? ' selected' : ''}`, title: label, 'aria-label': label, html: svg, onclick: () => { icon = key; refresh(); } });
          button.style.setProperty('--c', color);
          return button;
        })),
      );
    } else if (avatar === 'image') {
      detail.append(
        el('div', { class: 'actions start' }, [
          el('button', { type: 'button', class: 'btn ghost small', text: image ? 'Trocar imagem…' : 'Escolher imagem…', onclick: pickImage }),
          image ? el('button', { type: 'button', class: 'btn ghost small', text: 'Remover imagem', onclick: () => { image = null; avatar = 'initials'; refresh(); } }) : null,
        ]),
        el('p', { class: 'hint small', text: 'PNG ou JPG; o centro da imagem vira um círculo de 128 px.' }),
      );
    } else if (avatar === 'photo') {
      detail.append(el('p', { class: 'hint small', text: 'A foto do perfil é lida da própria conta e atualizada de tempos em tempos.' }));
    }
  };
  const pickImage = async () => {
    const data = await api.pickImage();
    if (data) {
      image = data;
      avatar = 'image';
    } else if (!image) avatar = 'initials';
    refresh();
  };
  nameInput.addEventListener('input', () => paintAvatar(preview, current()));
  refresh();

  return el('form', {
    class: 'panel',
    onsubmit: async (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return nameInput.focus();
      const data = { name, color, avatar, icon, image };
      if (existing) await api.update(existing.id, data);
      else await api.add(data);
      dismiss();
    },
  }, [
    el('h2', { text: existing ? 'Editar conta' : 'Nova conta' }),
    el('p', { class: 'hint', text: existing ? 'Nome, cor e avatar aparecem só na barra lateral.' : 'Cada conta é um aparelho vinculado separado: depois de criar, escaneie o QR code com o celular desse número.' }),
    el('div', { class: 'avatar-row' }, [preview, el('label', { class: 'field grow' }, [el('span', { text: 'Nome' }), nameInput])]),
    el('div', { class: 'field' }, [el('span', { text: 'Cor' }), swatches]),
    el('div', { class: 'field' }, [el('span', { text: 'Avatar' }), kinds, detail]),
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
    items.push(el('p', { class: 'hint small', text: 'Nome, cor e avatar (iniciais, ícone, imagem ou a foto do WhatsApp) podem ser mudados a qualquer momento — também com duplo clique ou botão direito na barra lateral.' }));
    for (const account of state.accounts) {
      const avatar = el('span', { class: 'avatar mini' });
      avatar.style.setProperty('--c', account.color);
      paintAvatar(avatar, account);
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
      label: 'Perguntar onde salvar os arquivos',
      hint: 'Desligado: fotos e documentos vão direto para a pasta Downloads.',
      checked: settings.askWhereToSave !== false,
      onchange: (value) => api.setSetting('askWhereToSave', value),
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
  items.push(
    toggle({
      label: 'Manter a janela sempre no topo',
      hint: 'Útil para acompanhar conversas enquanto usa outros programas (também no menu Visualizar).',
      checked: !!settings.alwaysOnTop,
      onchange: (value) => api.setSetting('alwaysOnTop', value),
    }),
  );
  items.push(
    toggle({
      label: `Atalho global ${mac ? '⌃⇧W' : 'Ctrl+Shift+W'} para mostrar ou esconder`,
      hint: 'Funciona de qualquer programa, mesmo com o Palette escondido.',
      checked: !!settings.globalShortcut,
      onchange: (value) => api.setSetting('globalShortcut', value),
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

  if (state.platform === 'linux') {
    const mode = settings.fileDialog || 'palette';
    items.push(el('h3', { text: 'Seletor de arquivos (Linux)' }));
    items.push(el('p', { class: 'hint small', text: `"Seletor do Palette" é o diálogo do próprio app (abre em Imagens, Vídeos, Música ou Downloads conforme o pedido e aceita duplo clique) e não depende do sistema. Os outros usam o seletor nativo: GTK (nele, selecione e clique em Abrir — Enter e duplo clique ainda não funcionam no Chromium) ou o portal xdg-desktop-portal. A troca vale na próxima abertura do app.${state.linux ? ` Ambiente: ${state.linux.desktop || '?'} em ${state.linux.session || '?'}; em uso agora: ${{ palette: 'Seletor do Palette', gtk: 'GTK', portal: 'portal', auto: 'automático' }[state.linux.fileDialogActive] || state.linux.fileDialogActive}.` : ''}` }));
    items.push(
      el('div', { class: 'chips' }, [['palette', 'Seletor do Palette'], ['gtk', 'Nativo (GTK)'], ['portal', 'Portal do sistema'], ['auto', 'Automático']].map(([value, label]) =>
        el('button', { type: 'button', class: `chip${mode === value ? ' on' : ''}`, text: label, onclick: () => api.setSetting('fileDialog', value) }),
      )),
    );
    items.push(
      el('div', { class: 'actions start' }, [
        el('button', {
          type: 'button',
          class: 'btn ghost small',
          text: 'Testar seletor agora',
          disabled: !!(fileDialogTest && fileDialogTest.pending),
          onclick: async () => {
            fileDialogTest = { pending: true };
            render();
            fileDialogTest = await api.testFileDialog();
            render();
          },
        }),
      ]),
    );
    if (fileDialogTest) {
      const text = fileDialogTest.pending
        ? 'Abrindo o seletor…'
        : fileDialogTest.ok
          ? `O seletor abriu (${fileDialogTest.canceled ? 'fechado sem escolher' : 'arquivo escolhido'}, ${fileDialogTest.ms} ms, modo ${fileDialogTest.mode}).`
          : 'O seletor não apareceu em 15 segundos. Troque o modo acima e abra o Palette de novo.';
      items.push(el('p', { class: `hint small${fileDialogTest.ok === false ? ' bad' : ''}`, text }));
    }
  }

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
    error: `Falha na atualização: ${update.message}${checked}`,
  };
  const updateActions = [];
  if (update.status === 'downloaded') updateActions.push(el('button', { type: 'button', class: 'btn primary small', text: 'Reiniciar e atualizar', onclick: () => api.installUpdate() }));
  else if (update.status === 'available') updateActions.push(el('button', { type: 'button', class: 'btn primary small', text: `Baixar ${update.version}`, onclick: () => api.openExternal(state.releasesUrl) }));
  if (update.status === 'error') updateActions.push(el('button', { type: 'button', class: 'btn primary small', text: 'Baixar manualmente', onclick: () => api.openExternal(state.releasesUrl) }));
  if (['idle', 'up-to-date', 'available', 'error', 'checking', 'downloading'].includes(update.status)) updateActions.push(el('button', { type: 'button', class: 'btn ghost small', text: 'Verificar agora', onclick: () => api.checkUpdate() }));

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
  else if (command === 'picker' && arg) openPicker(arg);
});
api.onState((next) => {
  state = next;
  render();
});
api.ready().then((next) => {
  state = next;
  render();
});
