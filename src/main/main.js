'use strict';
// Processo principal do Palette — várias contas do WhatsApp num só app (macOS, Windows e Linux).
// Uma janela: barra lateral de contas (renderer local em src/renderer) + um WebContentsView por
// conta (src/main/accounts.js) carregando o WhatsApp Web numa partition isolada.
//   Dev:    npm start        (electron .)
//   Smoke:  npm run smoke    (PALETTE_SMOKE=<pasta> PALETTE_USER_DATA=<perfil> electron . — cria uma
//           conta de teste, tira screenshots, grava smoke.json e sai)
const { app, BrowserWindow, Menu, Notification, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, screen, session, shell, systemPreferences } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store');
const { AccountManager, sanitizeAccount } = require('./accounts');
const { buildAppMenu } = require('./menu');
const { createTray } = require('./tray');
const { createPicker } = require('./picker');
const { APP_NAME, APP_ID, BG, ACCOUNT_COLORS, DEFAULT_SPELL_LANGUAGES, SPELL_LANGUAGE_OPTIONS } = require('./constants');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';
const isDev = !app.isPackaged;
const ROOT = path.join(__dirname, '..', '..');
// Empacotado (electron-builder extraResources / package-mac.sh): ícone e bandeja ficam em Resources, fora
// do asar — no Linux o ícone da janela precisa ser um arquivo real para aparecer na barra de tarefas.
const RESOURCES = app.isPackaged ? process.resourcesPath : ROOT;
const ICON_PNG = path.join(RESOURCES, 'build', 'icon.png');
const TRAY_PNG = path.join(RESOURCES, 'assets', 'tray', 'tray.png');
const TRAY_UNREAD_PNG = path.join(RESOURCES, 'assets', 'tray', 'tray-unread.png');
const TOGGLE_SHORTCUT = 'CommandOrControl+Shift+W';
const SHELL_PRELOAD = path.join(__dirname, '..', 'preload', 'shell.js');
const RENDERER_HTML = path.join(__dirname, '..', 'renderer', 'index.html');
const SMOKE_DIR = process.env.PALETTE_SMOKE ? path.resolve(process.env.PALETTE_SMOKE) : null;
const PROTOCOL = 'whatsapp';
const RELEASES_URL = 'https://github.com/Vincii-Solucoes/vincii-palette/releases/latest';

const DEFAULTS = {
  accounts: [],
  activeId: null,
  bounds: null,
  settings: { startAtLogin: false, closeToTray: true, spellLanguages: DEFAULT_SPELL_LANGUAGES, theme: 'dark', switchOnCall: true, askWhereToSave: true, alwaysOnTop: false, globalShortcut: false, fileDialog: 'palette' },
};

if (process.env.PALETTE_USER_DATA) app.setPath('userData', path.resolve(process.env.PALETTE_USER_DATA));
if (isWin) app.setAppUserModelId(APP_ID); // notificações do Windows exigem o mesmo id do atalho (electron-builder usa o appId)
if (isLinux) app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer'); // compartilhar tela no Wayland

// A loja é aberta antes do "ready" porque o seletor de arquivos do Linux é escolhido por linha de comando.
const store = new Store(path.join(app.getPath('userData'), 'palette.json'), DEFAULTS);

// Seletor de arquivos no Linux (anexar/salvar): o Chromium usa o portal XDG quando a versão instalada é
// >= --xdg-portal-required-version (padrão 3); quando o serviço do portal não responde, o diálogo nunca
// aparece. "gtk" (padrão) exige uma versão impossível e força o diálogo nativo GTK/KDE; "portal" aceita
// qualquer versão; "auto" deixa o padrão do Electron. Vale a partir da próxima abertura do app.
const FILE_DIALOG_MODES = ['palette', 'gtk', 'portal', 'auto'];
// 1.2.0 trouxe o seletor do Palette: no Linux, quem vinha das 1.1.x (GTK/portal gravados nas configurações) passa
// para ele uma vez; a escolha feita depois disso em Configurações continua valendo.
if (isLinux && !(store.get('settings') || {}).pickerIntroduced) store.set('settings', { ...store.get('settings'), fileDialog: 'palette', pickerIntroduced: true });
const fileDialogMode = FILE_DIALOG_MODES.includes((store.get('settings') || {}).fileDialog) ? store.get('settings').fileDialog : 'palette';
// "palette" (padrão no Linux): o Palette desenha o próprio seletor e entrega o arquivo ao WhatsApp pelo protocolo do
// Chromium (src/main/picker.js), sem depender de GTK/portal; no macOS/Windows o seletor nativo é sempre usado.
const useOwnPicker = isLinux && fileDialogMode === 'palette';
if (isLinux && fileDialogMode === 'gtk') app.commandLine.appendSwitch('xdg-portal-required-version', '99');
if (isLinux && fileDialogMode === 'portal') app.commandLine.appendSwitch('xdg-portal-required-version', '1');

let win = null;
let manager = null;
let tray = null;
let picker = null;
let quitting = false;
let pendingProtocolUrl = null;
let lastUnreadTotal = 0;
let menuKey = '';

// ---------- janela ----------

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  if (isLinux) {
    // GNOME/KDE ignoram focus() de quem não tem a ativação do usuário (ex.: clique numa notificação):
    // passar um instante como "sempre no topo" traz a janela à frente de qualquer jeito.
    win.setAlwaysOnTop(true);
    win.focus();
    win.setAlwaysOnTop(!!(store && store.get('settings').alwaysOnTop));
  }
  win.focus();
  app.focus({ steal: true });
}

/** Atalho global para mostrar/esconder (opcional): Ctrl+Shift+W (⌃⇧W no macOS). */
function applyGlobalShortcut(enabled) {
  try {
    globalShortcut.unregister(TOGGLE_SHORTCUT);
    if (enabled && !globalShortcut.register(TOGGLE_SHORTCUT, toggleWindow)) console.warn('[atalho] não foi possível registrar', TOGGLE_SHORTCUT);
  } catch (e) {
    console.warn('[atalho]', e.message);
  }
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible() && win.isFocused()) win.hide();
  else showWindow();
}

/** Usa os limites salvos só se ainda caem num monitor ligado. */
function validBounds(saved) {
  const fallback = { width: 1200, height: 800 };
  if (!saved || !saved.width || !saved.height) return fallback;
  const rect = { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return { width: rect.width, height: rect.height };
  const visible = screen.getAllDisplays().some(({ workArea: a }) => {
    const w = Math.min(rect.x + rect.width, a.x + a.width) - Math.max(rect.x, a.x);
    const h = Math.min(rect.y + rect.height, a.y + a.height) - Math.max(rect.y, a.y);
    return w >= 120 && h >= 80;
  });
  return visible ? rect : { width: rect.width, height: rect.height };
}

let boundsTimer = null;
function saveBounds() {
  if (!win || win.isDestroyed() || SMOKE_DIR) return;
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    store.set('bounds', { ...win.getNormalBounds(), maximized: win.isMaximized() });
  }, 400);
}

