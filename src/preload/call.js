'use strict';
// Preload da janelinha de chamada: recebe o estado (quem liga, em qual conta) e devolve atender/recusar/abrir.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('callPopup', {
  onState: (handler) => ipcRenderer.on('call:state', (_event, state) => handler(state)),
  act: (id, action) => ipcRenderer.send('call:action', String(id), String(action)),
});
