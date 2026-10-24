# Palette

**Várias contas do WhatsApp num só app, com chamadas de voz e vídeo** — para macOS, Windows e Linux. Código em [github.com/Vincii-Solucoes/vincii-palette](https://github.com/Vincii-Solucoes/vincii-palette); instaladores na página de [Releases](https://github.com/Vincii-Solucoes/vincii-palette/releases/latest).

O Palette é o "WhatsApp Desktop" da Vincii: uma janela com uma barra lateral de contas; cada conta é o
**WhatsApp Web oficial** rodando numa sessão isolada (como se cada número estivesse em outro computador).
Mensagens, notificações e chamadas de todas as contas continuam chegando em segundo plano.

- **Multiconta**: adicione quantos números quiser, cada um com nome, cor e avatar (iniciais, um ícone do conjunto, uma imagem sua ou a própria foto do perfil do WhatsApp); troque com um clique ou ⌘/Ctrl+1…9, reordene arrastando. Se uma conta cair para a tela de QR code, o avatar ganha um aviso e você recebe uma notificação.
- **Chamadas de voz e vídeo** direto na conta (o app libera câmera, microfone e compartilhamento de tela para o WhatsApp Web).
- **Notificações do sistema** por conta (clique traz a janela já na conta certa), contador de não lidas no Dock/barra de tarefas, opção de silenciar conta.
- **Chamada recebida**: o avatar da conta pisca com um telefone, o app troca para ela (opção) e avisa pelo sistema se a janela não estiver em foco; contas inativas com som tocando mostram um pontinho.
- Visual Vincii: barra lateral escura, conta ativa numa moldura arredondada e WhatsApp em tema escuro por padrão (Claro ou Sistema nas configurações).
- Janela sempre no topo (menu Visualizar), atalho global opcional Ctrl+Shift+W (⌃⇧W) para mostrar ou esconder, ícone da bandeja com ponto vermelho quando há não lidas.
- Corretor ortográfico, zoom por conta, links externos no navegador, downloads direto na pasta Downloads, início com o sistema, bandeja (Windows/Linux), links `whatsapp://` "clique para conversar".

> Cada conta usa um dos **4 aparelhos vinculados** que o WhatsApp permite por número (no celular: *Dispositivos conectados › Conectar dispositivo*). O Palette não usa nenhum protocolo não oficial nem automatiza nada — é o WhatsApp Web, organizado.

## Rodar em desenvolvimento

```bash
npm install
npm start
```

No primeiro uso, clique em **Adicionar conta**, dê um nome e escaneie o QR code com o celular daquele número. Repita para cada conta.

`npm run smoke` abre o app num perfil temporário, cria uma conta de teste e grava em `smoke.nosync/` screenshots e um `smoke.json` com o que o WhatsApp Web enxergou (user agent, permissões de mídia, patch de notificações) — útil depois de mexer no processo principal.

## Instalar

- **macOS (esta máquina)**: `npm run mac:install` monta o `Palette.app` com assinatura ad-hoc, gera o `.dmg` em `release.nosync/` e instala em `/Applications`. Na primeira abertura o macOS avisa "desenvolvedor não verificado": botão direito → **Abrir**. Se disser "está danificado": `xattr -cr /Applications/Palette.app`.
- **Instaladores oficiais (mac/Windows/Linux)**: envie uma tag `vX.Y.Z` — o workflow `.github/workflows/release.yml` compila com electron-builder em cada sistema e cria um Release com `.dmg`/`.zip` (arm64 e x64), `Palette-Setup-*.exe`, `.AppImage` e `.deb`. Antes, alinhe `version` no `package.json`. Local: `npm run dist:mac` etc. (saída em `release.nosync/`).

## Atualizações (via GitHub Releases)

Os instaladores são publicados como Releases deste repositório, e o app verifica novas versões sozinho:

- **Windows e Linux (AppImage)**: auto-update completo via `electron-updater`. O app baixa a nova versão em segundo plano e pergunta se quer reiniciar (também aplica ao fechar). Funciona sem certificado de assinatura.
- **macOS**: o app avisa que há versão nova e abre a página de download; instale por cima da atual (as contas continuam vinculadas). O auto-update silencioso exigiria um certificado Apple Developer ID.

Para publicar uma versão: suba `version` no `package.json`, faça commit e envie a tag:

```bash
git tag v1.1.0 && git push origin main --tags
```

O CI compila os instaladores dos três sistemas e cria o Release `v1.1.0` com os metadados `latest*.yml` que o auto-update usa. Builds locais do `npm run mac:install` não têm `app-update.yml`, então não verificam atualização.

O app verifica ao abrir, a cada hora e quando a janela volta ao foco. Em **Configurações › Sobre** você vê o estado (verificando, baixando, pronta para instalar) e tem **Verificar agora**; com a janela na bandeja, o aviso chega como notificação do sistema. O histórico fica em `updater.log` na pasta do perfil, e `npm run check-update` faz a mesma consulta ao GitHub a partir do projeto.

> Repositório público significa código visível. Nenhum dado de conta vai junto: as sessões do WhatsApp ficam só no perfil do usuário (`~/Library/Application Support/Palette`, `%APPDATA%/Palette`, `~/.config/Palette`).

## Segurança e privacidade

Cada conta é o WhatsApp Web oficial numa sessão isolada e sem acesso ao sistema (sandbox do Chromium, sem Node na página). O app não coleta nada: mensagens, mídias e a sessão ficam só no seu computador, no perfil do usuário. Links abrem no navegador do sistema, as views não saem de `web.whatsapp.com`, e o WhatsApp só recebe as permissões de que precisa (microfone, câmera, notificações, compartilhar tela). Atualizações vêm do GitHub por HTTPS com verificação de integridade. No macOS, na primeira notificação o sistema pode pedir permissão para o Palette avisar; permita para receber as mensagens com a janela minimizada ou em outra conta.

## Seletor de arquivos no Linux

No Linux, anexar (fotos e vídeos, áudio, documentos) e salvar usam por padrão o **seletor do Palette**: um diálogo do próprio app, com atalhos para Início, Imagens, Vídeos, Música, Downloads, Documentos e Área de trabalho, que abre já na pasta certa para o tipo pedido, aceita duplo clique e entrega o arquivo ao WhatsApp por dentro — sem depender do GTK, do KDE nem do portal do sistema. Em Configurações › Seletor de arquivos dá para voltar ao diálogo nativo (GTK, portal ou automático), e o botão **Testar seletor agora** abre o seletor em uso. A troca vale na próxima abertura do app. No macOS e no Windows o seletor é sempre o do sistema.

## Permissões de chamada

Na primeira chamada o sistema pede **microfone** e **câmera** (textos em pt-BR no Info.plist). Se forem negados, *Configurações › Chamadas de voz e vídeo* mostra o estado e abre os ajustes de privacidade (macOS/Windows). Compartilhar tela usa o seletor nativo no macOS 15+; nos demais sistemas vai a tela principal.

As chamadas em si são do WhatsApp Web (disponíveis no navegador para Chrome, Edge e Safari desde meados de 2026); o Palette garante que o WhatsApp Web reconheça o app como Chrome e que áudio e vídeo funcionem com a conta em segundo plano.

## Estrutura

Veja `AGENTS.md` (arquitetura, convenções e armadilhas — incluindo o layout anti-iCloud da pasta: `node_modules` → `node_modules.nosync`, `.git` → `.git.nosync`, builds em `release.nosync/`).
