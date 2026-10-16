'use strict';
// Assinatura ad-hoc no macOS (sem certificado Apple pago), como no Brush e no Vincii Canvas: sem ela,
// no Apple Silicon o app aparece como "danificado"; com ela, vira "desenvolvedor não verificado"
// e o usuário libera na 1ª abertura (botão direito → Abrir). Não substitui a notarização.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  try {
    execFileSync('xattr', ['-cr', appPath]);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath]);
    console.log('[afterPack] assinatura ad-hoc:', appPath);
  } catch (e) {
    console.warn('[afterPack] falha ao assinar ad-hoc:', (e && e.stderr && e.stderr.toString()) || e.message);
  }
};
