'use strict';
// Gerencia as contas: cada uma é um WebContentsView com partition própria (persist:wa-<id>)
// carregando o WhatsApp Web — sessões isoladas, como se cada conta estivesse em outro computador.
// Todas as views ficam montadas (mensagens, notificações e chamadas seguem em segundo plano);
// só a ativa fica visível, à direita da barra lateral.
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const path = require('node:path');
const { Menu, WebContentsView, clipboard, session, shell } = require('electron');
const { RAIL_WIDTH, FRAME_MARGIN, FRAME_RADIUS, WA_URL, WA_ORIGIN, ACCOUNT_COLORS, BG, MAX_NAME_LENGTH } = require('./constants');
const { configureSession, applySpellLanguages, USER_AGENT } = require('./wa-session');

const PRELOAD = path.join(__dirname, '..', 'preload', 'whatsapp.js');
const partitionOf = (id) => `persist:wa-${id}`;

const offlineHtml = (detail) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>WhatsApp</title>
<style>body{margin:0;background:${BG};color:#E0E0E0;font-family:-apple-system,Inter,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}
.box{max-width:420px;padding:32px;text-align:center}h1{color:#fff;font-size:20px;margin:0 0 8px}p{color:#9C9C9C;font-size:14px;line-height:1.5;margin:0 0 20px}
button{background:#00C9B1;color:#03120F;border:0;border-radius:10px;padding:12px 20px;font-weight:700;letter-spacing:1px;cursor:pointer}</style></head>
<body><div class="box"><h1>Sem conexão com o WhatsApp</h1><p>Não foi possível abrir web.whatsapp.com${detail ? ` (${detail})` : ''}. Verifique a rede; tentamos de novo em 15 segundos.</p>
<button onclick="location.href='${WA_URL}'">TENTAR AGORA</button></div><script>setTimeout(function(){location.href='${WA_URL}'},15000)</script></body></html>`;

/** Normaliza nome/cor vindos do renderer. */
function sanitizeAccount(data = {}, fallback = {}) {
  const name = String(data.name ?? fallback.name ?? '').trim().slice(0, MAX_NAME_LENGTH);
  const color = ACCOUNT_COLORS.includes(data.color) ? data.color : fallback.color || ACCOUNT_COLORS[0];
  return { name, color };
}

class AccountManager extends EventEmitter {
  constructor({ win, store, isDev }) {
    super();
    this.win = win;
    this.store = store;
    this.isDev = isDev;
    this.entries = new Map(); // id → { view, unread, loaded }
    this.modalOpen = false;
    this.accounts = Array.isArray(store.get('accounts')) ? store.get('accounts') : [];
    this.activeId = store.get('activeId') ?? null;
    for (const account of this.accounts) this.mount(account);
    if (!this.accounts.some((a) => a.id === this.activeId)) this.activeId = this.accounts[0]?.id ?? null;
    this.layout();
    this.applyVisibility();
  }

  get settings() {
    return this.store.get('settings') || {};
  }

  find(id) {
    return this.accounts.find((a) => a.id === id) || null;
  }

  list() {
    return this.accounts.map((a) => {
      const entry = this.entries.get(a.id);
      return { id: a.id, name: a.name, color: a.color, muted: !!a.muted, unread: entry?.unread ?? 0, loaded: !!entry?.loaded, ringing: entry?.ringing || null, audible: !!entry?.audible };
    });
  }

  state() {
    return { accounts: this.list(), activeId: this.activeId };
  }

  totalUnread() {
    return this.list().reduce((n, a) => n + (a.muted ? 0 : a.unread), 0);
  }

  persist() {
    this.store.set('accounts', this.accounts);
    this.store.set('activeId', this.activeId);
  }

  changed() {
    this.persist();
    this.emit('change', this.state());
  }

  // ---------- views ----------

  mount(account) {
    const partition = partitionOf(account.id);
    configureSession(session.fromPartition(partition), { spellLanguages: this.settings.spellLanguages });
    const view = new WebContentsView({
      webPreferences: {
        partition,
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false, // mensagens, toques de chamada e áudio continuam com a conta em segundo plano
        spellcheck: true,
      },
    });
    view.setBackgroundColor(BG);
    if (typeof view.setBorderRadius === 'function') view.setBorderRadius(FRAME_RADIUS);
    const entry = { view, unread: 0, loaded: false, ringing: null, audible: false };
    this.entries.set(account.id, entry);

    const wc = view.webContents;
    wc.setUserAgent(USER_AGENT);
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => {
      if (url.startsWith(WA_ORIGIN) || url.startsWith('data:')) return;
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    });
    // O WhatsApp Web põe as não lidas no título: "(3) WhatsApp"
    wc.on('page-title-updated', (_event, title) => {
      const match = /^\((\d+)\)/.exec(title);
      const unread = match ? Number(match[1]) : 0;
      if (unread !== entry.unread) {
        entry.unread = unread;
        this.emit('change', this.state());
      }
    });
    wc.on('did-finish-load', () => {
      entry.loaded = true;
      this.pushMuted(account.id);
      this.emit('change', this.state());
    });
    wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 = navegação abortada (normal)
      wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(offlineHtml(description)));
    });
    wc.on('render-process-gone', (_event, details) => {
      if (details.reason !== 'clean-exit') setTimeout(() => !wc.isDestroyed() && wc.loadURL(WA_URL), 1000);
    });
    // Som tocando na conta (toque de chamada, mensagem, áudio): pontinho no avatar quando ela não é a ativa
    wc.on('audio-state-changed', (event) => {
      if (entry.audible === !!event.audible) return;
      entry.audible = !!event.audible;
      this.emit('change', this.state());
    });
    wc.on('context-menu', (_event, params) => this.showPageContextMenu(wc, params));

    this.win.contentView.addChildView(view);
    wc.loadURL(WA_URL);
    return entry;
  }

  layout() {
    if (!this.win || this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    // A view fica dentro da moldura; o renderer desenha borda e sombra 1px por fora dela (.frame)
    const bounds = { x: RAIL_WIDTH + FRAME_MARGIN, y: FRAME_MARGIN, width: Math.max(0, width - RAIL_WIDTH - FRAME_MARGIN * 2), height: Math.max(0, height - FRAME_MARGIN * 2) };
    for (const { view } of this.entries.values()) view.setBounds(bounds);
  }

  applyVisibility() {
    const showViews = !this.modalOpen;
    for (const [id, { view }] of this.entries) view.setVisible(showViews && id === this.activeId);
    if (showViews) this.focusActive();
  }

  focusActive() {
    if (this.modalOpen) return;
    const wc = this.activeWebContents();
    if (wc && this.win.isFocused()) wc.focus();
  }

  setModalOpen(open) {
    this.modalOpen = !!open;
    this.applyVisibility();
  }

  activeWebContents() {
    const entry = this.activeId ? this.entries.get(this.activeId) : null;
    return entry && !entry.view.webContents.isDestroyed() ? entry.view.webContents : null;
  }

  idOf(webContents) {
    for (const [id, { view }] of this.entries) if (view.webContents === webContents) return id;
    return null;
  }

  // ---------- ações ----------

  select(id) {
    if (!this.find(id) || id === this.activeId) return;
    this.activeId = id;
    this.applyVisibility();
    this.changed();
  }

  selectIndex(index) {
    const account = this.accounts[index];
    if (account) this.select(account.id);
  }

  cycle(delta) {
    if (this.accounts.length < 2) return;
    const current = Math.max(0, this.accounts.findIndex((a) => a.id === this.activeId));
    this.selectIndex((current + delta + this.accounts.length) % this.accounts.length);
  }

  add(data) {
    const used = new Set(this.accounts.map((a) => a.color));
    const freeColor = ACCOUNT_COLORS.find((c) => !used.has(c)) || ACCOUNT_COLORS[this.accounts.length % ACCOUNT_COLORS.length];
    const { name, color } = sanitizeAccount(data, { color: freeColor });
    const account = { id: crypto.randomUUID(), name: name || `Conta ${this.accounts.length + 1}`, color, muted: false, createdAt: new Date().toISOString() };
    this.accounts.push(account);
    this.mount(account);
    this.layout();
    this.activeId = account.id;
    this.applyVisibility();
    this.changed();
    return account;
  }

  update(id, patch = {}) {
    const account = this.find(id);
    if (!account) return null;
    if (patch.name != null || patch.color != null) Object.assign(account, sanitizeAccount({ name: patch.name ?? account.name, color: patch.color ?? account.color }, account));
    if (!account.name) account.name = 'Conta';
    if (patch.muted != null) {
      account.muted = !!patch.muted;
      this.pushMuted(id);
    }
    this.changed();
    return account;
  }

  async remove(id) {
    const index = this.accounts.findIndex((a) => a.id === id);
    if (index < 0) return;
    const entry = this.entries.get(id);
    this.accounts.splice(index, 1);
    this.entries.delete(id);
    if (entry) {
      this.win.contentView.removeChildView(entry.view);
      try {
        entry.view.webContents.close();
      } catch {}
    }
    if (this.activeId === id) this.activeId = this.accounts[Math.min(index, this.accounts.length - 1)]?.id ?? null;
    this.applyVisibility();
    this.changed();
    // Apaga a sessão vinculada (o celular desvincula o aparelho sozinho quando ele some)
    const ses = session.fromPartition(partitionOf(id));
    try {
      await ses.clearStorageData();
      await ses.clearCache();
    } catch (e) {
      console.warn('[contas] falha ao limpar a sessão:', e.message);
    }
  }

  reorder(ids) {
    if (!Array.isArray(ids)) return;
    const byId = new Map(this.accounts.map((a) => [a.id, a]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    if (ordered.length !== this.accounts.length) return;
    this.accounts = ordered;
    this.changed();
  }

  reload(id = this.activeId) {
    const entry = id ? this.entries.get(id) : null;
    if (!entry) return;
    entry.loaded = false;
    entry.view.webContents.loadURL(WA_URL);
    this.emit('change', this.state());
  }

  openInActive(url) {
    const wc = this.activeWebContents();
    if (wc && url.startsWith(WA_ORIGIN)) wc.loadURL(url);
  }

  zoom(delta) {
    const wc = this.activeWebContents();
    if (!wc) return;
    wc.setZoomLevel(delta === 0 ? 0 : Math.max(-3, Math.min(4, wc.getZoomLevel() + delta)));
  }

  devTools(id = this.activeId) {
    const entry = id ? this.entries.get(id) : null;
    if (entry) entry.view.webContents.toggleDevTools();
  }

  setRinging(id, text) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.ringing = text || 'Chamada recebida';
    this.emit('change', this.state());
  }

  clearRinging(id) {
    const entry = this.entries.get(id);
    if (!entry || !entry.ringing) return;
    entry.ringing = null;
    this.emit('change', this.state());
  }

  pushMuted(id) {
    const account = this.find(id);
    const entry = this.entries.get(id);
    if (account && entry && !entry.view.webContents.isDestroyed()) entry.view.webContents.send('wa:muted', !!account.muted);
  }

  applySpellLanguages(languages) {
    for (const account of this.accounts) applySpellLanguages(session.fromPartition(partitionOf(account.id)), languages);
  }

  /** Menu de contexto dentro do WhatsApp: correções ortográficas, links, imagens e edição. */
  showPageContextMenu(wc, params) {
    const items = [];
    if (params.misspelledWord) {
      const suggestions = (params.dictionarySuggestions || []).slice(0, 5);
      for (const word of suggestions) items.push({ label: word, click: () => wc.replaceMisspelling(word) });
      if (!suggestions.length) items.push({ label: 'Sem sugestões', enabled: false });
      items.push({ label: 'Adicionar ao dicionário', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' });
    }
    if (params.linkURL) {
      items.push(
        { label: 'Abrir link no navegador', click: () => shell.openExternal(params.linkURL) },
        { label: 'Copiar link', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' },
      );
    }
    if (params.mediaType === 'image') items.push({ label: 'Copiar imagem', click: () => wc.copyImageAt(params.x, params.y) }, { type: 'separator' });
    if (params.isEditable) {
      items.push(
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'pasteAndMatchStyle', label: 'Colar sem formatação' },
        { role: 'selectAll', label: 'Selecionar tudo' },
      );
    } else if (params.selectionText) {
      items.push(
        { role: 'copy', label: 'Copiar' },
        { label: 'Pesquisar no Google', click: () => shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(params.selectionText.trim())}`) },
      );
    }
    if (this.isDev) items.push({ type: 'separator' }, { label: 'Inspecionar', click: () => wc.inspectElement(params.x, params.y) });
    while (items.length && items[items.length - 1].type === 'separator') items.pop();
    if (!items.length) return;
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }
}

module.exports = { AccountManager, sanitizeAccount };
