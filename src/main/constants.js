'use strict';
// Constantes compartilhadas pelo processo principal.
module.exports = {
  APP_NAME: 'Palette',
  APP_ID: 'br.com.vincii.palette',
  BG: '#050505',
  /** Largura da barra lateral de contas (o WhatsApp ocupa o resto da janela). */
  RAIL_WIDTH: 72,
  WA_URL: 'https://web.whatsapp.com/',
  WA_ORIGIN: 'https://web.whatsapp.com',
  /** Cores de conta: a paleta de acentos da identidade Vincii. */
  ACCOUNT_COLORS: ['#00C9B1', '#5EB0FF', '#B48CFF', '#FF7AA8', '#FF9F5A', '#FFC24B', '#FF6B6B', '#C9D1D9'],
  DEFAULT_SPELL_LANGUAGES: ['pt-BR', 'en-US'],
  SPELL_LANGUAGE_OPTIONS: ['pt-BR', 'pt-PT', 'en-US', 'en-GB', 'es', 'fr', 'de', 'it'],
  MAX_NAME_LENGTH: 32,
};
