#!/bin/bash
# Empacota o Palette para macOS só com ferramentas nativas (sem electron-builder): monta
# release.nosync/Palette.app a partir do Electron do node_modules, gera o .icns, ajusta o Info.plist
# (nome, ícone, textos de uso de câmera/microfone, esquema whatsapp://), assina ad-hoc e cria o .dmg.
# Uso: scripts/package-mac.sh [--install]   (--install copia para /Applications)
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="Palette"
BUNDLE_ID="br.com.vincii.palette"
VERSION=$(node -p "require('./package.json').version")
# Sufixo .nosync: o iCloud (que sincroniza ~/Desktop) ignora a pasta — 400 MB por build fora da fila de sync
OUT="release.nosync"
FINAL_APP="$OUT/$APP_NAME.app"
# Monta e assina fora de ~/Desktop: o File Provider (iCloud) re-marca diretórios com
# FinderInfo e o codesign recusa como "detritus"; /tmp não é sincronizado.
WORK="$(mktemp -d)"
APP="$WORK/$APP_NAME.app"
SRC_APP="node_modules/electron/dist/Electron.app"

[ -d "$SRC_APP" ] || { echo "Electron não instalado (npm install)"; exit 1; }
[ -f build/icon.png ] || node scripts/make-assets.js

echo "→ Copiando Electron.app"
# Sem resource forks/xattrs/quarentena: qualquer "detritus" desses faz o codesign falhar
COPY="ditto --norsrc --noextattr --noqtn"
$COPY "$SRC_APP" "$APP"

echo "→ Injetando o app (src/, assets/, build/icon.png, package.json — sem dependências de runtime)"
RES="$APP/Contents/Resources"
rm -f "$RES/default_app.asar"
mkdir -p "$RES/app/build"
$COPY src "$RES/app/src"
$COPY assets "$RES/app/assets"
$COPY build/icon.png "$RES/app/build/icon.png"
$COPY package.json "$RES/app/package.json"

echo "→ Gerando ícone .icns"
ICONSET="$(mktemp -d)/$APP_NAME.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" build/icon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z "$((s * 2))" "$((s * 2))" build/icon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RES/$APP_NAME.icns"
rm -f "$RES/electron.icns"

echo "→ Ajustando Info.plist"
PLIST="$APP/Contents/Info.plist"
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/$APP_NAME"
plutil -replace CFBundleExecutable -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleDisplayName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$PLIST"
plutil -replace CFBundleIconFile -string "$APP_NAME.icns" "$PLIST"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$PLIST"
plutil -replace CFBundleVersion -string "$VERSION" "$PLIST"
plutil -replace LSApplicationCategoryType -string "public.app-category.social-networking" "$PLIST"
plutil -replace NSHumanReadableCopyright -string "© Vincii" "$PLIST"
# Textos que o macOS mostra ao pedir câmera/microfone (chamadas) e áudio do sistema (compartilhar tela)
plutil -replace NSCameraUsageDescription -string "O Palette usa a câmera nas chamadas de vídeo do WhatsApp." "$PLIST"
plutil -replace NSMicrophoneUsageDescription -string "O Palette usa o microfone nas chamadas de voz e vídeo do WhatsApp." "$PLIST"
plutil -replace NSAudioCaptureUsageDescription -string "O Palette captura o áudio do sistema ao compartilhar a tela numa chamada." "$PLIST"
# Esquema whatsapp:// (links "clique para conversar"); virar padrão é opção em Configurações
plutil -replace CFBundleURLTypes -json '[{"CFBundleURLName":"WhatsApp","CFBundleURLSchemes":["whatsapp"],"CFBundleTypeRole":"Viewer"}]' "$PLIST"

echo "→ Assinatura ad-hoc (necessária no Apple Silicon)"
# Restos do Finder (._*, .DS_Store, xattrs) fazem o codesign falhar com "detritus not allowed"
dot_clean -m "$APP" 2>/dev/null || true
find "$APP" -name ".DS_Store" -delete
xattr -cr "$APP"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

echo "→ Criando .dmg"
STAGE="$(mktemp -d)/dmg"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/$APP_NAME.app"
ln -s /Applications "$STAGE/Applications"
rm -rf "$OUT"
mkdir -p "$OUT"
# Spotlight não indexa a pasta de build: evita um segundo "Palette" na lista de apps do macOS
touch "$OUT/.metadata_never_index"
DMG="$OUT/$APP_NAME-$VERSION-arm64.dmg"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null

if [ "${1:-}" = "--install" ]; then
  # Instalando, o único .app fica em /Applications (sem cópia duplicada no projeto)
  echo "→ Instalando em /Applications"
  rm -rf "/Applications/$APP_NAME.app"
  $COPY "$APP" "/Applications/$APP_NAME.app"
  echo "✓ /Applications/$APP_NAME.app"
else
  $COPY "$APP" "$FINAL_APP"
  echo "✓ $FINAL_APP"
fi

rm -rf "$WORK"
echo "✓ $DMG"
