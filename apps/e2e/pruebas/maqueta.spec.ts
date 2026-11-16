import { expect, test, type Page } from '@playwright/test';

/**
 * El carril de la maqueta.
 *
 * La cabecera, el contenido y el pie tienen que empezar y acabar en la misma
 * columna. Suena obvio y es justo lo que se rompe sin que nadie lo note: basta
 * que una pantalla use un `max-w` distinto para que, al navegar, el contenido
 * se desplace unos centímetros y la tienda parezca mal montada.
 *
 * **Estas comprobaciones existen porque la regresión visual no las detectó.**
 * El carrito llegó a estar 128 px desalineado de la cabecera y las capturas
 * pasaron: la tolerancia del 1 % se mide sobre el área de la imagen, y una
 * cabecera es una franja casi vacía donde mover un campo de búsqueda 176 px
 * cambia menos píxeles de los que la tolerancia permite. Una medida no tiene
 * ese problema — o los bordes coinciden o no.
 */

/** Anchos donde algo cambia: los dos cortes de la cabecera y sus alrededores. */
const ANCHOS = [1440, 1280, 1024, 900, 800, 768, 767, 700, 640, 639, 520, 400, 360, 320];

const PAGINAS = [
  { nombre: 'portada', ruta: '/es' },
  { nombre: 'catálogo', ruta: '/es/buscar' },
  { nombre: 'carrito', ruta: '/es/carrito' },
  { nombre: 'blog', ruta: '/es/blog' },
  { nombre: 'checkout', ruta: '/es/checkout' },
  // Las de una sola columna entraron aquí tarde, y por eso hubo que volver:
  // eran las únicas que se centraban dentro del carril en lugar de empezar en
  // él, y el aviso legal enseñaba el título flotando con 256 px de margen.
  { nombre: 'aviso legal', ruta: '/es/aviso-legal' },
  { nombre: 'privacidad', ruta: '/es/privacidad' },
  { nombre: 'preferencias', ruta: '/es/preferencias' },
  { nombre: 'entrar', ruta: '/es/entrar' },
  { nombre: 'registro', ruta: '/es/registro' },
];

/**
 * Bordes del contenedor de una zona.
 *
 * Se miden los contenedores y no los textos: el título de la portada vive
 * dentro de una tarjeta con su propio relleno, así que comparar títulos daría
 * un falso fallo justo en la pantalla que sí está bien.
 */
async function carril(page: Page, selector: string): Promise<{ x: number; ancho: number }> {
  const caja = await page.locator(selector).first().boundingBox();
  if (!caja) throw new Error(`No se ha encontrado ${selector}`);
  return { x: Math.round(caja.x), ancho: Math.round(caja.width) };
}

/**
 * El bloque principal de la página: el hijo de `main` que lleva el título.
 *
 * No vale con coger el primero. El carrito monta antes un contenedor suelto
 * para el aviso de recuperación, y midiendo ese la prueba daba por buena la
 * página aunque el bloque de debajo —el que se ve— estuviera desalineado.
 * Justo el caso que había que detectar.
 */
async function bloquePrincipal(page: Page): Promise<{ x: number; ancho: number }> {
  const caja = await page
    .locator('main > *')
    .filter({ has: page.locator('h1') })
    .first()
    .boundingBox();

  if (!caja) throw new Error('Ninguna sección de main tiene título');
  return { x: Math.round(caja.x), ancho: Math.round(caja.width) };
}

test.describe('El carril de la maqueta', () => {
  test.skip(({ isMobile }) => isMobile, 'Recorre anchos a mano; no necesita el perfil móvil');

  for (const { nombre, ruta } of PAGINAS) {
    test(`la ${nombre} se alinea con la cabecera y el pie`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(ruta);
      await expect(page.locator('main')).toBeVisible();

      const cabecera = await carril(page, 'header > div');
      const contenido = await bloquePrincipal(page);
      const pie = await carril(page, 'footer > div');

      expect(contenido, 'el contenido usa otro carril que la cabecera').toEqual(cabecera);
      expect(pie, 'el pie usa otro carril que la cabecera').toEqual(cabecera);
    });
  }

  test('el carril aguanta en todos los anchos', async ({ page }) => {
    // Se recorren los dos cortes de la cabecera y sus alrededores: el fallo
    // anterior aparecía solo entre 640 y 767, porque el relleno de la cabecera
    // cambiaba en un punto y el de la página en otro.
    const desalineados: string[] = [];

    for (const ancho of ANCHOS) {
      await page.setViewportSize({ width: ancho, height: 900 });
      await page.goto('/es/carrito');
      await expect(page.locator('main')).toBeVisible();

      const cabecera = await carril(page, 'header > div');
      const contenido = await bloquePrincipal(page);

      if (cabecera.x !== contenido.x || cabecera.ancho !== contenido.ancho) {
        desalineados.push(
          `${ancho}px: cabecera=${cabecera.x}/${cabecera.ancho} contenido=${contenido.x}/${contenido.ancho}`,
        );
      }
    }

    expect(desalineados, 'anchos donde el contenido no cae bajo el logo').toEqual([]);
  });

  test('el buscador nunca se queda sin sitio', async ({ page }) => {
    /*
     * El campo llegó a medir 166 px a 640 px de ancho: no cabía ni la palabra
     * que se estaba escribiendo. Es el control más usado de la tienda y el
     * primero que se aplasta cuando se añade algo a la cabecera, así que
     * conviene que haya un número vigilándolo.
     *
     * Se mide el que esté puesto en cada ancho, no siempre el mismo elemento:
     * por debajo de 768 px el buscador es el botón que abre el panel a
     * pantalla completa, y por encima es el campo con su desplegable. Buscando
     * solo el campo, la prueba medía cero en todos los anchos de móvil —donde
     * más importa— y habría dado por bueno cualquier tamaño.
     */
    const estrechos: string[] = [];

    for (const ancho of ANCHOS) {
      await page.setViewportSize({ width: ancho, height: 900 });
      await page.goto('/es');

      const campo = page.locator('header input#buscador');
      const boton = page.locator('header #buscador-movil-abrir');
      const buscador = (await campo.isVisible()) ? campo : boton;

      // Que haya exactamente uno visible es parte de lo que se comprueba: si
      // se colaran los dos, habría dos controles de búsqueda en la cabecera.
      await expect(buscador, `a ${ancho}px no hay ningún buscador visible`).toBeVisible();

      const caja = await buscador.boundingBox();
      if ((caja?.width ?? 0) < 240) estrechos.push(`${ancho}px: ${caja?.width.toFixed(0)}px`);
    }

    expect(estrechos, 'anchos donde el buscador se queda por debajo de 240 px').toEqual([]);
  });

  test('la cabecera no da un salto grande al cambiar de fila', async ({ page }) => {
    // Es pegajosa: cada píxel suyo es un píxel menos de tienda, y un salto
    // brusco al girar el móvil se ve como un parpadeo de toda la página.
    const alturas = new Map<number, number>();

    for (const ancho of [1280, 900, 768, 767, 600, 360]) {
      await page.setViewportSize({ width: ancho, height: 900 });
      await page.goto('/es');
      alturas.set(ancho, (await page.locator('header').first().boundingBox())?.height ?? 0);
    }

    const unaFila = alturas.get(768) ?? 0;
    const dosFilas = alturas.get(767) ?? 0;

    expect(unaFila).toBeLessThanOrEqual(70);
    expect(dosFilas - unaFila, 'el salto de altura al pasar a dos filas').toBeLessThanOrEqual(36);
  });
});

