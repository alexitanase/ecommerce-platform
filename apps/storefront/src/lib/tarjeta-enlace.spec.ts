import { describe, expect, it } from 'vitest';
import { recortar, tarjetaDeEnlace } from './tarjeta-enlace';

const RUTA = '/es/producto/botas-de-cuero';

describe('recortar', () => {
  it('deja el texto corto tal cual', () => {
    expect(recortar('Botas artesanales')).toBe('Botas artesanales');
  });

  it('no parte una palabra por la mitad', () => {
    const texto = `${'palabra '.repeat(40)}final`;
    const corto = recortar(texto, 50);

    expect(corto.length).toBeLessThanOrEqual(51);
    expect(corto.endsWith('…')).toBe(true);
    expect(corto).not.toMatch(/pala…$/);
  });

  it('junta los saltos de línea del texto del proveedor', () => {
    // Las descripciones llegan con saltos y tabuladores; en una tarjeta de chat
    // eso se ve como huecos raros en medio de la frase.
    expect(recortar('Botas\n\n  de   cuero')).toBe('Botas de cuero');
  });
});

describe('tarjetaDeEnlace', () => {
  it('pide la tarjeta grande cuando hay foto, y con sus medidas', () => {
    // Sin medidas, WhatsApp suele descartar la foto y X la enseña cuadrada.
    const { openGraph, twitter } = tarjetaDeEnlace({
      titulo: 'Botas de cuero',
      descripcion: 'Botas artesanales',
      ruta: RUTA,
      imagen: { url: 'https://cdn.tienda.local/botas.webp', width: 1200, height: 1200 },
    });

    expect(twitter?.card).toBe('summary_large_image');
    expect(openGraph?.images).toEqual([
      {
        url: 'https://cdn.tienda.local/botas.webp',
        width: 1200,
        height: 1200,
        alt: 'Botas de cuero',
      },
    ]);
  });

  it('sin foto pide la tarjeta pequeña', () => {
    // La grande sin imagen deja un rectángulo vacío del ancho del chat.
    const { openGraph, twitter } = tarjetaDeEnlace({ titulo: 'Catálogo', ruta: '/es/buscar' });

    expect(twitter?.card).toBe('summary');
    expect(openGraph?.images).toBeUndefined();
  });

  it('la dirección de la tarjeta es absoluta', () => {
    // Con una ruta relativa la aplicación no sabe a dónde lleva la tarjeta.
    const { openGraph } = tarjetaDeEnlace({ titulo: 'Botas', ruta: RUTA });

    expect(String(openGraph?.url)).toMatch(/^https?:\/\/.+\/es\/producto\/botas-de-cuero$/);
  });

  it('una foto en ruta relativa se convierte en absoluta', () => {
    const { openGraph } = tarjetaDeEnlace({
      titulo: 'Botas',
      ruta: RUTA,
      imagen: { url: '/medios/botas.webp' },
    });

    expect(String((openGraph?.images as { url: string }[])[0]?.url)).toMatch(
      /^https?:\/\/.+\/medios\/botas\.webp$/,
    );
  });

  it('el texto alternativo cae al título cuando la foto no lo trae', () => {
    const { openGraph } = tarjetaDeEnlace({
      titulo: 'Botas de cuero',
      ruta: RUTA,
      imagen: { url: 'https://cdn.tienda.local/botas.webp', alt: null },
    });

    expect((openGraph?.images as { alt: string }[])[0]?.alt).toBe('Botas de cuero');
  });
});
