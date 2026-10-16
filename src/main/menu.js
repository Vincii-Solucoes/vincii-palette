'use strict';
// Menu da aplicação (atalhos de teclado funcionam mesmo com a barra de menus escondida no Windows/Linux).
const { Menu, app, shell } = require('electron');

const isMac = process.platform === 'darwin';

function buildAppMenu({ accounts, actions, isDev }) {
  const accountItems = accounts.slice(0, 9).map((account, i) => ({
    label: account.name,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: () => actions.select(account.id),
  }));
  const settingsItem = { label: 'Configurações…', accelerator: 'CmdOrCtrl+,', click: actions.settings };

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: 'Sobre o Palette' },
              { type: 'separator' },
              settingsItem,
              { type: 'separator' },
              { role: 'services', label: 'Serviços' },
              { type: 'separator' },
              { role: 'hide', label: 'Ocultar Palette' },
              { role: 'hideOthers', label: 'Ocultar outros' },
              { role: 'unhide', label: 'Mostrar todos' },
              { type: 'separator' },
              { role: 'quit', label: 'Sair do Palette' },
            ],
          },
        ]
      : []),
    {
      label: 'Conta',
      submenu: [
        { label: 'Nova conta…', accelerator: 'CmdOrCtrl+Shift+N', click: actions.newAccount },
        { label: 'Recarregar conta', accelerator: 'CmdOrCtrl+R', click: actions.reload },
        { type: 'separator' },
        { label: 'Próxima conta', accelerator: 'Control+Tab', click: actions.next },
        { label: 'Conta anterior', accelerator: 'Control+Shift+Tab', click: actions.prev },
        ...(accountItems.length ? [{ type: 'separator' }, ...accountItems] : []),
        ...(isMac ? [] : [{ type: 'separator' }, settingsItem, { type: 'separator' }, { label: 'Sair', accelerator: 'CmdOrCtrl+Q', click: actions.quit }]),
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'pasteAndMatchStyle', label: 'Colar sem formatação' },
        { role: 'delete', label: 'Apagar' },
        { role: 'selectAll', label: 'Selecionar tudo' },
        ...(isMac ? [{ type: 'separator' }, { label: 'Fala', submenu: [{ role: 'startSpeaking', label: 'Começar a falar' }, { role: 'stopSpeaking', label: 'Parar de falar' }] }] : []),
      ],
    },
    {
      label: 'Visualizar',
      submenu: [
        { label: 'Aumentar', accelerator: 'CmdOrCtrl+=', click: () => actions.zoom(0.5) },
        { label: 'Diminuir', accelerator: 'CmdOrCtrl+-', click: () => actions.zoom(-0.5) },
        { label: 'Tamanho real', accelerator: 'CmdOrCtrl+0', click: () => actions.zoom(0) },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
        ...(isDev
          ? [
              { type: 'separator' },
              { label: 'Ferramentas do desenvolvedor (conta)', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: () => actions.devTools('account') },
              { label: 'Ferramentas do desenvolvedor (barra)', accelerator: isMac ? 'Alt+Shift+Cmd+I' : 'Ctrl+Shift+Alt+I', click: () => actions.devTools('shell') },
            ]
          : []),
      ],
    },
    {
      label: 'Janela',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: 'Trazer tudo para a frente' }] : [{ role: 'close', label: 'Fechar' }]),
      ],
    },
    {
      label: 'Ajuda',
      role: 'help',
      submenu: [
        { label: 'Permissões de câmera e microfone…', click: actions.openPrivacy },
        { label: 'Site da Vincii', click: () => shell.openExternal('https://vincii.com.br') },
        ...(isMac ? [] : [{ type: 'separator' }, { label: 'Sobre o Palette', click: actions.about }]),
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildAppMenu };
