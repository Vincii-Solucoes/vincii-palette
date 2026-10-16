'use strict';
// Ícone na bandeja (Windows/Linux): mostra/esconde a janela, troca de conta e sai. No macOS o app
// vive no Dock (como o WhatsApp Desktop), sem ícone na barra de menus.
const { Menu, Tray, nativeImage } = require('electron');

function createTray({ iconPath, onToggle, onShow, onSelect, onQuit }) {
  let image = nativeImage.createFromPath(iconPath);
  if (process.platform === 'win32' && !image.isEmpty()) image = image.resize({ width: 16, height: 16, quality: 'best' });
  const tray = new Tray(image);
  tray.setToolTip('Palette');
  tray.on('click', onToggle);
  tray.on('double-click', onShow);

  const update = (state, total) => {
    tray.setToolTip(total ? `Palette — ${total} não lida${total > 1 ? 's' : ''}` : 'Palette');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir Palette', click: onShow },
        { type: 'separator' },
        ...state.accounts.map((a) => ({
          label: a.unread ? `${a.name} (${a.unread})` : a.name,
          type: 'radio',
          checked: a.id === state.activeId,
          click: () => onSelect(a.id),
        })),
        ...(state.accounts.length ? [{ type: 'separator' }] : []),
        { label: 'Sair do Palette', click: onQuit },
      ]),
    );
  };

  return { update, destroy: () => tray.destroy() };
}

module.exports = { createTray };
