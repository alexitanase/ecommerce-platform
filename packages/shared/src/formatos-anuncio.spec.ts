import { describe, expect, it } from 'vitest';
import {
  clavePersonalizada,
  FORMATOS,
  MESES_VIGENCIA,
  admiteAnimacion,
  formatoPorClave,
  formatosDeRed,
  formatosParecidos,
  medidaPersonalizada,
  orientacion,
  pesoMaximoKb,
  revisionCaducada,
} from './formatos-anuncio.js';

describe('catálogo de formatos', () => {
  it('no tiene claves repetidas', () => {
    const claves = FORMATOS.map((f) => f.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('todas las fichas están completas', () => {
    for (const f of FORMATOS) {
      expect(f.ancho, f.clave).toBeGreaterThan(0);
      expect(f.alto, f.clave).toBeGreaterThan(0);
      expect(f.tipos.length, f.clave).toBeGreaterThan(0);
      expect(f.pesoMaxKb, f.clave).toBeGreaterThan(0);
      expect(f.revisado, f.clave).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('la clave empieza por el nombre de la red', () => {
    for (const f of FORMATOS) expect(f.clave.startsWith(`${f.red}.`), f.clave).toBe(true);
  });

  /*
   * Los formatos con texto son los que la red compone ella misma —push y
   * nativo—, y ahí el límite de caracteres es lo único que separa un anuncio de
   * un titular cortado a la mitad. Que estén declarados no es un detalle: el
   * editor los usa para avisar mientras se escribe.
   */
  it('push y nativo declaran sus límites de texto', () => {
    for (const f of FORMATOS.filter((x) => x.familia === 'push' || x.familia === 'nativo')) {
      if (f.clave.endsWith('192x192')) continue; // el icono no lleva texto
      expect(f.textos?.titulo, f.clave).toBeGreaterThan(0);
      expect(f.textos?.descripcion, f.clave).toBeGreaterThan(0);
    }
  });

  it('el vertical de redes trae zona segura', () => {
    const vertical = formatoPorClave('social.vertical.1080x1920');
    expect(vertical?.zonaSegura?.arriba).toBeGreaterThan(0);
    expect(vertical?.zonaSegura?.abajo).toBeGreaterThan(0);
  });

  it('los formatos de correo no ofrecen WebP', () => {
    // Outlook no lo pinta, y un bloque en blanco en una newsletter es peor que
    // una imagen pesada.
    for (const f of FORMATOS.filter((x) => x.red === 'correo')) {
      expect(f.tipos, f.clave).not.toContain('webp');
    }
  });
});

describe('pesoMaximoKb', () => {
  it('usa el límite de vídeo cuando la entrega es vídeo', () => {
    const f = formatoPorClave('exoclick.display.300x250')!;
    expect(pesoMaximoKb(f, 'gif')).toBe(150);
    expect(pesoMaximoKb(f, 'mp4')).toBe(1500);
  });

  it('cae al límite estático si el formato no distingue', () => {
    const f = formatoPorClave('exoclick.display.300x500')!;
    expect(pesoMaximoKb(f, 'mp4')).toBe(f.pesoMaxKb);
  });
});

describe('revisionCaducada', () => {
  const f = formatoPorClave('exoclick.display.300x250')!;

  it('está vigente el mismo día de la revisión', () => {
    expect(revisionCaducada(f, new Date('2026-08-09T12:00:00Z'))).toBe(false);
  });

  it('caduca pasados los meses de vigencia', () => {
    const despues = new Date('2026-08-09T00:00:00Z');
    despues.setUTCMonth(despues.getUTCMonth() + MESES_VIGENCIA);
    despues.setUTCDate(despues.getUTCDate() + 1);
    expect(revisionCaducada(f, despues)).toBe(true);
  });

  it('una fecha ilegible se trata como caducada', () => {
    expect(revisionCaducada({ ...f, revisado: 'cuando sea' })).toBe(true);
  });
});

describe('tamaños a medida', () => {
  it('van y vuelven', () => {
    expect(clavePersonalizada(300, 600)).toBe('personalizado.300x600');
    expect(medidaPersonalizada('personalizado.300x600')).toEqual({ ancho: 300, alto: 600 });
  });

  it('redondea, porque una mesa no tiene medio píxel', () => {
    expect(clavePersonalizada(300.4, 599.6)).toBe('personalizado.300x600');
  });

  /*
   * Lo importante de distinguirlos: una pieza a medida NO tiene ficha de red, y
   * por tanto no tiene peso máximo que comprobar. Confundirla con un formato del
   * catálogo haría que el validador la midiera contra un límite inventado.
   */
  it('una clave del catálogo no se confunde con una a medida', () => {
    expect(medidaPersonalizada('exoclick.display.300x250')).toBeNull();
    expect(formatoPorClave('personalizado.300x600')).toBeUndefined();
  });
});

describe('ayudas del editor', () => {
  it('clasifica la orientación', () => {
    expect(orientacion(formatoPorClave('exoclick.display.728x90')!)).toBe('apaisado');
    expect(orientacion(formatoPorClave('exoclick.display.160x600')!)).toBe('vertical');
    expect(orientacion(formatoPorClave('social.feed.1080x1080')!)).toBe('cuadrado');
  });

  it('sabe qué formatos admiten animación', () => {
    expect(admiteAnimacion(formatoPorClave('exoclick.display.300x250')!)).toBe(true);
    expect(admiteAnimacion(formatoPorClave('exoclick.push.192x192')!)).toBe(false);
  });

  it('propone primero los de proporción parecida', () => {
    const cuadrado = formatoPorClave('social.feed.1080x1080')!;
    const parecidos = formatosParecidos(cuadrado, 3);
    expect(parecidos).not.toHaveLength(0);
    for (const p of parecidos) expect(orientacion(p)).not.toBe('apaisado');
  });

  it('agrupa por red', () => {
    expect(formatosDeRed('exoclick').length).toBeGreaterThan(5);
    expect(formatosDeRed('exoclick').every((f) => f.red === 'exoclick')).toBe(true);
  });
});
