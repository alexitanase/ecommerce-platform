import { describe, expect, it } from 'vitest';
import { minutosDeLectura, resumen, soloTexto, tituloSeo } from './articulos.js';

/**
 * Cálculos de los artículos del blog.
 *
 * Todo lo de aquí sale en pantalla o en un resultado de búsqueda, y
 * equivocarse no da ningún error: un resumen cortado a mitad de palabra en la
 * tarjeta de un tuit, un "0 min de lectura" que parece un artículo vacío, o un
 * título truncado justo por la parte distintiva.
 */

describe('Extraer el texto de lo que hay escrito', () => {
  it('quita el marcado sin comerse el contenido', () => {
    expect(soloTexto('# Título\n\nUn **párrafo** con _énfasis_.')).toBe(
      'Título Un párrafo con énfasis.',
    );
  });

  it('de un enlace conserva el texto, no la dirección', () => {
    // El texto del enlace se lee; la URL no.
    expect(soloTexto('Mira las [botas de cuero](/es/producto/botas) que tenemos')).toBe(
      'Mira las botas de cuero que tenemos',
    );
  });

  it('una imagen no aporta palabras', () => {
    expect(soloTexto('![Botas de cuero sobre madera](/img/botas.jpg) Texto real')).toBe(
      'Texto real',
    );
  });

  it('los bloques de código no cuentan como lectura', () => {
    // Contarlos infla el tiempo estimado: nadie "lee" un bloque de código a
    // la misma velocidad que un párrafo.
    const con = 'Antes\n```\nconst x = 1;\nconst y = 2;\n```\nDespués';

    expect(soloTexto(con)).toBe('Antes Después');
  });

  it('el HTML incrustado también se limpia', () => {
    expect(soloTexto('<p>Hola <strong>mundo</strong></p>')).toBe('Hola mundo');
  });
});

describe('Tiempo de lectura', () => {
  it('un artículo normal da un número creíble', () => {
    const cuerpo = 'palabra '.repeat(600);

    expect(minutosDeLectura(cuerpo)).toBe(3);
  });

  it('nunca sale cero', () => {
    // "0 min de lectura" parece un artículo vacío.
    expect(minutosDeLectura('Tres palabras aquí')).toBe(1);
    expect(minutosDeLectura('')).toBe(1);
  });

  it('redondea hacia arriba', () => {
    // Decir "3 min" y que se tarden 5 deja peor sensación que al revés.
    expect(minutosDeLectura('palabra '.repeat(201))).toBe(2);
  });

  it('el marcado no infla el tiempo', () => {
    // Las mismas palabras, una vez en crudo y otra en negrita. Si los
    // asteriscos se convirtieran en espacios, cada palabra contaría por tres.
    const limpio = 'palabra '.repeat(400);
    const conMarcado = '**palabra** '.repeat(400);

    expect(minutosDeLectura(conMarcado)).toBe(minutosDeLectura(limpio));
  });

  it('los encabezados cuentan como texto, porque se leen', () => {
    const soloCuerpo = 'palabra '.repeat(100);
    const conTitulo = `# Un título de cinco palabras\n\n${soloCuerpo}`;

    expect(minutosDeLectura(conTitulo)).toBeGreaterThanOrEqual(minutosDeLectura(soloCuerpo));
  });
});

describe('Resumen para el listado y para compartir', () => {
  it('manda el que haya escrito quien redacta', () => {
    // Uno automático siempre es peor: arranca por donde arranque el texto y
    // no tiene gancho.
    expect(resumen('Cuerpo larguísimo del artículo', 'Todo lo que hay que saber')).toBe(
      'Todo lo que hay que saber',
    );
  });

  it('si no lo hay, se saca del cuerpo', () => {
    expect(resumen('Un artículo corto sobre botas.')).toBe('Un artículo corto sobre botas.');
  });

  it('corta por frase entera cuando puede', () => {
    const cuerpo = `${'Primera frase completa. '.repeat(5)}Y sigue mucho más texto después.`;
    const r = resumen(cuerpo, null, 120);

    expect(r.endsWith('.')).toBe(true);
    expect(r.length).toBeLessThanOrEqual(120);
  });

  it('sin frase a mano, corta por palabra y lo indica', () => {
    // Un corte a mitad de palabra en la tarjeta de un tuit se ve fatal.
    const cuerpo = 'palabralarguisima '.repeat(30);
    const r = resumen(cuerpo, null, 100);

    expect(r.endsWith('…')).toBe(true);
    expect(r).not.toMatch(/palabralarg$/);
  });

  it('un resumen vacío no cuenta como escrito', () => {
    expect(resumen('El cuerpo del artículo', '   ')).toBe('El cuerpo del artículo');
  });
});

describe('Título para Google', () => {
  it('usa el meta título si lo hay', () => {
    expect(tituloSeo('Título largo del artículo', 'Botas de cuero: guía')).toBe(
      'Botas de cuero: guía',
    );
  });

  it('cae al título del artículo si no', () => {
    expect(tituloSeo('Guía de botas')).toBe('Guía de botas');
  });

  it('recorta sin partir palabras', () => {
    // Google corta alrededor de 60; lo que suele quedar fuera es el final,
    // que es donde va lo distintivo.
    const largo = 'Guía completa para elegir botas de cuero en invierno y no equivocarse';
    const r = tituloSeo(largo);

    expect(r.length).toBeLessThanOrEqual(60);
    expect(largo.startsWith(r)).toBe(true);
    expect(r.endsWith(' ')).toBe(false);
  });
});
