// Gera o ícone do Palette (build/icon.png, 1024px — o electron-builder deriva .icns/.ico) e os ícones
// de bandeja (assets/tray) compondo o monograma "V" da Vincii (assets/brand/vincii-v.png) com um
// selo teal de balão de conversa, no mesmo estilo dos ícones do Brush e do Vincii Canvas.
// Uso: node scripts/make-assets.js   (sharp vem nas devDependencies)
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const V = path.join(ROOT, 'assets', 'brand', 'vincii-v.png');
const TEAL = '#00C9B1';
const BG = '#050505';
const V_RATIO = 706 / 988; // altura / largura do PNG do monograma

// Balão de conversa (viewBox 1024): corpo arredondado com rabicho à esquerda e três pontos
const BUBBLE = 'M292 330h440a74 74 0 0 1 74 74v212a74 74 0 0 1-74 74H470l-150 118V690h-28a74 74 0 0 1-74-74V404a74 74 0 0 1 74-74z';
const DOTS = (fill) => [402, 512, 622].map((cx) => `<circle cx="${cx}" cy="510" r="36" fill="${fill}"/>`).join('');

function background(size, { rx = 0 } = {}) {
  return Buffer.from(`<svg width="${size}" height="${size}" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="r" cx="50%" cy="40%" r="70%">
      <stop offset="0" stop-color="#0D2724"/><stop offset="0.55" stop-color="#07120F"/><stop offset="1" stop-color="${BG}"/>
    </radialGradient>
    <radialGradient id="h" cx="50%" cy="44%" r="38%">
      <stop offset="0" stop-color="${TEAL}" stop-opacity="0.32"/><stop offset="1" stop-color="${TEAL}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" rx="${rx}" fill="url(#r)"/>
  <rect width="1024" height="1024" rx="${rx}" fill="url(#h)"/>
</svg>`);
}

/** Selo redondo teal com o balão (anel escuro para destacar sobre o V). */
function badge(size) {
  return Buffer.from(`<svg width="${size}" height="${size}" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <circle cx="512" cy="512" r="500" fill="${BG}"/>
  <circle cx="512" cy="512" r="430" fill="${TEAL}"/>
  <g transform="translate(512 532) scale(0.72) translate(-512 -569)"><path d="${BUBBLE}" fill="${BG}"/>${DOTS(TEAL)}</g>
</svg>`);
}

/** Balão sozinho (bandeja): teal no Windows/Linux, preto com alfa como template no macOS. */
function bubbleIcon(size, color) {
  return Buffer.from(`<svg width="${size}" height="${size}" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(512 512) scale(1.5) translate(-512 -569)"><path d="${BUBBLE}" fill="${color}"/>${DOTS('rgba(0,0,0,0)')}</g>
</svg>`);
}

async function vMark(width) {
  return sharp(V).resize({ width: Math.round(width) }).ensureAlpha().png().toBuffer();
}

async function withOpacity(buffer, opacity) {
  return sharp(buffer)
    .composite([{ input: Buffer.from([0, 0, 0, Math.round(255 * opacity)]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function icon(size) {
  const vw = Math.round(size * 0.6);
  const vh = Math.round(vw * V_RATIO);
  const left = Math.round((size - vw) / 2);
  const top = Math.round((size - vh) / 2 - size * 0.04);
  const glow = await withOpacity(await sharp(await vMark(vw)).blur(Math.max(6, size * 0.05)).png().toBuffer(), 0.45);
  const b = Math.round(size * 0.3);
  const margin = Math.round(size * 0.09);
  return sharp(background(size))
    .composite([
      { input: glow, left, top },
      { input: await vMark(vw), left, top },
      { input: await sharp(badge(b)).png().toBuffer(), left: size - b - margin, top: size - b - margin },
    ])
    .png()
    .toBuffer();
}

async function write(file, buffer) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, buffer);
  console.log('ok', path.relative(ROOT, file));
}

const LINUX_SIZES = [16, 24, 32, 48, 64, 96, 128, 256, 512];

(async () => {
  const master = await icon(1024);
  await write(path.join(ROOT, 'build', 'icon.png'), master);
  // Linux: electron-builder instala cada tamanho em /usr/share/icons/hicolor/<N>x<N>/apps (um PNG só de
  // 1024px ficava numa pasta que os temas não consultam e o launcher mostrava o ícone genérico)
  for (const size of LINUX_SIZES) await write(path.join(ROOT, 'build', 'icons', `${size}x${size}.png`), await sharp(master).resize(size, size).png().toBuffer());
  const tray = path.join(ROOT, 'assets', 'tray');
  await write(path.join(tray, 'tray.png'), await sharp(bubbleIcon(32, TEAL)).png().toBuffer());
  await write(path.join(tray, 'tray@2x.png'), await sharp(bubbleIcon(64, TEAL)).png().toBuffer());
  await write(path.join(tray, 'trayTemplate.png'), await sharp(bubbleIcon(16, '#000')).png().toBuffer());
  await write(path.join(tray, 'trayTemplate@2x.png'), await sharp(bubbleIcon(32, '#000')).png().toBuffer());
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
