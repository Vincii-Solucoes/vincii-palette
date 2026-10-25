FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb x11-utils x11-xserver-utils imagemagick dbus-x11 ca-certificates fonts-dejavu-core \
    libgtk-3-0t64 libnss3 libasound2t64 libxss1 libgbm1 libatk-bridge2.0-0t64 libdrm2 libxkbcommon0 libnotify4 libsecret-1-0 libayatana-appindicator3-1 xdg-utils \
    && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-gi gir1.2-glib-2.0 && rm -rf /var/lib/apt/lists/*
COPY palette.deb /tmp/palette.deb
RUN apt-get update && apt-get install -y --no-install-recommends /tmp/palette.deb && rm -rf /var/lib/apt/lists/* /tmp/palette.deb
RUN mkdir -p /root/profile && printf '%s' '{"accounts":[{"id":"t","name":"Teste","color":"#5EB0FF","muted":false}],"activeId":"t","bounds":{"x":40,"y":40,"width":1100,"height":700,"maximized":false},"settings":{"startAtLogin":false,"closeToTray":true,"spellLanguages":["pt-BR"],"theme":"dark","fileDialog":"gtk"}}' > /root/profile/palette.json
COPY run-test.sh /run-test.sh
COPY run-smoke.sh /run-smoke.sh
COPY run-notify.sh /run-notify.sh
COPY fake-notifyd.py /fake-notifyd.py
RUN chmod +x /run-test.sh /run-smoke.sh /run-notify.sh
CMD ["/run-test.sh"]
