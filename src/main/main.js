'use strict';
// Processo principal do Palette — várias contas do WhatsApp num só app (macOS, Windows e Linux).
// Uma janela: barra lateral de contas (renderer local em src/renderer) + um WebContentsView por
// conta (src/main/accounts.js) carregando o WhatsApp Web numa partition isolada.
//   Dev:    npm start        (electron .)
//   Smoke:  npm run smoke    (PALETTE_SMOKE=<pasta> PALETTE_USER_DATA=<perfil> electron . — cria uma
//           conta de teste, tira screenshots, grava smoke.json e sai)
const { app, BrowserWindow, Menu, Notification, dialog, ipcMain, nativeImage, nativeTheme, screen, session, shell, systemPreferences } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store');
const { AccountManager, sanitizeAccount } = require('./accounts');
const { buildAppMenu } = require('./menu');
const { createTray } = require('./tray');
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
const SHELL_PRELOAD = path.join(__dirname, '..', 'preload', 'shell.js');
const RENDERER_HTML = path.join(__dirname, '..', 'renderer', 'index.html');
const SMOKE_DIR = process.env.PALETTE_SMOKE ? path.resolve(process.env.PALETTE_SMOKE) : null;
const PROTOCOL = 'whatsapp';
const RELEASES_URL = 'https://github.com/Vincii-Solucoes/vincii-palette/releases/latest';

const DEFAULTS = {
  accounts: [],
  activeId: null,
  bounds: null,
  settings: { startAtLogin: false, closeToTray: true, spellLanguages: DEFAULT_SPELL_LANGUAGES, theme: 'dark' },
};

if (process.env.PALETTE_USER_DATA) app.setPath('userData', path.resolve(process.env.PALETTE_USER_DATA));
if (isWin) app.setAppUserModelId(APP_ID); // notificações do Windows exigem o mesmo id do atalho (electron-builder usa o appId)
if (isLinux) app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer'); // compartilhar tela no Wayland

let win = null;
let manager = null;
let tray = null;
let store = null;
let quitting = false;
let pendingProtocolUrl = null;
let lastUnreadTotal = 0;
let menuKey = '';

// ---------- janela ----------

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
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

  manager = new AccountManager({ win, store, isDev });
  manager.on('change', onAccountsChanged);

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

function isProtocolDefault() {
  try {
    return app.isPackaged && app.isDefaultProtocolClient(PROTOCOL);
  } catch {
    return false;
  }
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
  const key = manager.accounts.map((a) => `${a.id}:${a.name}`).join('|');
  if (!force && key === menuKey) return;
  menuKey = key;
  Menu.setApplicationMenu(
    buildAppMenu({
      accounts: manager.accounts,
      isDev,
      actions: {
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

function onAccountsChanged(state) {
  sendState();
  rebuildMenu();
  updateBadges(state);
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
    case 'protocolDefault':
      if (app.isPackaged) {
        if (value) app.setAsDefaultProtocolClient(PROTOCOL);
        else app.removeAsDefaultProtocolClient(PROTOCOL);
      }
      break;
    default:
      return fullState();
  }
  store.set('settings', settings);
  if (key === 'theme') applyTheme();
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
  ipcMain.handle('shell:ready', () => fullState());
  ipcMain.on('shell:select', (_event, id) => manager.select(String(id)));
  ipcMain.handle('shell:add', (_event, data) => manager.add(sanitizeAccount(data || {})).id);
  ipcMain.handle('shell:update', (_event, id, data) => {
    const { name, color } = sanitizeAccount(data || {}, manager.find(String(id)) || {});
    return !!manager.update(String(id), { name, color });
  });
  ipcMain.handle('shell:remove', (_event, id) => confirmRemove(String(id)));
  ipcMain.on('shell:reorder', (_event, ids) => manager.reorder(Array.isArray(ids) ? ids.map(String) : []));
  ipcMain.on('shell:reload', (_event, id) => manager.reload(String(id)));
  ipcMain.on('shell:context-menu', (_event, id) => showAccountMenu(String(id)));
  ipcMain.on('shell:modal', (_event, open) => {
    manager.setModalOpen(!!open);
    if (open && win && !win.isDestroyed()) win.webContents.focus();
  });
  ipcMain.handle('shell:set-setting', (_event, key, value) => applySetting(String(key), value));
  ipcMain.on('shell:open-privacy', () => openPrivacySettings());
  ipcMain.handle('shell:check-update', () => checkForUpdates(true));
  ipcMain.on('shell:install-update', () => installUpdate());
  ipcMain.on('shell:open-external', (_event, url) => {
    if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url));
  });
  ipcMain.on('shell:overlay', (_event, dataUrl, count) => {
    if (!isWin || !win || win.isDestroyed()) return;
    const total = Number(count) || 0;
    win.setOverlayIcon(dataUrl && total ? nativeImage.createFromDataURL(String(dataUrl)) : null, total ? `${total} não lidas` : '');
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

// ---------- atualização automática (GitHub Releases, como no Vincii Canvas) ----------
// Windows e Linux (AppImage e .deb) baixam e aplicam sozinhos; no macOS sem assinatura Apple o Squirrel
// não consegue trocar o app, então só avisamos e abrimos a página de download. Dormente em dev e nos
// builds do scripts/package-mac.sh (sem app-update.yml — só o electron-builder o gera). Verifica 8 s
// depois de abrir, a cada hora e quando a janela volta ao foco (no máximo a cada 30 min). O estado vai
// para Configurações › Sobre ("Verificar agora" / "Reiniciar e atualizar") e tudo fica em
// userData/updater.log. Diagnóstico fora do app: npm run check-update.

const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000;
const UPDATE_FOCUS_THROTTLE = 30 * 60 * 1000;
const updateState = { status: 'unsupported', version: null, percent: 0, message: '', checkedAt: null };
let autoUpdater = null;
let lastUpdateCheck = 0;

function logUpdate(...parts) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`;
  console.log('[updater]', line);
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'updater.log'), `${line}\n`);
  } catch {}
}

function setUpdateState(patch) {
  Object.assign(updateState, patch);
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
  if (updateState.status === 'checking' || updateState.status === 'downloading') return Promise.resolve({ ...updateState });
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
  try {
    autoUpdater.quitAndInstall();
  } catch (e) {
    logUpdate('quitAndInstall falhou:', e.message);
    quitting = false;
  }
}

// ---------- ciclo de vida ----------

function main() {
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
  app.on('will-quit', () => store && store.flush());
  app.on('activate', () => showWindow());
  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });

  app.whenReady().then(async () => {
    store = new Store(path.join(app.getPath('userData'), 'palette.json'), DEFAULTS);
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
