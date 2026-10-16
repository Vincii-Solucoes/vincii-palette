// Diagnóstico da atualização automática: pergunta ao GitHub qual é a versão mais recente do jeito que o
// app faz (electron-updater com o provider "github" do package.json), sem baixar nada, e sai.
// Uso: npm run check-update   (roda em dev; o app instalado faz a mesma consulta 8 s depois de abrir)
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
app.setAppPath(ROOT);

app.whenReady().then(async () => {
  const { autoUpdater } = require('electron-updater');
  const publish = require(path.join(ROOT, 'package.json')).build.publish[0];
  const config = path.join(ROOT, 'smoke.nosync', 'dev-app-update.yml');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, `provider: ${publish.provider}\nowner: ${publish.owner}\nrepo: ${publish.repo}\nreleaseType: ${publish.releaseType}\n`);
  autoUpdater.updateConfigPath = config;
  autoUpdater.forceDevUpdateConfig = true;
  autoUpdater.autoDownload = false;
  autoUpdater.logger = { info: (m) => console.log('[updater]', m), warn: (m) => console.warn('[updater]', m), error: (m) => console.error('[updater]', m), debug: () => {} };
  try {
    const result = await autoUpdater.checkForUpdates();
    const info = result && result.updateInfo;
    console.log(JSON.stringify({ instalada: app.getVersion(), maisRecente: info && info.version, publicadaEm: info && info.releaseDate, arquivos: info && info.files.map((f) => f.url) }, null, 2));
  } catch (e) {
    console.error('verificação falhou:', e && e.message);
    process.exitCode = 1;
  }
  app.exit();
});
