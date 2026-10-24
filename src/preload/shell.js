'use strict';
// Ponte da barra lateral (renderer local) com o processo principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('palette', {
  platform: process.platform,
  ready: () => ipcRenderer.invoke('shell:ready'),
  select: (id) => ipcRenderer.send('shell:select', id),
  add: (data) => ipcRenderer.invoke('shell:add', data),
  update: (id, data) => ipcRenderer.invoke('shell:update', id, data),
  remove: (id) => ipcRenderer.invoke('shell:remove', id),
  reorder: (ids) => ipcRenderer.send('shell:reorder', ids),
  reload: (id) => ipcRenderer.send('shell:reload', id),
  contextMenu: (id) => ipcRenderer.send('shell:context-menu', id),
  setModal: (open) => ipcRenderer.send('shell:modal', !!open),
  setSetting: (key, value) => ipcRenderer.invoke('shell:set-setting', key, value),
  pickImage: () => ipcRenderer.invoke('shell:pick-image'),
  openPrivacy: () => ipcRenderer.send('shell:open-privacy'),
  checkUpdate: () => ipcRenderer.invoke('shell:check-update'),
  installUpdate: () => ipcRenderer.send('shell:install-update'),
  openExternal: (url) => ipcRenderer.send('shell:open-external', url),
  setOverlay: (dataUrl, count) => ipcRenderer.send('shell:overlay', dataUrl, count),
  onState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('shell:state', listener);
    return () => ipcRenderer.removeListener('shell:state', listener);
  },
  onCommand: (handler) => {
    ipcRenderer.on('shell:command', (_event, command, arg) => handler(command, arg));
  },
});
