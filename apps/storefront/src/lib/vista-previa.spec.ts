import { describe, expect, it } from 'vitest';
import { esRobotDeVistaPrevia } from './vista-previa';

describe('esRobotDeVistaPrevia', () => {
  it('reconoce a los que sacan la vista previa de un enlace', () => {
    // Cadenas reales: si la puerta de edad les responde a estos, compartir un
    // producto en un chat enseña el nombre de la tienda y ninguna foto.
    const robots = [
      'WhatsApp/2.23.20.0 A',
      'WhatsApp/2.2338.9 N',
      'TelegramBot (like TwitterBot)',
      'Mozilla/5.0 (compatible; Twitterbot/1.0)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Jakarta Commons-HttpClient/3.1)',
    ];

    for (const ua of robots) expect(esRobotDeVistaPrevia(ua)).toBe(true);
  });

  it('no deja pasar a un navegador de verdad', () => {
    // Quien pulsa el enlace tiene que seguir viendo la puerta: lo que se abre
    // es la vista previa, no la tienda.
    const navegadores = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    ];

    for (const ua of navegadores) expect(esRobotDeVistaPrevia(ua)).toBe(false);
  });

  it('los buscadores tampoco pasan', () => {
    // Servirle a Google algo distinto de lo que ve el visitante es cloaking, y
    // esa decisión no se toma aquí.
    expect(esRobotDeVistaPrevia('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(false);
    expect(esRobotDeVistaPrevia('Mozilla/5.0 (compatible; bingbot/2.0)')).toBe(false);
  });

  it('sin cabecera no es un robot', () => {
    expect(esRobotDeVistaPrevia(null)).toBe(false);
    expect(esRobotDeVistaPrevia('')).toBe(false);
  });
});
