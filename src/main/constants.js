'use strict';
// Constantes compartilhadas pelo processo principal.
module.exports = {
  APP_NAME: 'Palette',
  APP_ID: 'br.com.vincii.palette',
  BG: '#050505',
  /** Largura da barra lateral de contas (o WhatsApp ocupa o resto da janela). */
  RAIL_WIDTH: 72,
  /** Moldura em volta da conta ativa: margem até a barra/bordas da janela e raio dos cantos da view. */
  FRAME_MARGIN: 12,
  FRAME_RADIUS: 14,
  WA_URL: 'https://web.whatsapp.com/',
  WA_ORIGIN: 'https://web.whatsapp.com',
  /** Cores de conta: a paleta de acentos da identidade Vincii. */
  ACCOUNT_COLORS: ['#00C9B1', '#5EB0FF', '#B48CFF', '#FF7AA8', '#FF9F5A', '#FFC24B', '#FF6B6B', '#C9D1D9'],
  DEFAULT_SPELL_LANGUAGES: ['pt-BR', 'en-US'],
  SPELL_LANGUAGE_OPTIONS: ['pt-BR', 'pt-PT', 'en-US', 'en-GB', 'es', 'fr', 'de', 'it'],
  MAX_NAME_LENGTH: 32,
  /** Avatar da conta: iniciais (padrão), ícone do conjunto, imagem escolhida ou foto do perfil do WhatsApp. */
  AVATAR_KINDS: ['initials', 'icon', 'image', 'photo'],
  ACCOUNT_ICON_KEYS: ['briefcase', 'home', 'headset', 'cart', 'star', 'heart', 'phone', 'building', 'bell', 'users', 'globe', 'bolt', 'coffee', 'wrench', 'truck', 'shield'],
  /** Tamanho máximo (chars) de uma imagem/foto em data URL guardada na conta (128px PNG ≈ 30 KB). */
  MAX_IMAGE_DATA_URL: 200000,
};
