'use strict';
// Armazenamento em JSON (contas, janela e configurações) em userData/palette.json.
// Grava com atraso de 300 ms e de forma atômica (arquivo temporário + rename).
const fs = require('node:fs');
const path = require('node:path');

class Store {
  constructor(file, defaults) {
    this.file = file;
    this.data = { ...defaults, ...this.read() };
    this.timer = null;
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] falha ao salvar:', e.message);
    }
  }
}

module.exports = { Store };