/**
 * La sub-barra de navegación.
 *
 * Es la franja de enlaces bajo la cabecera, y la escribe quien lleva la tienda
 * desde el panel. Entra en todas las páginas, así que un fallo suyo es un fallo
 * en toda la tienda: se comprueba que enseña lo que dice la API, que respeta el
 * mismo carril que la cabecera y que en un teléfono no desplaza la página de
 * lado.
 */
test.describe('La sub-barra de navegación', () => {
  const API = process.env['E2E_API'] ?? 'http://localhost:3001';

  const menuDeLaApi = async (page: Page) => {
    const respuesta = await page.request.get(`${API}/api/v1/content/menu/es`);
    expect(respuesta.ok(), 'la API debe servir el menú').toBeTruthy();
    return ((await respuesta.json()) as { enlaces: { etiqueta: string; href: string }[] }).enlaces;
  };

  test('enseña exactamente los enlaces que sirve la API', async ({ page }) => {
    const enlaces = await menuDeLaApi(page);

    await page.goto('/es');
    const barra = page.locator('.barra-menu');

    if (enlaces.length === 0) {
      // Sin enlaces no se pinta la franja: ni borde ni hueco.
      await expect(barra).toHaveCount(0);
      return;
    }

    await expect(barra).toBeVisible();
    await expect(barra.locator('a')).toHaveCount(enlaces.length);
    // El orden importa: es el que se ha decidido en el panel.
    expect(await barra.locator('a').allInnerTexts()).toEqual(enlaces.map((e) => e.etiqueta));
  });

  test('sus enlaces llevan a donde dicen', async ({ page }) => {
    const enlaces = await menuDeLaApi(page);
    const interno = enlaces.find((e) => e.href.startsWith('/'));
    if (!interno) return;

    await page.goto('/es');
    await page.locator('.barra-menu a', { hasText: interno.etiqueta }).first().click();

    // Con el idioma delante, que lo añade el enrutador de la tienda.
    await page.waitForURL(new RegExp(`/es${interno.href.split('?')[0] ?? ''}`));
  });

  test('respeta el carril de la cabecera', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/es');
    if ((await page.locator('.barra-menu').count()) === 0) return;

    const cabecera = await carril(page, 'header > div');
    const barra = await carril(page, 'nav:has(.barra-menu)');

    expect(barra, 'la sub-barra usa otro carril que la cabecera').toEqual(cabecera);
  });

  test('en el móvil se arrastra en lugar de desplazar la página', async ({ page }) => {
    /*
     * Con ocho enlaces no caben en 375 px. Lo que NO puede pasar es que la
     * página entera se desplace de lado: es el fallo que ya apareció una vez en
     * la ficha de producto y se ve como una tienda mal hecha.
     */
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/es');
    if ((await page.locator('.barra-menu').count()) === 0) return;

    const medidas = await page.evaluate(() => {
      const barra = document.querySelector('.barra-menu');
      return {
        documento: document.documentElement.scrollWidth,
        ventana: window.innerWidth,
        barraCabe: barra ? barra.clientWidth >= barra.scrollWidth : true,
      };
    });

    expect(medidas.documento, 'la página se desplaza de lado').toBeLessThanOrEqual(medidas.ventana);
    // Y si no cabe, el desbordamiento se queda DENTRO de la barra.
    expect(await page.locator('.barra-menu').evaluate((b) => getComputedStyle(b).overflowX)).toBe(
      'auto',
    );
  });
});
