import { describe, expect, it } from 'vitest';
import { limpiarClave, normalizarMarcaje } from '../channels/canales.js';
import {
  MAX_CONTENIDO,
  contenidoDeCreatividad,
  enlaceDeCreatividad,
  marcajeDeCampana,
} from './enlaces.js';

const campana = {
  channel: 'exoclick',
  slug: 'rebajas-verano',
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
};

describe('contenidoDeCreatividad', () => {
  it('sale legible y con el sufijo del identificador', () => {
    const c = contenidoDeCreatividad('Banner principal 300×250', 'clx9a1b2c3d4e5f6');
    expect(c).toBe('banner-principal-300250-d4e5f6');
  });

  /*
   * Este es el motivo de que la función exista. El valor viaja hasta el
   * navegador de quien hace clic, que lo normaliza antes de guardarlo. Si al
   * normalizarlo cambiara, el informe buscaría un valor que nunca llega y la
   * creatividad aparecería con cero ventas para siempre.
   */
  it('no cambia al volver a normalizarlo', () => {
    for (const nombre of [
      'Banner principal',
      '  ESPACIOS  y MAYÚSCULAS  ',
      'Ñandú & Cía. (versión 2)',
      '---guiones---',
      'a'.repeat(120),
      '你好',
      '',
    ]) {
      const c = contenidoDeCreatividad(nombre, 'clx9a1b2c3d4e5f6');
      expect(limpiarClave(c), nombre).toBe(c);
      expect(c.length, nombre).toBeLessThanOrEqual(MAX_CONTENIDO);
    }
  });

  it('no deja separadores repetidos', () => {
    // «Banner · variante» pierde el punto medio y dejaría `banner--variante`.
    expect(contenidoDeCreatividad('Banner · variante', 'clx9a1b2c3d4e5f6')).toBe(
      'banner-variante-d4e5f6',
    );
  });

  it('dos creatividades con el mismo nombre no comparten marcaje', () => {
    const a = contenidoDeCreatividad('Banner principal', 'aaaaaaaaaaaa111111');
    const b = contenidoDeCreatividad('Banner principal', 'bbbbbbbbbbbb222222');
    expect(a).not.toBe(b);
  });

  it('un nombre que no deja nada utilizable sigue dando un valor válido', () => {
    const c = contenidoDeCreatividad('!!!', 'clx9a1b2c3d4e5f6');
    expect(c).toBe('creatividad-d4e5f6');
  });
});

describe('marcajeDeCampana', () => {
  it('usa el canal como fuente y el slug como campaña cuando no hay UTM propios', () => {
    expect(marcajeDeCampana(campana)).toEqual({
      fuente: 'exoclick',
      campana: 'rebajas-verano',
    });
  });

  it('los UTM explícitos mandan sobre el canal', () => {
    expect(
      marcajeDeCampana({ ...campana, utmSource: 'ExoClick', utmCampaign: 'Verano 2026' }),
    ).toEqual({ fuente: 'exoclick', campana: 'verano-2026' });
  });

  it('una campaña sin canal ni UTM cae en directo en vez de romperse', () => {
    expect(marcajeDeCampana({ channel: '' }).fuente).toBe('directo');
  });
});

describe('enlaceDeCreatividad', () => {
  it('pone los cuatro parámetros', () => {
    const url = new URL(
      enlaceDeCreatividad('https://chispaynoche.com/rebajas', campana, 'banner-a1b2c3'),
    );
    expect(url.searchParams.get('utm_source')).toBe('exoclick');
    expect(url.searchParams.get('utm_campaign')).toBe('rebajas-verano');
    expect(url.searchParams.get('utm_content')).toBe('banner-a1b2c3');
  });

  it('el enlace generado se vuelve a leer igual', () => {
    const contenido = contenidoDeCreatividad('Vertical rojo', 'clx9a1b2c3d4e5f6');
    const url = new URL(enlaceDeCreatividad('https://chispaynoche.com/', campana, contenido));
    expect(normalizarMarcaje(url.searchParams)?.contenido).toBe(contenido);
  });

  it('conserva los parámetros que ya llevaba la dirección', () => {
    const url = new URL(
      enlaceDeCreatividad(
        'https://chispaynoche.com/buscar?categoria=juguetes',
        campana,
        'x-123456',
      ),
    );
    expect(url.searchParams.get('categoria')).toBe('juguetes');
  });

  it('falla con una dirección que no es una URL', () => {
    expect(() => enlaceDeCreatividad('chispaynoche', campana, 'x-123456')).toThrow();
  });
});
