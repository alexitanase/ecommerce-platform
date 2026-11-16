import { describe, expect, it } from 'vitest';
import { sanearCss, sanearDocumento, sanearHtml, sanearSvg } from './saneado.js';
import type { Capa, Documento } from '@ecom/shared';

/**
 * Cada caso de aquí es un XSS almacenado en el panel de administración.
 *
 * El marcado que se sanea acaba pintado en el mismo origen donde vive la sesión
 * de quien tiene todos los permisos: los pedidos, los clientes y las claves de
 * las pasarelas. No es una comprobación de estilo, es la frontera.
 */

describe('sanearHtml', () => {
  it('quita los scripts enteros, con su contenido', () => {
    const limpio = sanearHtml('<div>Hola<script>fetch("/api/v1/users")</script></div>');
    expect(limpio).toContain('Hola');
    expect(limpio).not.toContain('script');
    expect(limpio).not.toContain('fetch');
  });

  it('quita los manejadores de eventos', () => {
    for (const sucio of [
      '<div onclick="robar()">x</div>',
      '<img src="x" onerror="robar()" />',
      '<div onmouseover="robar()">x</div>',
      '<svg onload="robar()"></svg>',
    ]) {
      expect(sanearHtml(sucio), sucio).not.toMatch(/on[a-z]+=/i);
    }
  });

  it('quita los enlaces que ejecutan código', () => {
    expect(sanearHtml('<a href="javascript:robar()">pulsa</a>')).not.toContain('javascript');
  });

  it('quita marcos y objetos incrustados', () => {
    for (const etiqueta of ['iframe', 'object', 'embed']) {
      const limpio = sanearHtml(`<${etiqueta} src="https://malo.example"></${etiqueta}>`);
      expect(limpio, etiqueta).not.toContain(etiqueta);
    }
  });

  it('conserva lo que hace falta para que la pieza se vea', () => {
    const limpio = sanearHtml(
      '<div style="display:flex;background:linear-gradient(90deg,#e11d48,#7c3aed)"><img src="https://cdn.example/foto.jpg" alt="" /><span style="font-weight:700">-40 %</span></div>',
    );

    expect(limpio).toContain('display:flex');
    expect(limpio).toContain('linear-gradient');
    expect(limpio).toContain('https://cdn.example/foto.jpg');
    expect(limpio).toContain('font-weight:700');
  });

  /*
   * Una etiqueta de estilo dentro del marcado saca datos del panel sin ejecutar
   * una línea de JavaScript: `input[value^="a"]{background:url(https://malo…)}`
   * y se va filtrando lo que haya escrito en pantalla. El CSS de un bloque vive
   * en su propio campo, saneado aparte y acotado a su capa.
   */
  it('quita las etiquetas de estilo incrustadas', () => {
    const limpio = sanearHtml(
      '<div><style>div{background:url(https://malo.example)}</style>ok</div>',
    );
    expect(limpio).toContain('ok');
    expect(limpio).not.toContain('style>');
    expect(limpio).not.toContain('malo.example');
  });

  it('deja pasar las imágenes en data:, que es como se exporta', () => {
    const limpio = sanearHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="" />');
    expect(limpio).toContain('data:image/png');
  });
});

describe('sanearSvg', () => {
  /*
   * El caso que se escapa de la configuración por defecto: `sanitize-html`
   * pasa todo a minúsculas, y en SVG la caja importa. Un `linearGradient`
   * convertido en `lineargradient` deja el logotipo sintácticamente correcto y
   * visualmente roto, sin un solo error por ningún lado.
   */
  it('respeta las mayúsculas de los nombres de SVG', () => {
    const limpio = sanearSvg(
      '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)" clipPath="none"/></svg>',
    );

    expect(limpio).toContain('linearGradient');
    expect(limpio).toContain('viewBox');
    expect(limpio).toContain('stop-color');
  });

  it('quita el foreignObject, que es la puerta de vuelta al HTML', () => {
    const limpio = sanearSvg(
      '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><script>robar()</script></div></foreignObject></svg>',
    );
    expect(limpio).not.toContain('foreignObject');
    expect(limpio).not.toContain('robar');
  });

  it('quita los scripts y los eventos dentro del dibujo', () => {
    const limpio = sanearSvg('<svg><script>robar()</script><rect onload="robar()"/></svg>');
    expect(limpio).not.toContain('robar');
    expect(limpio).not.toMatch(/on[a-z]+=/i);
  });

  it('conserva la geometría', () => {
    const limpio = sanearSvg(
      '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="#111"/></svg>',
    );
    expect(limpio).toContain('M4 4h16v16H4z');
    expect(limpio).toContain('fill="#111"');
  });
});

describe('sanearCss', () => {
  it('quita @import, que trae CSS de fuera y delata la IP de quien edita', () => {
    expect(sanearCss('@import url("https://fuera.example/x.css"); p{color:red}')).not.toContain(
      '@import',
    );
  });

  it('quita el cierre de etiqueta incrustado', () => {
    // Sin esto, un `</style>` dentro del CSS cierra la etiqueta antes de tiempo
    // y lo que venga detrás se pinta como marcado libre en la página.
    const limpio = sanearCss('p{color:red}</style><script>robar()</script>');
    expect(limpio).not.toContain('</style');
  });

  it('conserva las reglas normales', () => {
    expect(sanearCss('.titular{font-size:32px;color:#e11d48}')).toContain('font-size:32px');
  });
});

describe('sanearDocumento', () => {
  const documento = (capas: Capa[]): Documento => ({
    version: 1,
    mesas: [
      {
        id: 'm1',
        nombre: '',
        formato: '',
        ancho: 300,
        alto: 250,
        fondo: { tipo: 'solido', color: '#ffffff' },
        posicion: { x: 0, y: 0 },
        maestra: true,
      },
    ],
    capas,
    estilos: { colores: [], textos: [] },
    variables: [],
    animacion: { duracionMs: 0, bucles: 3 },
  });

  const base = {
    id: 'c1',
    mesaId: 'm1',
    orden: 0,
    nombre: '',
    visible: true,
    bloqueada: false,
    opacidad: 1,
    fusion: 'normal',
    recuadro: { x: 0, y: 0, ancho: 100, alto: 100, rotacion: 0 },
    anclaje: { x: 'izquierda', y: 'arriba' },
  };

  it('limpia las capas de HTML y las de vector', () => {
    const doc = documento([
      { ...base, tipo: 'html', html: '<div>ok<script>robar()</script></div>', css: '@import "x";' },
      { ...base, id: 'c2', tipo: 'vector', svg: '<svg><script>robar()</script></svg>' },
    ] as Capa[]);

    const limpio = sanearDocumento(doc);
    const html = limpio.capas[0];
    const vector = limpio.capas[1];

    expect(html?.tipo === 'html' && html.html).toContain('ok');
    expect(html?.tipo === 'html' && html.html).not.toContain('robar');
    expect(html?.tipo === 'html' && html.css).not.toContain('@import');
    expect(vector?.tipo === 'vector' && vector.svg).not.toContain('robar');
  });

  it('no toca las capas que no llevan marcado', () => {
    const doc = documento([
      {
        ...base,
        tipo: 'forma',
        forma: 'rectangulo',
        relleno: { tipo: 'solido', color: '#000000' },
        radio: 0,
        puntas: 5,
      },
    ] as Capa[]);

    expect(sanearDocumento(doc).capas[0]).toEqual(doc.capas[0]);
  });
});
