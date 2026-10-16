'use strict';
// Depois de empacotar (electron-builder, nos três sistemas):
// 1. Troca os "fuses" do Electron — desliga ELECTRON_RUN_AS_NODE, NODE_OPTIONS e --inspect e exige que
//    o app venha do asar — fechando os caminhos que deixariam o binário do Palette executar código
//    alheio. Fica aqui, e não em build.electronFuses, porque o electron-builder aplicaria os fuses
//    DEPOIS deste hook e invalidaria a assinatura feita abaixo.
// 2. No macOS, assinatura ad-hoc (sem certificado Apple pago), como no Brush e no Vincii Canvas: sem
//    ela, no Apple Silicon o app aparece como "danificado"; com ela, vira "desenvolvedor não
//    verificado" e o usuário libera na 1ª abertura (botão direito → Abrir). Não substitui a notarização.
const { execFileSync } = require('child_process');
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

function electronBinary(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const product = packager.appInfo.productFilename;
  if (electronPlatformName === 'darwin') return path.join(appOutDir, `${product}.app`);
  if (electronPlatformName === 'win32') return path.join(appOutDir, `${product}.exe`);
  return path.join(appOutDir, packager.executableName || product.toLowerCase());
}

exports.default = async function afterPack(context) {
  const binary = electronBinary(context);
  await flipFuses(binary, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: false, // o bundle inteiro é assinado logo abaixo
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
  console.log('[afterPack] fuses aplicados:', binary);
  if (context.electronPlatformName !== 'darwin') return;
  try {
    execFileSync('xattr', ['-cr', binary]);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', binary]);
    console.log('[afterPack] assinatura ad-hoc:', binary);
  } catch (e) {
    console.warn('[afterPack] falha ao assinar ad-hoc:', (e && e.stderr && e.stderr.toString()) || e.message);
  }
};
