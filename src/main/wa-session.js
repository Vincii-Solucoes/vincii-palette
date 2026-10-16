'use strict';
// Configura a sessão (partition) de cada conta do WhatsApp: user agent de Chrome, permissões de
// microfone/câmera/notificações (chamadas de voz e vídeo), compartilhamento de tela, corretor
// ortográfico e downloads direto na pasta Downloads.
const { app, desktopCapturer, systemPreferences } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { WA_ORIGIN } = require('./constants');

// O WhatsApp Web recusa "navegadores não suportados": o UA padrão do Electron traz o nome do app e
// "Electron/x.y". Enviamos o mesmo UA do Chrome da versão de Chromium embutida (o Chrome também
// congela a versão do macOS em 10_15_7).
const PLATFORM_UA = {
  darwin: 'Macintosh; Intel Mac OS X 10_15_7',
  win32: 'Windows NT 10.0; Win64; x64',
  linux: 'X11; Linux x86_64',
};
const USER_AGENT = `Mozilla/5.0 (${PLATFORM_UA[process.platform] || PLATFORM_UA.linux}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

// Só o que o WhatsApp Web precisa; o resto (geolocalização, MIDI, ...) é negado.
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'notifications',
  'clipboard-sanitized-write', // colar continua funcionando sem 'clipboard-read' (ler a área de transferência fica negado)
  'fullscreen',
  'display-capture',
  'speaker-selection',
]);

function isWhatsApp(url) {
  try {
    return new URL(url).origin === WA_ORIGIN;
  } catch {
    return false;
  }
}

/** No macOS, pede a autorização de microfone/câmera ao sistema (TCC) antes de liberar o getUserMedia. */
async function ensureMacMediaAccess(mediaTypes) {
  if (process.platform !== 'darwin') return true;
  for (const type of mediaTypes) {
    const kind = type === 'video' ? 'camera' : 'microphone';
    if (systemPreferences.getMediaAccessStatus(kind) === 'granted') continue;
    const ok = await systemPreferences.askForMediaAccess(kind);
    if (!ok) return false;
  }
  return true;
}

function applySpellLanguages(ses, languages) {
  if (process.platform === 'darwin') return; // macOS usa o corretor do sistema (detecta o idioma sozinho)
  const available = new Set(ses.availableSpellCheckerLanguages);
  const wanted = (languages || []).filter((l) => available.has(l));
  try {
    ses.setSpellCheckerLanguages(wanted.length ? wanted : ['en-US']);
  } catch (e) {
    console.warn('[spell] não foi possível definir idiomas:', e.message);
  }
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

const configured = new WeakSet();

function configureSession(ses, { spellLanguages } = {}) {
  if (configured.has(ses)) {
    applySpellLanguages(ses, spellLanguages);
    return;
  }
  configured.add(ses);

  ses.setUserAgent(USER_AGENT);

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = (details && details.requestingUrl) || webContents.getURL();
    if (!isWhatsApp(url) || !ALLOWED_PERMISSIONS.has(permission)) return callback(false);
    if (permission !== 'media') return callback(true);
    const types = details && Array.isArray(details.mediaTypes) && details.mediaTypes.length ? details.mediaTypes : ['audio', 'video'];
    ensureMacMediaAccess(types).then(
      (ok) => callback(ok),
      () => callback(false),
    );
  });
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => ALLOWED_PERMISSIONS.has(permission) && isWhatsApp(requestingOrigin));

  // Compartilhar tela numa chamada: no macOS 15+ o seletor nativo do sistema decide; nos demais
  // sistemas vai a tela principal (sem seletor de janela por enquanto).
  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          if (!sources.length) return callback({});
          const streams = { video: sources[0] };
          if (process.platform === 'win32') streams.audio = 'loopback';
          callback(streams);
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: true },
  );

  applySpellLanguages(ses, spellLanguages);

  // Downloads (fotos, documentos) vão direto para a pasta Downloads, sem diálogo, como no app oficial.
  ses.on('will-download', (_event, item) => {
    // Sem separadores, caracteres de controle ou nomes só de pontos (".." viraria a pasta de cima)
    const name = (item.getFilename() || 'arquivo').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+$/, '').trim() || 'arquivo';
    const target = uniquePath(app.getPath('downloads'), name);
    item.setSavePath(target);
    item.once('done', (_e, state) => {
      if (state === 'completed' && process.platform === 'darwin') app.dock.downloadFinished(target);
    });
  });
}

module.exports = { configureSession, applySpellLanguages, USER_AGENT };
