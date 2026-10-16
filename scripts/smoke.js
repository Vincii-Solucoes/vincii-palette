// Verificação rápida sem interação: abre o app num perfil temporário (smoke.nosync/profile), cria
// uma conta de teste, espera o WhatsApp Web carregar, tira screenshots da barra lateral e da conta
// e grava smoke.nosync/smoke.json (UA, título, permissões de mídia, patch de notificações).
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const root = path.join(__dirname, '..');
const out = path.join(root, 'smoke.nosync');
const result = spawnSync(electron, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PALETTE_SMOKE: out, PALETTE_USER_DATA: path.join(out, 'profile') },
});
process.exit(result.status ?? 1);
