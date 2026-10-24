# Teste do Palette num Linux limpo (container)

Reproduz comportamento do app no Linux sem precisar de uma máquina Linux: Ubuntu 24.04 com o `.deb` instalado,
tela virtual (Xvfb) e o modo de diagnóstico do seletor de arquivos. Serve de base para outros diagnósticos.

```bash
colima start                                         # Docker nesta máquina (arm64 → .deb arm64)
npx electron-builder --linux deb --publish never     # gera release.nosync/Palette-<versão>-linux-arm64.deb
cp release.nosync/Palette-*-linux-arm64.deb scripts/linux-test/palette.deb
cd scripts/linux-test && mkdir -p out
docker build -t palette-linux-test .
docker run --rm -v "$PWD/out:/out" palette-linux-test /run-test.sh gtk     # ou: portal | auto
colima stop
```

Saída em `out/`: `app-<modo>.log` (linhas `[dialog-test]`), capturas `shot-<modo>-<t>s.png` e as janelas X
(`windows-<modo>-<t>s.txt`). Se aparecer uma janela "Teste (main)", o diálogo do processo principal abriu.
Em 24/10/2026, no modo `gtk`, o diálogo abriu normalmente (GTK, "Recent/Home/Desktop… Cancel/Open").
