'use strict';
// Seletor de arquivos do Palette: a barra lateral desenha o diálogo (abrir/salvar) e este módulo lista pastas e
// resolve a escolha. Independe de GTK, KDE ou portal XDG — no Linux é o modo padrão, porque o seletor nativo
// do Chromium ali depende do ambiente (portal que não responde, GTK que cancela no duplo clique).
const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const KINDS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif', 'svg'],
  video: ['mp4', 'mov', 'm4v', '3gp', 'mkv', 'webm', 'avi', 'mpg', 'mpeg'],
  audio: ['mp3', 'ogg', 'oga', 'opus', 'wav', 'm4a', 'aac', 'amr', 'flac', 'wma'],
};
const SUBTYPE_EXTS = { jpeg: ['jpg', 'jpeg'], quicktime: ['mov'], '3gpp': ['3gp'], mpeg: ['mp3', 'mpeg', 'mpg'], 'x-m4a': ['m4a'], 'x-wav': ['wav'], ogg: ['ogg', 'oga'], webm: ['webm'], 'x-matroska': ['mkv'], pdf: ['pdf'], zip: ['zip'], 'x-rar-compressed': ['rar'], 'vnd.ms-excel': ['xls'], msword: ['doc'], 'vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'], 'vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'], 'vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'], 'plain': ['txt'], csv: ['csv'] };

/** "image/*,video/mp4,.pdf" → { exts: string[] | null (tudo), kinds: ['image','video'] } */
function parseAccept(accept) {
  const parts = String(accept || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!parts.length || parts.includes('*/*')) return { exts: null, kinds: [] };
  const exts = new Set();
  const kinds = new Set();
  for (const part of parts) {
    if (part.startsWith('.')) exts.add(part.slice(1));
    else if (part.endsWith('/*')) {
      const kind = part.slice(0, -2);
      kinds.add(kind);
      for (const e of KINDS[kind] || []) exts.add(e);
    } else {
      const [kind, sub] = part.split('/');
      if (KINDS[kind]) kinds.add(kind);
      for (const e of SUBTYPE_EXTS[sub] || (sub ? [sub] : [])) exts.add(e);
    }
  }
  return { exts: exts.size ? [...exts] : null, kinds: [...kinds] };
}

function existingDir(p) {
  try {
    return p && fs.statSync(p).isDirectory() ? p : null;
  } catch {
    return null;
  }
}
const special = (key) => {
  try {
    return existingDir(app.getPath(key));
  } catch {
    return null;
  }
};

/** Lugares da barra do seletor (só os que existem). */
function places() {
  const list = [];
  const add = (label, p) => p && list.push({ label, path: p });
  add('Início', special('home'));
  add('Imagens', special('pictures'));
  add('Vídeos', special('videos'));
  add('Música', special('music'));
  add('Downloads', special('downloads'));
  add('Documentos', special('documents'));
  add('Área de trabalho', special('desktop'));
  add('Sistema', existingDir('/'));
  return list;
}

/** Pasta inicial conforme o tipo pedido (fotos → Imagens, áudio → Música…). */
function startDir(kinds) {
  const prefer = kinds.includes('image') || kinds.includes('video') ? ['pictures', 'downloads', 'home'] : kinds.includes('audio') ? ['music', 'downloads', 'home'] : ['downloads', 'documents', 'home'];
  for (const key of prefer) {
    const dir = special(key);
    if (dir) return dir;
  }
  return app.getPath('home');
}

function listDir(dir, exts) {
  const resolved = existingDir(dir) || app.getPath('home');
  let dirents;
  try {
    dirents = fs.readdirSync(resolved, { withFileTypes: true });
  } catch (e) {
    return { dir: resolved, parent: path.dirname(resolved), entries: [], error: e.code === 'EACCES' ? 'Sem permissão para abrir esta pasta.' : 'Não foi possível abrir esta pasta.' };
  }
  const allowed = exts ? new Set(exts) : null;
  const entries = [];
  for (const d of dirents) {
    if (d.name.startsWith('.')) continue;
    const full = path.join(resolved, d.name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    const isDir = st.isDirectory();
    if (!isDir && allowed && !allowed.has(path.extname(d.name).slice(1).toLowerCase())) continue;
    entries.push({ name: d.name, dir: isDir, size: isDir ? 0 : st.size, mtime: st.mtimeMs });
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }) : a.dir ? -1 : 1));
  const parent = path.dirname(resolved);
  return { dir: resolved, parent: parent === resolved ? null : parent, entries };
}

/**
 * Coordena um pedido por vez: manda o diálogo para a barra (sendCommand('picker', spec)) e espera
 * shell:picker-result. open() resolve com caminhos (ou null), save() com um caminho (ou null).
 */
function createPicker({ sendCommand, fromShell }) {
  let pending = null;
  const request = (spec) =>
    new Promise((resolve) => {
      if (pending) pending.resolve(null);
      pending = { resolve, spec };
      sendCommand('picker', spec);
    });

  ipcMain.handle('shell:picker-list', (event, dir) => {
    if (!fromShell(event)) return null;
    return listDir(String(dir || ''), pending ? pending.spec.exts : null);
  });
  ipcMain.on('shell:picker-result', (event, result) => {
    if (!fromShell(event) || !pending) return;
    const { resolve, spec } = pending;
    pending = null;
    if (result == null) return resolve(null);
    if (spec.kind === 'save') {
      const chosen = String(result);
      resolve(chosen && path.isAbsolute(chosen) ? chosen : null);
    } else {
      const paths = (Array.isArray(result) ? result : [result]).map(String).filter((p) => path.isAbsolute(p) && fs.existsSync(p) && !fs.statSync(p).isDirectory());
      resolve(paths.length ? (spec.multiple ? paths : paths.slice(0, 1)) : null);
    }
  });

  return {
    open({ accept = '', multiple = false, title } = {}) {
      const { exts, kinds } = parseAccept(accept);
      const label = kinds.includes('image') && kinds.includes('video') ? 'Fotos e vídeos' : kinds.includes('image') ? 'Imagens' : kinds.includes('video') ? 'Vídeos' : kinds.includes('audio') ? 'Áudio' : 'Arquivos';
      return request({ kind: 'open', title: title || `Escolher: ${label}`, multiple: !!multiple, exts, kinds, start: startDir(kinds), places: places() });
    },
    save({ suggestedName = 'arquivo', title } = {}) {
      return request({ kind: 'save', title: title || 'Salvar arquivo', suggestedName, exts: null, kinds: [], start: special('downloads') || app.getPath('home'), places: places() });
    },
    cancel() {
      if (pending) pending.resolve(null);
      pending = null;
    },
  };
}

module.exports = { createPicker, parseAccept };
