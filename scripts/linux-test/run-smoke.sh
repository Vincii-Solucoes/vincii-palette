#!/bin/bash
# Roda o smoke completo (PALETTE_SMOKE) do Palette instalado pelo .deb sob Xvfb: cobre o seletor de arquivos
# do Palette no Linux (interceptação do <input type=file>, diálogo na barra, entrega, cancelar, salvar e
# download) e a migração do perfil das 1.1.x (fileDialog gtk → palette).
#   docker run --rm -v "$PWD/out:/out" palette-linux-test /run-smoke.sh
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XV=$!
sleep 1
export XDG_SESSION_TYPE=x11 XDG_CURRENT_DESKTOP=GNOME
rm -rf /root/profile-smoke /root/smoke-out && cp -r /root/profile /root/profile-smoke && mkdir -p /root/smoke-out /out/smoke
timeout 600 dbus-run-session -- env PALETTE_SMOKE=/root/smoke-out PALETTE_USER_DATA=/root/profile-smoke /opt/Palette/palette --no-sandbox --disable-gpu --disable-dev-shm-usage > /root/smoke-out/app.log 2>&1
echo "exit=$?"
cp -r /root/smoke-out/. /out/smoke/
cp /root/profile-smoke/palette.json /out/smoke/profile-after.json
kill $XV 2>/dev/null
echo "=== seletor ==="; grep -E "seletor|picker" /root/smoke-out/app.log | head -20
