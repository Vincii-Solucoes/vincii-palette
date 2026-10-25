'use strict';
// Janelinha de chamada: janela pequena, sempre no topo, no canto inferior direito da tela, com quem está ligando,
// em qual conta e os botões Recusar/Atender — independe da conta selecionada e aparece mesmo com o Palette
// escondido. Atender/recusar pedem ao preload da conta que clique no botão do próprio WhatsApp.
const path = require('node:path');
const { BrowserWindow, ipcMain, screen } = require('electron');
const { BG } = require('./constants');

const WIDTH = 392;
const HEIGHT = 120;
const MARGIN = 20;
const AUTO_HIDE = 90000; // se o preload não avisar o fim da chamada, some sozinha

const initialsOf = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

function createCallPopup({ onAction }) {
  let win = null;
  const calls = new Map(); // id da conta → { id, name, color, initials, image, text, timer }

  function ensure() {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      backgroundColor: BG,
      title: 'Ligação',
      webPreferences: { preload: path.join(__dirname, '..', 'preload', 'call.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, '..', 'renderer', 'call.html'));
    win.on('closed', () => {
      win = null;
    });
    return win;
  }

  function place(w) {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    w.setPosition(Math.round(area.x + area.width - WIDTH - MARGIN), Math.round(area.y + area.height - HEIGHT - MARGIN));
  }

  function render() {
    const current = [...calls.values()].pop();
    if (!current) {
      if (win && !win.isDestroyed() && win.isVisible()) win.hide();
      return;
    }
    const w = ensure();
    const { timer, ...payload } = current;
    const push = () => !w.isDestroyed() && w.webContents.send('call:state', { ...payload, others: calls.size - 1 });
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', push);
    else push();
    if (!w.isVisible()) {
      place(w);
      w.showInactive();
    }
  }

  const fromPopup = (event) => !!win && !win.isDestroyed() && event.sender === win.webContents;
  ipcMain.on('call:action', (event, id, action) => {
    if (!fromPopup(event)) return;
    const call = calls.get(String(id));
    if (call && ['accept', 'decline', 'open'].includes(action)) onAction(call.id, action);
  });

  const api = {
    show({ id, name, color, image, text }) {
      const prev = calls.get(id);
      if (prev) clearTimeout(prev.timer);
      calls.set(id, { id, name, color, image: image || null, initials: initialsOf(name), text: String(text || ''), timer: setTimeout(() => api.hide(id), AUTO_HIDE) });
      render();
    },
    hide(id) {
      const call = calls.get(id);
      if (!call) return;
      clearTimeout(call.timer);
      calls.delete(id);
      render();
    },
    isVisible: () => !!win && !win.isDestroyed() && win.isVisible(),
    webContents: () => (win && !win.isDestroyed() ? win.webContents : null),
  };
  return api;
}

module.exports = { createCallPopup, initialsOf };