function createWindow() {
  const saved = store.get('bounds');
  win = new BrowserWindow({
    ...validBounds(saved),
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: APP_NAME,
    backgroundColor: BG,
    autoHideMenuBar: !isMac, // Alt mostra o menu; os atalhos funcionam sempre
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    icon: isMac ? undefined : nativeImage.createFromPath(ICON_PNG),
    webPreferences: {
      preload: SHELL_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.loadFile(RENDERER_HTML);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  manager = new AccountManager({
    win,
    store,
    isDev,
    pickFiles: (spec) => picker.open(spec),
    pickSave: useOwnPicker || SMOKE_DIR ? (spec) => picker.save(spec) : null,
    interceptChooser: useOwnPicker || !!SMOKE_DIR, // no smoke, testa a entrega do arquivo mesmo no macOS
  });
  manager.on('change', onAccountsChanged);
  // Conta vinculada caiu para a página de QR code: avisa para o usuário vincular de novo
  manager.on('logged-out', (account) => {
    if (!account) return;
    notify(`${account.name} foi desconectada`, 'O WhatsApp pediu para vincular o aparelho de novo. Abra a conta e escaneie o QR code.', () => {
      manager.select(account.id);
      showWindow();
    });
  });

  for (const event of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(event, () => manager.layout());
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('focus', () => {
    win.flashFrame(false);
    manager.focusActive();
    maybeCheckForUpdates();
  });
  // Fechar não encerra: no macOS a janela só some (Cmd+Q sai); no Windows/Linux fica na bandeja,
  // se a opção estiver ligada. Mensagens e chamadas continuam chegando.
  win.on('close', (event) => {
    if (quitting || SMOKE_DIR) return;
    const stayAlive = isMac || (tray && store.get('settings').closeToTray !== false);
    if (!stayAlive) return;
    event.preventDefault();
    win.hide();
  });
  win.on('closed', () => {
    win = null;
  });
  if (saved && saved.maximized) win.maximize();
  rebuildMenu(true);
  updateBadges(manager.state());
}

// ---------- estado compartilhado com a barra lateral ----------

function mediaStatus() {
  if (!isMac && !isWin) return null;
  try {
    return { microphone: systemPreferences.getMediaAccessStatus('microphone'), camera: systemPreferences.getMediaAccessStatus('camera') };
  } catch {
    return null;
  }
}

// isDefaultProtocolClient consulta o sistema (no Linux roda xdg-settings): cache de 5 min, renovado ao mexer na opção
let protocolDefaultCache = { value: false, at: 0 };
function isProtocolDefault(force = false) {
  if (!app.isPackaged) return false;
  if (!force && Date.now() - protocolDefaultCache.at < 5 * 60 * 1000) return protocolDefaultCache.value;
  let value = false;
  try {
    value = app.isDefaultProtocolClient(PROTOCOL);
  } catch {}
  protocolDefaultCache = { value, at: Date.now() };
  return value;
}

function spellOptions() {
  if (isMac) return [];
  const available = new Set(session.defaultSession.availableSpellCheckerLanguages);
  return SPELL_LANGUAGE_OPTIONS.filter((l) => available.has(l));
}

function fullState() {
  return {
    ...manager.state(),
    settings: { ...store.get('settings'), theme: currentTheme(), protocolDefault: isProtocolDefault() },
    platform: process.platform,
    isPackaged: app.isPackaged,
    version: app.getVersion(),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome },
    colors: ACCOUNT_COLORS,
    spellOptions: spellOptions(),
    media: mediaStatus(),
    update: { ...updateState },
    releasesUrl: RELEASES_URL,
    linux: isLinux ? { desktop: process.env.XDG_CURRENT_DESKTOP || '', session: process.env.XDG_SESSION_TYPE || '', fileDialogActive: fileDialogMode } : null,
  };
}

function sendState() {
  if (win && !win.isDestroyed()) win.webContents.send('shell:state', fullState());
}

function sendCommand(command, arg) {
  if (!win || win.isDestroyed()) return;
  showWindow();
  win.webContents.send('shell:command', command, arg);
}

function rebuildMenu(force = false) {
  const alwaysOnTop = !!store.get('settings').alwaysOnTop;
  const key = `${manager.accounts.map((a) => `${a.id}:${a.name}`).join('|')}|top:${alwaysOnTop}`;
  if (!force && key === menuKey) return;
  menuKey = key;
  Menu.setApplicationMenu(
    buildAppMenu({
      accounts: manager.accounts,
      isDev,
      alwaysOnTop,
      actions: {
        toggleAlwaysOnTop: (checked) => applySetting('alwaysOnTop', checked),
        select: (id) => manager.select(id),
        next: () => manager.cycle(1),
        prev: () => manager.cycle(-1),
        reload: () => manager.reload(),
        zoom: (delta) => manager.zoom(delta),
        newAccount: () => sendCommand('new-account'),
        settings: () => sendCommand('settings'),
        devTools: (which) => (which === 'shell' ? win.webContents.toggleDevTools() : manager.devTools()),
        openPrivacy: openPrivacySettings,
        about: () => app.showAboutPanel(),
        quit: () => {
          quitting = true;
          app.quit();
        },
      },
    }),
  );
}

function updateBadges(state) {
  const total = state.accounts.reduce((n, a) => n + (a.muted ? 0 : a.unread), 0);
  if (isMac || isLinux) app.setBadgeCount(total);
  if (tray) tray.update(state, total);
  if (!isMac && win && !win.isDestroyed() && total > lastUnreadTotal && !win.isFocused()) win.flashFrame(true);
  lastUnreadTotal = total;
}

// Mudanças em rajada (título piscando, som) viram um único envio para a barra
let stateTimer = null;
function onAccountsChanged(state) {
  updateBadges(state);
  rebuildMenu();
  clearTimeout(stateTimer);
  stateTimer = setTimeout(sendState, 50);
}

// ---------- configurações ----------

const THEMES = ['dark', 'light', 'system'];

function currentTheme() {
  const theme = (store.get('settings') || {}).theme;
  return THEMES.includes(theme) ? theme : 'dark';
}

/** O WhatsApp Web segue o prefers-color-scheme: escuro por padrão combina com a barra e a moldura. */
function applyTheme() {
  nativeTheme.themeSource = currentTheme();
}

function setLinuxAutostart(enabled) {
  const dir = path.join(app.getPath('home'), '.config', 'autostart');
  const file = path.join(dir, 'palette.desktop');
  if (!enabled) {
    try {
      fs.unlinkSync(file);
    } catch {}
    return;
  }
  const exec = process.env.APPIMAGE || process.execPath;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=${APP_NAME}\nComment=Várias contas do WhatsApp num só app\nExec="${exec}" --hidden\nIcon=palette\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`);
}

function setAutostart(enabled) {
  if (isLinux) return setLinuxAutostart(enabled);
  if (!app.isPackaged) return; // em dev registraria o binário do Electron
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: ['--hidden'] });
}

function applySetting(key, value) {
  const settings = { ...store.get('settings') };
  switch (key) {
    case 'startAtLogin':
      settings.startAtLogin = !!value;
      setAutostart(settings.startAtLogin);
      break;
    case 'closeToTray':
      settings.closeToTray = !!value;
      break;
    case 'spellLanguages':
      settings.spellLanguages = (Array.isArray(value) ? value : []).filter((l) => SPELL_LANGUAGE_OPTIONS.includes(l));
      manager.applySpellLanguages(settings.spellLanguages);
      break;
    case 'theme':
      settings.theme = THEMES.includes(value) ? value : 'dark';
      break;
    case 'switchOnCall':
      settings.switchOnCall = !!value;
      break;
    case 'askWhereToSave':
      settings.askWhereToSave = !!value;
      break;
    case 'alwaysOnTop':
      settings.alwaysOnTop = !!value;
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(settings.alwaysOnTop);
      break;
    case 'globalShortcut':
      settings.globalShortcut = !!value;
      applyGlobalShortcut(settings.globalShortcut);
      break;
    case 'fileDialog':
      settings.fileDialog = FILE_DIALOG_MODES.includes(value) ? value : 'palette';
      if (settings.fileDialog !== fileDialogMode && win && !win.isDestroyed()) {
        dialog.showMessageBox(win, { type: 'info', title: 'Seletor de arquivos', message: 'Seletor de arquivos alterado', detail: 'A mudança vale a partir da próxima vez que o Palette abrir. Feche e abra o app para aplicar.' });
      }
      break;
    case 'protocolDefault':
      if (app.isPackaged) {
        if (value) app.setAsDefaultProtocolClient(PROTOCOL);
        else app.removeAsDefaultProtocolClient(PROTOCOL);
        isProtocolDefault(true);
      }
      break;
    default:
      return fullState();
  }
  store.set('settings', settings);
  if (key === 'theme') applyTheme();
  if (key === 'alwaysOnTop') rebuildMenu();
  sendState();
  return fullState();
}

function openPrivacySettings() {
  if (isMac) return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
  if (isWin) return shell.openExternal('ms-settings:privacy-microphone');
  return dialog.showMessageBox(win, {
    type: 'info',
    title: 'Permissões de mídia',
    message: 'Microfone e câmera no Linux',
    detail: 'O acesso é controlado pelo próprio sistema (PipeWire/PulseAudio); nenhuma autorização extra é necessária. Se a chamada ficar muda, confira o dispositivo padrão nas configurações de som.',
  });
}

// ---------- links whatsapp:// ----------

function protocolUrlFromArgv(argv) {
  return (argv || []).find((arg) => typeof arg === 'string' && arg.startsWith(`${PROTOCOL}:`)) || null;
}

/** whatsapp://send?phone=5511999999999&text=Oi → abre a conversa na conta ativa. */
function handleProtocolUrl(raw) {
  if (!manager) {
    pendingProtocolUrl = raw;
    return;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  if (url.protocol !== `${PROTOCOL}:`) return;
  const target = new URL('https://web.whatsapp.com/send/');
  for (const [key, value] of url.searchParams) target.searchParams.set(key, value);
  if (target.searchParams.has('phone')) {
    target.searchParams.set('type', 'phone_number');
    target.searchParams.set('app_absent', '0');
  }
  manager.openInActive(target.toString());
  showWindow();
}

// ---------- contas (IPC da barra lateral) ----------

async function confirmRemove(id) {
  const account = manager.find(id);
  if (!account) return false;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Remover', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    title: 'Remover conta',
    message: `Remover a conta "${account.name}"?`,
    detail: 'A sessão do WhatsApp deste computador é apagada (o celular continua normal). Para usar de novo, vincule outra vez pelo QR code.',
  });
  if (response !== 0) return false;
  await manager.remove(id);
  return true;
}

function showAccountMenu(id) {
  const account = manager.find(id);
  if (!account) return;
  Menu.buildFromTemplate([
    { label: 'Renomear ou mudar a cor…', click: () => sendCommand('edit-account', id) },
    { label: 'Recarregar', click: () => manager.reload(id) },
    { label: 'Silenciar notificações', type: 'checkbox', checked: !!account.muted, click: (item) => manager.update(id, { muted: item.checked }) },
    { type: 'separator' },
    { label: 'Remover conta…', click: () => confirmRemove(id) },
    ...(isDev ? [{ type: 'separator' }, { label: 'Inspecionar conta', click: () => manager.devTools(id) }] : []),
  ]).popup({ window: win });
}

function registerIpc() {
  // Canais shell:* só valem vindos da barra lateral (a janela principal); as views do WhatsApp não têm
  // ipcRenderer exposto, mas a checagem do remetente fecha a porta de vez.
  const fromShell = (event) => !!win && !win.isDestroyed() && event.sender === win.webContents;
  const shellHandle = (channel, handler) => ipcMain.handle(channel, (event, ...args) => (fromShell(event) ? handler(event, ...args) : null));
  const shellOn = (channel, handler) => ipcMain.on(channel, (event, ...args) => {
    if (fromShell(event)) handler(event, ...args);
  });
  const lastCallSignal = new Map(); // por conta: evita rajadas de wa:incoming-call
  picker = createPicker({ sendCommand, fromShell });
  shellHandle('shell:ready', () => fullState());
  shellOn('shell:select', (_event, id) => manager.select(String(id)));
  shellHandle('shell:add', (_event, data) => manager.add(sanitizeAccount(data || {})).id);
  shellHandle('shell:update', (_event, id, data) => !!manager.update(String(id), sanitizeAccount(data || {}, manager.find(String(id)) || {})));
  // Imagem para o avatar: diálogo do sistema → quadrado central redimensionado para 128px (PNG em data URL)
  shellHandle('shell:pick-image', async () => {
    let file = null;
    if (useOwnPicker) {
      const paths = await picker.open({ accept: 'image/png,image/jpeg', title: 'Escolher imagem' });
      file = paths && paths[0];
    } else {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Escolher imagem', properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg'] }] });
      file = !canceled && filePaths[0];
    }
    if (!file) return null;
    const image = nativeImage.createFromPath(file);
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    const side = Math.min(width, height);
    return image
      .crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
      .resize({ width: 128, height: 128, quality: 'best' })
      .toDataURL();
  });
  shellHandle('shell:remove', (_event, id) => confirmRemove(String(id)));
  shellOn('shell:reorder', (_event, ids) => manager.reorder(Array.isArray(ids) ? ids.map(String) : []));
  shellOn('shell:reload', (_event, id) => manager.reload(String(id)));
  shellOn('shell:context-menu', (_event, id) => showAccountMenu(String(id)));
  shellOn('shell:modal', (_event, open) => {
    manager.setModalOpen(!!open);
    if (open && win && !win.isDestroyed()) {
      win.webContents.focus();
      isProtocolDefault(true); // o painel de configurações mostra o valor atual
      sendState();
    }
  });
  shellHandle('shell:set-setting', (_event, key, value) => applySetting(String(key), value));
  shellOn('shell:open-privacy', () => openPrivacySettings());
  // Configurações › Notificações: dispara uma notificação de verdade (no macOS, a primeira faz o sistema pedir
  // permissão) e abre o painel de notificações do sistema para o usuário conferir/permitir
  shellHandle('shell:test-notification', () => notify('Teste do Palette', 'Se você está vendo isto, as notificações funcionam.', () => showWindow()));
  shellOn('shell:open-notification-settings', () => {
    if (isMac) shell.openExternal(`x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=${APP_ID}`);
    else if (isWin) shell.openExternal('ms-settings:notifications');
  });
  shellHandle('shell:check-update', () => checkForUpdates(true));
  // Diagnóstico do seletor de arquivos: abre o diálogo pelo processo principal (mesmo mecanismo do WhatsApp) e mede
  shellHandle('shell:test-file-dialog', async () => {
    const started = Date.now();
    if (useOwnPicker) {
      const paths = await picker.open({ accept: '', title: 'Teste do seletor do Palette' });
      return { ok: true, canceled: !paths, ms: Date.now() - started, mode: 'palette' };
    }
    const result = await Promise.race([
      dialog.showOpenDialog(win, { title: 'Teste do seletor de arquivos', buttonLabel: 'Fechar teste', properties: ['openFile'] }).then((r) => ({ ok: true, canceled: r.canceled })),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, timeout: true }), 15000)),
    ]);
    return { ...result, ms: Date.now() - started, mode: fileDialogMode };
  });
  shellOn('shell:install-update', () => installUpdate());
  shellOn('shell:open-external', (_event, url) => {
    if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url));
  });
  shellOn('shell:overlay', (_event, dataUrl, count) => {
    if (!isWin || !win || win.isDestroyed()) return;
    const total = Number(count) || 0;
    win.setOverlayIcon(dataUrl && total ? nativeImage.createFromDataURL(String(dataUrl)) : null, total ? `${total} não lidas` : '');
  });
  // Chamada recebida numa conta: marca o avatar, troca para ela (opção), traz a janela e avisa pelo sistema
  ipcMain.on('wa:incoming-call', (event, text) => {
    const id = manager.idOf(event.sender);
    const account = id && manager.find(id);
    if (!account) return;
    if (Date.now() - (lastCallSignal.get(id) || 0) < 5000) return;
    lastCallSignal.set(id, Date.now());
    const detail = String(text || '').slice(0, 120);
    manager.setRinging(id, detail);
    if (store.get('settings').switchOnCall !== false && manager.activeId !== id) manager.select(id);
    if (win && !win.isDestroyed()) {
      if (!win.isVisible()) showWindow();
      else if (!win.isFocused()) win.flashFrame(true);
    }
    if (isMac && (!win || !win.isFocused())) app.dock.bounce('critical');
    if (!win || win.isDestroyed() || !win.isFocused()) {
      notify(`Chamada recebida · ${account.name}`, detail || 'Alguém está ligando no WhatsApp.', () => {
        manager.select(id);
        showWindow();
      });
    }
  });
  ipcMain.on('wa:call-ended', (event) => {
    const id = manager.idOf(event.sender);
    if (id) manager.clearRinging(id);
  });
  ipcMain.on('wa:login-state', (event, loggedIn) => {
    const id = manager.idOf(event.sender);
    if (id) manager.setLoginState(id, loggedIn === true ? true : loggedIn === false ? false : null);
  });
  ipcMain.on('wa:profile-photo', (event, dataUrl) => {
    const id = manager.idOf(event.sender);
    if (id) manager.setPhoto(id, dataUrl);
  });
  // Clique numa notificação do WhatsApp: traz a janela e mostra a conta de origem
  ipcMain.on('wa:notification-click', (event) => {
    const id = manager.idOf(event.sender);
    if (id) manager.select(id);
    showWindow();
  });
}

// ---------- modo verificação (npm run smoke) ----------

async function runSmoke(dir) {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const shot = async (name, wc) => fs.writeFileSync(path.join(dir, name), (await wc.capturePage()).toPNG());
  const shellJs = (code) => win.webContents.executeJavaScript(code, true);
  const probe = (code) => manager.activeWebContents().executeJavaScript(code, true).catch((e) => `erro: ${e.message}`);
  const closeModal = () => shellJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  fs.mkdirSync(dir, { recursive: true });
  const info = { steps: [] };
  const step = async (name) => info.steps.push({ step: name, modalOpen: manager.modalOpen, ...(await shellJs(`({ modal: JSON.stringify(modal), contentKey, className: document.getElementById('content').className })`).catch((e) => ({ erro: e.message }))) });

  // 1. Barra lateral: boas-vindas (perfil novo), diálogo de nova conta e configurações
  if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await delay(800);
  await step('inicio');
  if (!manager.accounts.length) await shot('welcome.png', win.webContents);
  await shellJs(`document.getElementById('add').click()`);
  await delay(400);
  await shot('new-account.png', win.webContents);
  info.modalHidesViews = manager.modalOpen;
  await step('nova conta aberta');
  await closeModal();
  await delay(200);
  await step('nova conta fechada');
  await shellJs(`document.getElementById('settings').click()`);
  await delay(400);
  await shot('settings.png', win.webContents);
  await step('configuracoes abertas');
  await closeModal();
  await delay(200);
  info.modalClosed = !manager.modalOpen;
  await step('configuracoes fechadas');

  // 2. Conta de teste: o WhatsApp Web aceita o app como navegador?
  if (!manager.accounts.length) manager.add({ name: 'Conta teste', color: ACCOUNT_COLORS[1] });
  const entry = manager.entries.get(manager.activeId);
  const wc = entry.view.webContents;
  await new Promise((resolve) => {
    if (entry.loaded) return resolve();
    wc.once('did-finish-load', resolve);
    setTimeout(resolve, 25000);
  });
  await step('conta adicionada');
  await delay(8000); // o WhatsApp Web renderiza o QR code depois de carregar
  await step('whatsapp carregado');

  // 3. Gerenciador de contas: silenciar, renomear, segunda conta, alternar, reordenar, remover
  const first = manager.activeId;
  manager.update(first, { muted: true });
  await delay(300);
  info.manager = { mutedFlagInPage: await probe('window.__paletteMuted') };
  manager.update(first, { muted: false, name: 'Suporte Vincii' });
  await delay(300);
  info.manager.unmutedFlagInPage = await probe('window.__paletteMuted');
  info.manager.renamedAvatar = await shellJs(`document.querySelector('.acc.active .avatar').textContent`);
  // Barra incremental: o botão da conta sobrevive a atualizações de estado (clique em andamento não se perde)
  await shellJs(`document.querySelector('.acc.active').dataset.marker = 'mantido'`);
  manager.update(first, { muted: true });
  await delay(150);
  manager.update(first, { muted: false });
  await delay(300);
  info.manager.buttonPreserved = await shellJs(`document.querySelector('.acc.active').dataset.marker === 'mantido'`);
  info.manager.muteBadgeHidden = await shellJs(`getComputedStyle(document.querySelector('.acc.active .mute')).display === 'none' && getComputedStyle(document.querySelector('.acc.active .call')).display === 'none'`);
  // Avatares: ícone, imagem e volta às iniciais
  manager.update(first, { avatar: 'icon', icon: 'headset' });
  await delay(300);
  info.manager.iconAvatar = await shellJs(`!!document.querySelector('.acc.active .avatar svg')`);
  manager.update(first, { avatar: 'image', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==' });
  await delay(300);
  info.manager.imageAvatar = await shellJs(`!!document.querySelector('.acc.active .avatar img')`);
  manager.update(first, { avatar: 'initials', image: null });
  await delay(300);
  info.manager.backToInitials = await shellJs(`document.querySelector('.acc.active .avatar').textContent`);
  // Página de QR code: a conta é marcada como "precisa vincular"
  info.manager.loginState = manager.entries.get(first).loggedIn;
  info.manager.railWarn = await shellJs(`!!document.querySelector('.acc.active.warn-state')`);
  info.manager.loginPageProbe = await probe(`({ headings: Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]')).slice(0, 6).map((h) => h.tagName + ':' + h.textContent.trim().slice(0, 40)), dataRef: !!document.querySelector('div[data-ref]'), paneSide: !!document.querySelector('#pane-side, #side') })`);
  // Configurações › Contas: botão Editar abre o formulário e Esc volta às configurações
  await shellJs(`document.getElementById('settings').click()`);
  await delay(400);
  await shot('settings-accounts.png', win.webContents);
  info.manager.accountRows = await shellJs(`document.querySelectorAll('.account-row').length`);
  await shellJs(`document.querySelector('.account-row .btn').click()`);
  await delay(300);
  info.manager.editFromSettings = await shellJs('JSON.stringify(modal)');
  await closeModal();
  await delay(200);
  info.manager.backToSettings = await shellJs('JSON.stringify(modal)');
  await closeModal();
  await delay(200);
  info.manager.closedAgain = await shellJs('JSON.stringify(modal)');
  const second = manager.add({ name: 'Vendas', color: ACCOUNT_COLORS[3] });
  await delay(300);
  info.manager.secondActive = manager.activeId === second.id;
  manager.cycle(1);
  info.manager.cycledBackToFirst = manager.activeId === first;
  // Chamada recebida simulada na conta inativa: aviso com texto + botões, como o WhatsApp Web desenha
  const secondEntry = manager.entries.get(second.id);
  await new Promise((resolve) => {
    if (secondEntry.loaded) return resolve();
    secondEntry.view.webContents.once('did-finish-load', resolve);
    setTimeout(resolve, 25000);
  });
  await delay(1500);
  const secondJs = (code) => secondEntry.view.webContents.executeJavaScript(code, true).catch((e) => `erro: ${e.message}`);
  await secondJs(`(() => { const d = document.createElement('div'); d.id = 'palette-fake-call'; d.innerHTML = '<p>Chamada de voz recebida</p><p>Fulano</p><button aria-label="Aceitar">Aceitar</button><button>Recusar</button>'; document.body.appendChild(d); return true; })()`);
  await delay(800);
  await shot('ringing.png', win.webContents);
  info.call = {
    ringing: secondEntry.ringing,
    switchedToSecond: manager.activeId === second.id,
    railRinging: await shellJs(`!!document.querySelector('.acc.ringing')`),
  };
  await secondJs(`document.getElementById('palette-fake-call').remove()`);
  await delay(2500);
  info.call.clearedAfterRemove = !secondEntry.ringing;
  info.call.railCleared = await shellJs(`!document.querySelector('.acc.ringing')`);
  manager.select(first);
  manager.reorder([second.id, first]);
  await delay(300);
  info.manager.order = manager.accounts.map((a) => a.name).join(',');
  info.manager.railOrder = await shellJs(`[...document.querySelectorAll('.acc .avatar')].map((e) => e.textContent).join(',')`);
  info.manager.visibleViews = [...manager.entries.values()].filter(({ view }) => view.getVisible()).length;
  info.manager.childrenBeforeRemove = win.contentView.children.length;
  await manager.remove(second.id);
  await delay(300);
  info.manager.afterRemove = { accounts: manager.accounts.length, entries: manager.entries.size, children: win.contentView.children.length, active: (manager.find(manager.activeId) || {}).name };
  await step('gerenciador testado');

  // 4. Seletor do Palette: <input type=file> da página abre o diálogo da barra; a escolha chega ao input via protocolo
  info.picker = await smokePicker({ dir, wc, shellJs, probe, shot, delay }).catch((e) => ({ erro: e.message }));
  await step('seletor testado');
  info.url = wc.getURL();
  info.page = await probe(`(() => ({
    title: document.title,
    ua: navigator.userAgent,
    patched: !!window.__palettePatched,
    notificationIsPatched: typeof Notification === 'function' && Notification.name === 'PaletteNotification',
    notificationPermission: typeof Notification === 'undefined' ? 'n/a' : Notification.permission,
    prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    hasCanvas: !!document.querySelector('canvas'),
    text: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 500),
  }))()`);
  info.devices = await probe(`navigator.mediaDevices.enumerateDevices().then((d) => d.map((x) => x.kind))`);
  info.permissions = {};
  for (const name of ['microphone', 'camera', 'notifications']) info.permissions[name] = await probe(`navigator.permissions.query({ name: '${name}' }).then((p) => p.state)`);
  info.shell = await shellJs(`(() => ({ accounts: document.querySelectorAll('.acc').length, active: (document.querySelector('.acc.active') || {}).title || null, content: document.getElementById('content').className, modal: JSON.stringify(modal), modalLog }))()`).catch((e) => `erro: ${e.message}`);
  await shot('account.png', wc);
  await shot('shell.png', win.webContents);
  fs.writeFileSync(path.join(dir, 'smoke.json'), JSON.stringify(info, null, 2));
  console.log('[smoke]', JSON.stringify(info, null, 2));
}

async function smokePicker({ dir, wc, shellJs, probe, shot, delay }) {
  const result = {};
  const waitFor = async (code, timeout = 6000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (await shellJs(code)) return true;
      await delay(100);
    }
    return false;
  };
  // build/icon.png fica fora do asar: na árvore do projeto (dev) ou em resources/build (extraResources, app empacotado)
  const source = [path.join(__dirname, '..', '..', 'build', 'icon.png'), path.join(process.resourcesPath || '', 'build', 'icon.png')].find((p) => fs.existsSync(p));
  const file = path.join(dir, 'smoke-icon.png');
  if (source) fs.copyFileSync(source, file);
  result.attached = wc.debugger.isAttached();
  // No Linux o preload já apagou a File System Access API; nos outros sistemas confere que o delete funciona neste Chromium
  result.fsaAbsentAfterDelete = await probe(`(() => { try { delete window.showOpenFilePicker; } catch (e) { return 'erro: ' + e.message; } return !('showOpenFilePicker' in window); })()`);
  if (!fs.existsSync(file) || !result.attached) return result;
  // Abrir: o clique no input (com gesto de usuário) deve abrir o diálogo da barra, e não o do sistema
  await probe(`(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'palette-smoke-file'; i.accept = 'image/*,video/mp4'; document.body.appendChild(i); i.click(); return true; })()`);
  result.dialogOpened = await waitFor(`!!document.querySelector('.panel.picker')`);
  if (!result.dialogOpened) return result;
  result.title = await shellJs(`document.querySelector('.panel.picker h2').textContent`);
  result.modalHidesViews = manager.modalOpen;
  await shot('picker.png', win.webContents);
  // Navega como o usuário: lugar "Início" e duplo clique pasta a pasta até a pasta do arquivo
  const home = app.getPath('home');
  const rel = path.relative(home, path.dirname(file));
  const segments = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep) : null;
  if (segments) {
    await shellJs(`[...document.querySelectorAll('.panel.picker .chip')].find((c) => c.textContent === 'Início').click()`);
    await waitFor(`document.querySelector('.picker-path').textContent === ${JSON.stringify(home)}`);
    let current = home;
    for (const segment of segments) {
      current = path.join(current, segment);
      const found = await waitFor(`!!document.querySelector('.picker-row[title=' + JSON.stringify(${JSON.stringify(segment)}) + ']')`, 3000);
      if (!found) break;
      await shellJs(`document.querySelector('.picker-row[title=' + JSON.stringify(${JSON.stringify(segment)}) + ']').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
      await waitFor(`document.querySelector('.picker-path').textContent === ${JSON.stringify(current)}`);
    }
    result.navigatedTo = await shellJs(`document.querySelector('.picker-path').textContent`);
    result.listed = await shellJs(`document.querySelectorAll('.picker-row').length`);
    result.onlyImagesAndVideos = await shellJs(`[...document.querySelectorAll('.picker-row')].every((r) => r.querySelector('svg path[d^="M22"]') || /\\.(png|jpe?g|gif|webp|bmp|heic|heif|avif|svg|mp4)$/i.test(r.title))`);
    await shellJs(`document.querySelector('.picker-all').click()`);
    await waitFor(`document.querySelectorAll('.picker-row').length > ${result.listed}`, 3000);
    result.listedAll = await shellJs(`document.querySelectorAll('.picker-row').length`);
    await shellJs(`document.querySelector('.picker-all').click()`);
    await waitFor(`document.querySelectorAll('.picker-row').length === ${result.listed}`, 3000);
    await shellJs(`document.querySelector('.picker-row[title="smoke-icon.png"]').click()`);
    result.chooseEnabled = await shellJs(`!document.querySelector('.panel.picker .btn.primary').disabled`);
    await shellJs(`document.querySelector('.panel.picker .btn.primary').click()`);
  } else {
    await shellJs(`window.palette.pickerResult(${JSON.stringify([file])})`);
    await shellJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  }
  result.dialogClosed = await waitFor(`!document.querySelector('.panel.picker')`);
  await delay(600);
  result.delivered = await probe(`(() => { const i = document.getElementById('palette-smoke-file'); return { count: i.files.length, name: i.files[0] && i.files[0].name, size: i.files[0] && i.files[0].size }; })()`);
  result.modalClosed = !manager.modalOpen;
  // Cancelar: Esc fecha sem entregar nada
  await probe(`document.getElementById('palette-smoke-file').click()`);
  await waitFor(`!!document.querySelector('.panel.picker')`);
  await shellJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  result.cancelClosed = await waitFor(`!document.querySelector('.panel.picker')`);
  await delay(300);
  result.keptAfterCancel = await probe(`document.getElementById('palette-smoke-file').files.length`);
  // Salvar: nome sugerido editável, "Salvar aqui" devolve o caminho na pasta mostrada
  const savePromise = picker.save({ suggestedName: 'palette-teste.txt' });
  await waitFor(`!!document.querySelector('.panel.picker input.input')`);
  await shot('picker-save.png', win.webContents);
  await shellJs(`(() => { const i = document.querySelector('.panel.picker input.input'); i.value = 'palette-smoke.txt'; return true; })()`);
  const shownDir = await shellJs(`document.querySelector('.picker-path').textContent`);
  await shellJs(`document.querySelector('.panel.picker .btn.primary').click()`);
  const saved = await Promise.race([savePromise, delay(5000).then(() => 'timeout')]);
  result.save = { shownDir, saved, ok: saved === path.join(shownDir, 'palette-smoke.txt') };
  await probe(`document.getElementById('palette-smoke-file').remove()`);
  // Download pela página (como "baixar" no WhatsApp): vai para o temporário e o diálogo pergunta o destino
  const downloaded = path.join(dir, 'download-smoke.txt');
  fs.rmSync(downloaded, { force: true });
  await probe(`(() => { const a = document.createElement('a'); a.href = 'data:text/plain,palette%20smoke'; a.download = 'download-smoke.txt'; document.body.appendChild(a); a.click(); a.remove(); return true; })()`);
  result.download = { dialog: await waitFor(`!!document.querySelector('.panel.picker input.input')`, 8000) };
  if (result.download.dialog) {
    result.download.suggested = await shellJs(`document.querySelector('.panel.picker input.input').value`);
    const relOut = path.relative(home, dir);
    if (relOut && !relOut.startsWith('..')) {
      await shellJs(`[...document.querySelectorAll('.panel.picker .chip')].find((c) => c.textContent === 'Início').click()`);
      await waitFor(`document.querySelector('.picker-path').textContent === ${JSON.stringify(home)}`);
      let current = home;
      for (const segment of relOut.split(path.sep)) {
        current = path.join(current, segment);
        if (!(await waitFor(`!!document.querySelector('.picker-row[title=' + JSON.stringify(${JSON.stringify(segment)}) + ']')`, 3000))) break;
        await shellJs(`document.querySelector('.picker-row[title=' + JSON.stringify(${JSON.stringify(segment)}) + ']').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
        await waitFor(`document.querySelector('.picker-path').textContent === ${JSON.stringify(current)}`);
      }
    }
    result.download.dirShown = await shellJs(`document.querySelector('.picker-path').textContent`);
    await shellJs(`document.querySelector('.panel.picker .btn.primary').click()`);
    await waitFor(`!document.querySelector('.panel.picker')`);
    const until = Date.now() + 5000;
    while (Date.now() < until && !fs.existsSync(downloaded)) await delay(100);
    result.download.saved = fs.existsSync(downloaded) && fs.readFileSync(downloaded, 'utf8') === 'palette smoke';
    result.download.tempCleared = !fs.existsSync(path.join(app.getPath('temp'), 'palette-downloads', 'download-smoke.txt'));
  }
  return result;
}

// ---------- atualização automática (GitHub Releases, como no Vincii Canvas) ----------
// Windows e Linux (AppImage e .deb) baixam e aplicam sozinhos; no macOS sem assinatura Apple o Squirrel
// não consegue trocar o app, então só avisamos e abrimos a página de download. Dormente em dev e nos
// builds do scripts/package-mac.sh (sem app-update.yml — só o electron-builder o gera). Verifica 8 s
// depois de abrir, a cada hora e quando a janela volta ao foco (no máximo a cada 30 min). O estado vai
// para Configurações › Sobre ("Verificar agora" / "Reiniciar e atualizar") e tudo fica em
// userData/updater.log. Diagnóstico fora do app: npm run check-update.

const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000;
const UPDATE_FOCUS_THROTTLE = 30 * 60 * 1000;
const updateState = { status: 'unsupported', version: null, percent: 0, message: '', checkedAt: null, since: 0 };
let autoUpdater = null;
let lastUpdateCheck = 0;
let updateWatchdog = null;

function logUpdate(...parts) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`;
  console.log('[updater]', line);
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'updater.log'), `${line}\n`);
  } catch {}
}

function setUpdateState(patch) {
  if (patch.status && patch.status !== updateState.status) updateState.since = Date.now();
  Object.assign(updateState, patch);
  // Vigia: verificação ou download que não andam viram erro (e liberam o botão) em vez de ficar "Verificando…" para sempre
  clearTimeout(updateWatchdog);
  if (updateState.status === 'checking') updateWatchdog = setTimeout(() => setUpdateState({ status: 'error', message: 'a verificação não respondeu em 90 s' }), 90000);
  if (updateState.status === 'downloading') updateWatchdog = setTimeout(() => setUpdateState({ status: 'error', message: 'o download parou' }), 3 * 60 * 1000);
  sendState();
}

const windowVisible = () => !!win && !win.isDestroyed() && win.isVisible();

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return false;
  const notification = new Notification({ title, body });
  notification.on('click', onClick);
  notification.show();
  return true;
}

function setupAutoUpdate() {
  if (!app.isPackaged || !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    logUpdate('electron-updater indisponível:', e.message);
    return;
  }
  autoUpdater.autoDownload = !isMac;
  autoUpdater.autoInstallOnAppQuit = !isMac;
  autoUpdater.logger = { info: (m) => logUpdate('info', m), warn: (m) => logUpdate('warn', m), error: (m) => logUpdate('error', m), debug: () => {} };
  updateState.status = 'idle';
  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking', message: '' }));
  autoUpdater.on('update-not-available', (info) => setUpdateState({ status: 'up-to-date', version: info && info.version, checkedAt: Date.now() }));
  autoUpdater.on('update-available', (info) => {
    setUpdateState({ status: isMac ? 'available' : 'downloading', version: info && info.version, percent: 0, checkedAt: Date.now() });
    if (isMac) offerDownload();
  });
  autoUpdater.on('download-progress', (progress) => setUpdateState({ status: 'downloading', percent: Math.round((progress && progress.percent) || 0) }));
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({ status: 'downloaded', version: (info && info.version) || updateState.version, percent: 100 });
    promptRestart();
  });
  autoUpdater.on('error', (err) => setUpdateState({ status: 'error', message: (err && err.message) || String(err), checkedAt: Date.now() }));
  setTimeout(() => checkForUpdates(), 8000);
  setInterval(() => checkForUpdates(), UPDATE_CHECK_INTERVAL);
}

/** Dispara a verificação; `manual` (botão) repete o aviso se a atualização já estiver baixada. */
function checkForUpdates(manual = false) {
  if (!autoUpdater) return Promise.resolve({ ...updateState });
  if (updateState.status === 'downloaded') {
    if (manual) promptRestart();
    return Promise.resolve({ ...updateState });
  }
  const stale = Date.now() - (updateState.since || 0) > 60000;
  if ((updateState.status === 'checking' || updateState.status === 'downloading') && !(manual && stale)) return Promise.resolve({ ...updateState });
  lastUpdateCheck = Date.now();
  return autoUpdater
    .checkForUpdates()
    .then(() => ({ ...updateState }))
    .catch((e) => {
      setUpdateState({ status: 'error', message: (e && e.message) || String(e), checkedAt: Date.now() });
      return { ...updateState };
    });
}

function maybeCheckForUpdates() {
  if (autoUpdater && Date.now() - lastUpdateCheck > UPDATE_FOCUS_THROTTLE) checkForUpdates();
}

/** macOS: só avisa e leva à página de download. */
async function offerDownload() {
  const version = updateState.version || '';
  if (!windowVisible()) {
    notify('Nova versão do Palette', `Palette ${version} está disponível. Clique para baixar.`, () => shell.openExternal(RELEASES_URL));
    return;
  }
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    buttons: ['Baixar', 'Depois'],
    defaultId: 0,
    cancelId: 1,
    title: 'Nova versão do Palette',
    message: `Palette ${version} está disponível.`,
    detail: 'Vamos abrir a página de download. Instale por cima da versão atual; as contas continuam vinculadas.',
  });
  if (response === 0) shell.openExternal(RELEASES_URL);
}

/** Windows/Linux: atualização baixada — pergunta se reinicia agora (janela na bandeja: aviso do sistema). */
async function promptRestart() {
  const version = updateState.version || '';
  if (!windowVisible()) {
    notify('Atualização do Palette pronta', `Versão ${version} baixada. Clique para reiniciar e atualizar; ela também entra quando você fechar o app.`, () => installUpdate());
    return;
  }
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    buttons: ['Reiniciar e atualizar', 'Depois'],
    defaultId: 0,
    cancelId: 1,
    title: 'Atualização pronta',
    message: `Palette ${version} foi baixado.`,
    detail: 'Reiniciar agora para aplicar? A atualização também entra quando você fechar o app.',
  });
  if (response === 0) installUpdate();
}

function installUpdate() {
  if (!autoUpdater || updateState.status !== 'downloaded') return;
  quitting = true;
  // Se o app continuar aberto, a instalação não aconteceu (senha cancelada, pkexec ausente, AppImage sem permissão…)
  const guard = setTimeout(() => {
    quitting = false;
    logUpdate('instalação não concluiu em 10 s');
    setUpdateState({ status: 'error', message: 'a instalação não foi concluída (senha cancelada ou sistema sem suporte); baixe o instalador' });
  }, 10000);
  try {
    autoUpdater.quitAndInstall();
  } catch (e) {
    clearTimeout(guard);
    logUpdate('quitAndInstall falhou:', e.message);
    quitting = false;
    setUpdateState({ status: 'error', message: e.message });
  }
}

// ---------- ciclo de vida ----------

function main() {
  // Endurecimento global: nenhum webContents abre janelas novas (links http(s) vão para o navegador) nem anexa <webview>
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  });
  app.on('second-instance', (_event, argv) => {
    const url = protocolUrlFromArgv(argv);
    if (url) handleProtocolUrl(url);
    showWindow();
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleProtocolUrl(url);
  });
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (store) store.flush();
  });
  app.on('activate', () => showWindow());
  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });

  app.whenReady().then(async () => {
    applyTheme();
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      copyright: '© Vincii',
      credits: 'Várias contas do WhatsApp num só app, com chamadas de voz e vídeo.',
      iconPath: ICON_PNG,
    });
    if (isMac && isDev && fs.existsSync(ICON_PNG)) app.dock.setIcon(ICON_PNG);

    registerIpc();
    createWindow();

    if (!isMac) {
      try {
        tray = createTray({
          iconPath: TRAY_PNG,
          unreadIconPath: TRAY_UNREAD_PNG,
          onToggle: toggleWindow,
          onShow: showWindow,
          onSelect: (id) => {
            manager.select(id);
            showWindow();
          },
          onQuit: () => {
            quitting = true;
            app.quit();
          },
        });
        tray.update(manager.state(), manager.totalUnread());
      } catch (e) {
        console.warn('[bandeja] indisponível:', e.message);
      }
    }

    if (!SMOKE_DIR) setupAutoUpdate();
    // macOS: a permissão de notificações é pedida na primeira notificação do app. Disparamos uma de boas-vindas na
    // primeira abertura, com o usuário presente, para ele responder "Permitir" na hora — um pedido deixado sem
    // resposta (app fechado antes) deixa o bundle recusado dali em diante (ver AGENTS.md).
    if (isMac && !SMOKE_DIR && !store.get('notifyIntroduced') && !process.env.PALETTE_TEST_NOTIFY && !process.env.PALETTE_TEST_NOTIFY_CLICK) {
      setTimeout(() => {
        store.set('notifyIntroduced', true);
        notify('Notificações do Palette ativadas', 'As mensagens do WhatsApp vão aparecer aqui. Se o macOS perguntar, escolha Permitir.', () => showWindow());
      }, 5000);
    }
    if (store.get('settings').alwaysOnTop) win.setAlwaysOnTop(true);
    if (!SMOKE_DIR) applyGlobalShortcut(!!store.get('settings').globalShortcut);

    let openedAtLogin = false;
    try {
      const login = app.getLoginItemSettings();
      openedAtLogin = !!(login.wasOpenedAsHidden || login.wasOpenedAtLogin);
    } catch {}
    const startHidden = !SMOKE_DIR && (process.argv.includes('--hidden') || (isMac && openedAtLogin));
    win.once('ready-to-show', () => {
      if (!startHidden) win.show();
    });

    const initialUrl = protocolUrlFromArgv(process.argv) || pendingProtocolUrl;
    if (initialUrl) handleProtocolUrl(initialUrl);

    // Diagnósticos no macOS não encerram sozinhos: se o pedido de permissão de notificações estiver na tela e o app
    // sair antes da resposta, o sistema passa a recusar o bundle. PALETTE_TEST_EXIT=1 força a saída.
    const finishDiag = (code = 0) => {
      if (isMac && !process.env.PALETTE_TEST_EXIT) return console.log('[diag] macOS: o app fica aberto (responda ao pedido de permissão, se houver); PALETTE_TEST_EXIT=1 encerra sozinho.');
      app.exit(code);
    };

    // PALETTE_TEST_NOTIFY=1: diagnóstico de notificações — minimiza a janela, dispara uma notificação pelo
    // processo principal e outra pela página da conta ativa (HTML5, o caminho que o WhatsApp Web usa) e
    // registra o estado da página (foco/visibilidade) e o resultado de cada uma.
    if (process.env.PALETTE_TEST_NOTIFY) {
      const entry = manager.entries.get(manager.activeId);
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const test = async () => {
        const wc = entry.view.webContents;
        await wait(3000);
        console.log('[notify-test] Notification.isSupported:', Notification.isSupported());
        win.minimize();
        await wait(1500);
        const state = await wc.executeJavaScript(`({ hidden: document.hidden, visibility: document.visibilityState, hasFocus: document.hasFocus(), permission: Notification.permission, patched: !!window.__palettePatched })`, true).catch((e) => String(e));
        console.log('[notify-test] página com a janela minimizada:', JSON.stringify(state));
        const main = new Notification({ title: 'Palette (processo principal)', body: 'Teste com a janela minimizada' });
        main.on('show', () => console.log('[notify-test] principal: show'));
        main.on('failed', (_event, error) => console.log('[notify-test] principal: failed', error));
        main.show();
        const page = await wc
          .executeJavaScript(`new Promise((resolve) => { try { const n = new Notification('Palette (página)', { body: 'Teste HTML5 com a janela minimizada' }); n.onshow = () => resolve('show'); n.onerror = () => resolve('error'); n.onclose = () => resolve('close'); setTimeout(() => resolve('sem evento em 4 s'), 4000); } catch (e) { resolve('exceção: ' + e.message); } })`, true)
          .catch((e) => String(e));
        console.log('[notify-test] página:', page);
        await wait(3000);
        // macOS (Electron ≥ 42): o que o Notification Center de fato entregou para este app
        if (typeof Notification.getHistory === 'function') {
          const history = await Notification.getHistory().catch((e) => `erro: ${e.message}`);
          console.log('[notify-test] histórico do Notification Center:', Array.isArray(history) ? JSON.stringify(history.map((n) => n.title)) : history);
        }
        win.restore();
        console.log('[notify-test] fim');
        finishDiag(0);
      };
      if (entry) {
        if (entry.loaded) test();
        else entry.view.webContents.once('did-finish-load', test);
      }
    }

    // PALETTE_TEST_NOTIFY_CLICK=1: diagnóstico do clique na notificação — garante duas contas, deixa a primeira
    // ativa, dispara uma notificação HTML5 pela página da SEGUNDA (o caminho do WhatsApp Web) e espera o clique
    // (wa:notification-click) por até PALETTE_TEST_NOTIFY_CLICK_WAIT ms (60 s), registrando se a conta ativa trocou
    // e se o onclick da página disparou. No Linux em container, scripts/linux-test/run-notify.sh clica via dunstctl.
    if (process.env.PALETTE_TEST_NOTIFY_CLICK) {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const log = (...args) => console.log('[notify-click]', ...args);
      const test = async () => {
        while (manager.accounts.length < 2) manager.add({ name: manager.accounts.length ? 'Segunda' : 'Primeira', color: ACCOUNT_COLORS[manager.accounts.length] });
        const [first, second] = manager.accounts;
        manager.select(first.id);
        const entry = manager.entries.get(second.id);
        const wc = entry.view.webContents;
        await new Promise((resolve) => {
          if (entry.loaded) return resolve();
          wc.once('did-finish-load', resolve);
          setTimeout(resolve, 25000);
        });
        await wait(2500);
        let clicked = null;
        ipcMain.on('wa:notification-click', (event) => {
          clicked = manager.idOf(event.sender);
          log('clique recebido da conta', clicked);
        });
        log('ativa antes:', manager.activeId, '| a notificação sai da conta', second.id, `(${second.name})`, '| janela focada:', win.isFocused());
        const shown = await wc
          .executeJavaScript(`new Promise((resolve) => { try { const n = new Notification('Palette: clique nesta notificação', { body: 'Teste do clique (conta ${second.name})' }); n.onshow = () => resolve('show'); n.onerror = () => resolve('error'); n.onclick = () => { document.title = 'palette-click-ok'; }; setTimeout(() => resolve('sem onshow em 4 s'), 4000); } catch (e) { resolve('exceção: ' + e.message); } })`, true)
          .catch((e) => `erro: ${e.message}`);
        log('notificação criada:', shown);
        const until = Date.now() + (Number(process.env.PALETTE_TEST_NOTIFY_CLICK_WAIT) || 60000);
        while (!clicked && Date.now() < until) await wait(250);
        await wait(1000);
        const pageClick = await wc.executeJavaScript('document.title', true).catch(() => '?');
        log(clicked ? 'RESULTADO: o clique chegou ao app' : 'RESULTADO: nenhum clique chegou no tempo', '| onclick da página:', pageClick === 'palette-click-ok' ? 'disparou' : 'não disparou', '| ativa depois:', manager.activeId, clicked && manager.activeId === second.id ? '(trocou para a conta certa)' : '', '| janela visível:', win.isVisible(), 'focada:', win.isFocused());
        if (typeof Notification.getHistory === 'function') {
          const history = await Notification.getHistory().catch((e) => `erro: ${e.message}`);
          log('histórico do Notification Center:', Array.isArray(history) ? JSON.stringify(history.map((n) => n.title)) : history);
        }
        finishDiag(0);
      };
      test().catch((e) => {
        log('erro:', e.message);
        finishDiag(1);
      });
    }

    // PALETTE_TEST_FILE_DIALOG=1: diagnóstico do seletor de arquivos (Linux) — abre o diálogo pelo processo
    // principal e por um <input type=file> na página da conta ativa (como o WhatsApp faz ao anexar), com
    // tempo limite, e loga ambiente e resultados; quem chama tira screenshots da tela enquanto isso.
    if (process.env.PALETTE_TEST_FILE_DIALOG) {
      const entry = manager.entries.get(manager.activeId);
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const test = async () => {
        const wc = entry.view.webContents;
        await wait(3000);
        console.log('[dialog-test] ambiente:', JSON.stringify({ platform: process.platform, electron: process.versions.electron, fileDialogMode, XDG_CURRENT_DESKTOP: process.env.XDG_CURRENT_DESKTOP, XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE, ozone: process.env.ELECTRON_OZONE_PLATFORM_HINT, args: process.argv.slice(1) }));
        const main = await Promise.race([
          dialog.showOpenDialog(win, { title: 'Teste (main)', properties: ['openFile'] }).then((r) => ({ shown: true, canceled: r.canceled })),
          wait(8000).then(() => ({ shown: 'sem resposta em 8 s' })),
        ]);
        console.log('[dialog-test] main dialog:', JSON.stringify(main));
        const page = await wc
          .executeJavaScript(`new Promise((resolve) => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*,video/*'; input.style.position = 'fixed'; document.body.appendChild(input); let done = false; input.addEventListener('change', () => { done = true; resolve('change: ' + input.files.length + ' arquivo(s)'); }); input.addEventListener('cancel', () => { done = true; resolve('cancel'); }); input.click(); setTimeout(() => { if (!done) resolve('sem evento em 8 s'); }, 8000); })`, true)
          .catch((e) => 'erro: ' + e.message);
        console.log('[dialog-test] página <input type=file>:', page);
        await wait(1000);
        console.log('[dialog-test] fim');
        app.exit(0);
      };
      if (entry) {
        if (entry.loaded) test();
        else entry.view.webContents.once('did-finish-load', test);
      }
    }

    if (SMOKE_DIR) {
      try {
        await runSmoke(SMOKE_DIR);
        app.exit(0);
      } catch (e) {
        console.error('[smoke] falhou:', e);
        app.exit(1);
      }
    }
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else main();
