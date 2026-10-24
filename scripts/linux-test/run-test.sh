#!/bin/bash
# Roda o Palette (instalado pelo .deb na imagem) sob Xvfb em modo de diagnóstico do seletor de arquivos
# (PALETTE_TEST_FILE_DIALOG=1), fotografa a tela e lista as janelas X enquanto o diálogo está aberto.
# Uso (na pasta scripts/linux-test, com o .deb copiado como palette.deb):
#   docker build -t palette-linux-test . && docker run --rm -v "$PWD/out:/out" palette-linux-test /run-test.sh gtk
# A pasta de saída precisa estar dentro de ~ (o colima só compartilha o home com a VM).
MODE="${1:-gtk}"
sed -i "s/\"fileDialog\":\"[a-z]*\"/\"fileDialog\":\"$MODE\"/" /root/profile/palette.json
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XV=$!
sleep 1
export XDG_SESSION_TYPE=x11
( timeout 50 dbus-run-session -- env PALETTE_TEST_FILE_DIALOG=1 PALETTE_USER_DATA=/root/profile /opt/Palette/palette --no-sandbox --disable-gpu --disable-dev-shm-usage > "/out/app-$MODE.log" 2>&1 ) &
for t in 8 12 16 20; do
  sleep 4
  import -display :99 -window root "/out/shot-$MODE-${t}s.png" 2>/dev/null
  xwininfo -root -tree -display :99 > "/out/windows-$MODE-${t}s.txt" 2>&1
done
sleep 10
kill $XV 2>/dev/null
echo "=== diagnóstico ($MODE) ==="; grep -E "dialog-test" "/out/app-$MODE.log"
echo "=== janelas aos 16 s ==="; grep -E '0x[0-9a-f]+ "' "/out/windows-$MODE-16s.txt" | cut -c1-120
