#!/bin/bash
# Testa o clique na notificação no Linux com um servidor de notificações próprio (fake-notifyd.py, D-Bus):
# o app, no modo PALETTE_TEST_NOTIFY_CLICK, dispara uma notificação HTML5 pela página de uma conta inativa; o
# servidor a recebe e invoca a ação padrão (o mesmo que o usuário clicar), e o log do app diz se o clique chegou,
# se o onclick da página disparou e se a conta ativa trocou.
#   docker run --rm -v "$PWD/out:/out" palette-linux-test /run-notify.sh
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XV=$!
sleep 1
export XDG_SESSION_TYPE=x11 XDG_CURRENT_DESKTOP=GNOME
rm -rf /root/profile-notify && cp -r /root/profile /root/profile-notify && mkdir -p /out/notify
dbus-run-session -- bash -c '
  python3 /fake-notifyd.py > /out/notify/notifyd.log 2>&1 &
  sleep 1
  timeout 120 env PALETTE_TEST_NOTIFY_CLICK=1 PALETTE_TEST_NOTIFY_CLICK_WAIT=30000 PALETTE_USER_DATA=/root/profile-notify /opt/Palette/palette --no-sandbox --disable-gpu --disable-dev-shm-usage > /out/notify/app.log 2>&1
  echo "app saiu com $?"
'
kill $XV 2>/dev/null
echo "=== servidor de notificações ==="; cat /out/notify/notifyd.log
echo "=== app ==="; grep "notify-click" /out/notify/app.log
