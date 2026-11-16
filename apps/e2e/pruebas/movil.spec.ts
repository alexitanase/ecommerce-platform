import { expect, test, type Page } from '@playwright/test';

/**
 * Lo que solo se rompe en móvil.
 *
 * Más de la mitad del tráfico de una tienda entra desde el móvil, y es donde
 * fallan las cosas que en un monitor de 27 pulgadas no se ven: un formulario
 * más ancho que la pantalla, un botón fuera del área visible, un menú que tapa
 * el contenido.
 *
 * Estas pruebas solo tienen sentido en el proyecto "movil"; en escritorio se
 * saltan solas.
 */

test.describe('Móvil', () => {
  test.skip(({ isMobile }) => !isMobile, 'Solo aplica a la vista de móvil');

  /**
   * Ninguna página debe desplazarse en horizontal.
   *
   * Es el fallo que más molesta y menos se nota al desarrollar: el contenido
   * sobresale, la página se mueve de lado al desplazar y los botones del borde
   * quedan fuera de la pantalla. Pasó de verdad en el checkout —el nombre del
   * producto en el resumen, sin partir, fijaba una columna de 446 px dentro de
   * un móvil de 412— y el botón de pagar acababa fuera.
   */
  const paginas = [
    { nombre: 'portada', ruta: '/es' },
    { nombre: 'catálogo', ruta: '/es/buscar' },
    { nombre: 'carrito', ruta: '/es/carrito' },
    { nombre: 'lista de deseos', ruta: '/es/deseos' },
  ];

  for (const { nombre, ruta } of paginas) {
    test(`la ${nombre} no se desplaza en horizontal`, async ({ page }) => {
      await page.goto(ruta);
      await expect(page.locator('main')).toBeVisible();
      await esperarSinDesbordar(page, nombre);
    });
  }

  test('en la ficha se ve el nombre y el precio sin desplazar', async ({ page }) => {
    /*
     * La foto ocupaba todo el ancho y era cuadrada: 358 px en un móvil de 390.
     * Con la cabecera, el buscador, las migas y las miniaturas, el nombre del
     * producto empezaba en el píxel 647 y el precio en el 739. En un teléfono de
     * 667 px de alto se abría una ficha y solo había foto: para saber QUÉ era y
     * CUÁNTO costaba había que desplazar.
     *
     * Se comprueba lo que importa —que las dos cosas entren en la primera
     * pantalla— y no el tamaño de la foto: el día que se rediseñe la ficha, lo
     * que no puede volver a romperse es esto.
     */
    /*
     * A propósito en el móvil más pequeño que sigue en uso de verdad (iPhone SE,
     * 375×667) y no en el del proyecto, que es más alto. Con una pantalla alta
     * esto pasaba incluso estando roto: el nombre caía en el píxel 647 de 851 y
     * la prueba no se enteraba.
     */
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/es');
    await page.locator('a[href*="/es/producto/"]').first().click();
    // Esperar la URL y no solo el `h1`: la portada también tiene uno, así que sin
    // esto la prueba se quedaba midiendo la portada y pasaba siempre.
    await page.waitForURL(/\/es\/producto\//, { timeout: 30_000 });

    const titulo = page.getByRole('heading', { level: 1 });
    await expect(titulo).toBeVisible({ timeout: 30_000 });

    const alto = page.viewportSize()?.height ?? 0;
    const cajaTitulo = await titulo.boundingBox();
    expect(
      cajaTitulo?.y ?? Infinity,
      `el nombre del producto empieza en el píxel ${String(Math.round(cajaTitulo?.y ?? 0))} de ${String(alto)}`,
    ).toBeLessThan(alto);

    // El precio, que es la otra mitad de la decisión de comprar.
    const precio = page
      .locator('main')
      .getByText(/\d+[.,]\d{2}\s*€/)
      .first();
    const cajaPrecio = await precio.boundingBox();
    expect(
      cajaPrecio?.y ?? Infinity,
      `el precio empieza en el píxel ${String(Math.round(cajaPrecio?.y ?? 0))} de ${String(alto)}`,
    ).toBeLessThan(alto);

    /*
     * Y la regla que lo mantiene: bajo la foto no puede haber una tira de
     * miniaturas.
     *
     * La foto va a sangre y es cuadrada, así que mide lo que mide el ancho de
     * la pantalla —375 px— y eso es lo que se quiere: en el móvil se compra por
     * la foto. Lo que no cabe es lo que había debajo: las miniaturas sumaban
     * otros 50 px y eran las que empujaban el nombre al píxel 647 de 667. En su
     * sitio van puntos, que ocupan 16.
     *
     * Se mide además de lo de arriba porque aquellas dos medidas dependen del
     * producto que toque abrir —uno con una sola foto no tiene tira y cabe
     * igual— y esta no.
     */
    const ancho = page.viewportSize()?.width ?? 0;

    const bloque = await page.evaluate(() => {
      const foto = document.querySelector('.galeria-caja')?.getBoundingClientRect();
      const tiras = document.querySelector('.galeria-tiras');
      const puntos = document.querySelector('.galeria-puntos')?.getBoundingClientRect();
      if (!foto) return null;

      // Las miniaturas siguen en el DOM en el móvil pero ocultas por CSS; lo
      // que se mide es si de verdad ocupan sitio.
      const tirasVisibles =
        tiras instanceof HTMLElement && tiras.offsetParent !== null
          ? tiras.getBoundingClientRect()
          : null;

      const final = tirasVisibles?.bottom ?? puntos?.bottom ?? foto.bottom;
      return Math.round(final - foto.top);
    });

    expect(
      bloque ?? 0,
      `las imágenes ocupan ${String(bloque)}px en una pantalla de ${String(ancho)}×${String(alto)}`,
      // El cuadrado a todo ancho más los puntos. El margen de 48 px cubre los
      // puntos y su separación; una tira de miniaturas no cabe ahí.
    ).toBeLessThanOrEqual(ancho + 48);

    await esperarSinDesbordar(page, 'ficha de producto');
  });

  test('un texto sin espacios no rompe el ancho de la ficha', async ({ page }) => {
    /*
     * Lo que pasó en producción: una descripción corta con el HTML del proveedor
     * volcado como texto —quinientos caracteres sin un solo espacio— estiraba la
     * columna a 496 px dentro de un móvil de 375, y la página entera se
     * desplazaba de lado. La foto ya estaba bien; el problema era que una celda de
     * rejilla mide por defecto lo que su contenido más ancho.
     *
     * Se prueba con una cadena imposible a propósito. No es un caso rebuscado: un
     * enlace largo en una descripción hace exactamente lo mismo, y el texto lo
     * escribe siempre alguien de fuera.
     */
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/es');
    await page.locator('a[href*="/es/producto/"]').first().click();
    await page.waitForURL(/\/es\/producto\//, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });

    /*
     * Tres cosas que en producción rompieron el ancho, inyectadas a la vez:
     * texto sin espacios en el título y en la descripción corta, y una imagen con
     * `width` fijo dentro de la descripción larga.
     *
     * La imagen es la que más costó encontrar: `max-width: 100%` no limita lo que
     * una imagen aporta al ancho mínimo de una celda de rejilla, porque un
     * porcentaje no se puede resolver mientras se calcula ese mínimo.
     *
     * Aviso honesto: de los tres, esta prueba solo se ha comprobado que FALLA sin
     * el arreglo en el caso del texto sin espacios (daba 5.325 px). La imagen
     * inyectada aquí no reproduce el caso real —la de producción trae el `width`
     * en el atributo y llega dentro del HTML del proveedor—, así que ese lo
     * verifica la comprobación contra producción, no esta prueba.
     */
    await page.evaluate(() => {
      const imposible = 'x'.repeat(400);
      const h1 = document.querySelector('h1');
      if (h1) h1.textContent = imposible;
      const p = h1?.nextElementSibling;
      if (p?.tagName === 'P') p.textContent = imposible;

      const columna = document.querySelector('div.min-w-0');
      if (columna) {
        const bloque = document.createElement('div');
        bloque.className = 'contenido-ficha';
        bloque.innerHTML =
          '<p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="900" height="600" alt=""></p>';
        columna.append(bloque);
      }
    });
    await page.waitForTimeout(300);

    await esperarSinDesbordar(page, 'ficha con texto sin espacios');
  });

  test('el área de cliente se recorre con el pulgar', async ({ page }) => {
    /*
     * Antes eran pestañas y no cabían: cinco —seis con el programa de
     * invitaciones— medían 477 px dentro de 358, así que sobresalían y
     * arrastraban la página de lado. Se cambiaron por un índice de filas, que
     * es lo que se toca bien con el pulgar y lo que se reconoce de otras
     * tiendas.
     *
     * Lo que se comprueba es lo mismo que entonces —que quepan todas y que no
     * se esconda ninguna— y además lo que la lista tiene que hacer: abrir la
     * sección y poder volver.
     */
    await page.goto('/es/entrar');
    await page.getByLabel(/Email/i).first().fill('cliente@tienda.local');
    await page
      .getByLabel(/Contraseña/i)
      .first()
      .fill('Admin1234!');
    await page
      .getByRole('button', { name: /Iniciar sesión/i })
      .first()
      .click();

    await page.goto('/es/cuenta');

    const filas = page.locator('[data-prueba^="seccion-"]');
    await expect(filas.first()).toBeVisible({ timeout: 30_000 });

    // Todas las secciones siguen ahí: la solución no puede ser esconder una.
    expect(await filas.count()).toBeGreaterThanOrEqual(5);

    // Y ninguna se sale del ancho de la pantalla.
    const ancho = page.viewportSize()?.width ?? 0;
    const desbordadas = await filas.evaluateAll(
      (els, max) => els.filter((e) => e.getBoundingClientRect().right > max + 1).length,
      ancho,
    );
    expect(desbordadas, 'filas que se salen de la pantalla').toBe(0);

    // Abrir una sección deja de verse el índice: en el móvil son dos pantallas.
    await page.locator('[data-prueba="seccion-direcciones"]').click();
    await expect(page.locator('[data-prueba="seccion-direcciones"]')).toBeHidden();

    /*
     * Y el botón «atrás» del teléfono vuelve al índice, no sale de la cuenta.
     *
     * Es lo que hace que la navegación se sienta nativa; sin ello, salir de
     * «Direcciones» te echaba de la tienda a la página anterior.
     */
    await page.goBack();
    await expect(page.locator('[data-prueba="seccion-direcciones"]')).toBeVisible();

    await esperarSinDesbordar(page, 'área de cliente');
  });

  test('el checkout no se desplaza en horizontal con el carrito lleno', async ({ page }) => {
    // Con el carrito vacío el checkout no pinta el formulario, así que la
    // comprobación solo vale con algo dentro.
    await page.goto('/es');
    await page.locator('a[href*="/es/producto/"]').first().click();
    await page.getByRole('button', { name: 'Añadir al carrito' }).click();

    await page.goto('/es/checkout');
    await expect(page.getByRole('button', { name: /Pagar/ })).toBeVisible();

    await esperarSinDesbordar(page, 'checkout');
  });

  test('el botón de pagar se puede pulsar sin que nada lo tape', async ({ page }) => {
    // La casilla de condiciones quedaba debajo del resumen y no se podía
    // marcar: el cliente veía el botón, lo pulsaba y no pasaba nada.
    await page.goto('/es');
    await page.locator('a[href*="/es/producto/"]').first().click();
    await page.getByRole('button', { name: 'Añadir al carrito' }).click();
    await page.goto('/es/checkout');

    const condiciones = page.getByRole('checkbox', { name: /acepto/i });
    await condiciones.check({ timeout: 15_000 });
    await expect(condiciones).toBeChecked();
  });
});

/** Comprueba que el documento no es más ancho que la ventana. */
async function esperarSinDesbordar(page: Page, contexto: string): Promise<void> {
  const medidas = await page.evaluate(() => ({
    ventana: document.documentElement.clientWidth,
    documento: document.documentElement.scrollWidth,
  }));

  expect(
    medidas.documento,
    `${contexto}: el documento mide ${String(medidas.documento)}px en una ventana de ${String(medidas.ventana)}px`,
  ).toBeLessThanOrEqual(medidas.ventana + 1);
}
