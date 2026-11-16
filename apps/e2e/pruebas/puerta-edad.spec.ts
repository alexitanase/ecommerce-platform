import { expect, test, type Page } from '@playwright/test';

/**
 * La puerta de la tienda.
 *
 * Toda la tienda es +18, así que la verificación va en la entrada. Estas
 * pruebas empiezan SIN cookie —el proyecto `puerta` no comparte el
 * `storageState` de los demás— porque es el único estado en el que la puerta
 * existe.
 *
 * Lo que protegen, que ya falló una vez cada cosa:
 *
 *  · Que la puerta aparezca. Sin ella, un catálogo entero marcado como +18 se
 *    traduce en una portada vacía y un buscador que no encuentra nada.
 *  · Que las páginas legales queden fuera. La LSSI obliga a que el aviso legal
 *    y la privacidad sean accesibles a cualquiera.
 *  · Que verificar sirva de algo. La cookie la ponía la API en su subdominio,
 *    así que la tienda no la veía nunca: se verificaba y la puerta volvía a
 *    salir en la página siguiente, para siempre.
 */

const puerta = (texto: string) => texto.includes('18');

/**
 * Que la puerta NO esté, buscándola por lo suyo y no por «hay un diálogo».
 *
 * Se comprobaba con `getByRole('dialog')` a cero, y eso fallaba una de cada
 * tres pasadas completas sin que nada estuviera roto: el aviso de cookies
 * también es un `role="dialog"` y se monta al hidratar, así que la prueba
 * competía con la hidratación. Si ganaba, verde; si perdía, rojo.
 *
 * El campo del año de nacimiento solo existe en la puerta, y es además como se
 * la reconoce en el resto de este fichero.
 */
const puertaVisible = (page: Page) => page.getByLabel(/año de nacimiento/i);

test('sin verificar, la tienda entera pide la edad', async ({ page }) => {
  await page.goto('/es');

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel(/año de nacimiento/i)).toBeVisible();
});

test('la URL no cambia: se vuelve a donde ibas', async ({ page }) => {
  // Se reescribe en lugar de redirigir. Es lo que permite que, al verificar,
  // la recarga lleve al producto que se buscaba y no a la portada.
  await page.goto('/es/buscar?q=algo');

  await expect(page.getByRole('dialog')).toBeVisible();
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe('/es/buscar?q=algo');
});

test('las páginas legales se ven sin verificar', async ({ page }) => {
  for (const ruta of ['/es/privacidad', '/es/aviso-legal', '/es/condiciones']) {
    await page.goto(ruta);
    await expect(puertaVisible(page), ruta).toHaveCount(0);
  }
});

test('el seguimiento de un pedido no pide la edad', async ({ page }) => {
  // El enlace del correo de confirmación tiene que funcionar sin más: quien ya
  // ha comprado no puede encontrarse un formulario para ver dónde va su
  // paquete. Da igual que el token no exista: lo que se comprueba es que la
  // puerta no se interpone.
  await page.goto('/es/pedido/token-que-no-existe');

  await expect(puertaVisible(page)).toHaveCount(0);
});

test('un menor no entra', async ({ page }) => {
  await page.goto('/es');

  await page.getByLabel(/año de nacimiento/i).fill(String(new Date().getFullYear() - 12));
  await page.getByRole('button', { name: /continuar/i }).click();

  // No pasa, y además no se queda con la puerta puesta para reintentar: se le
  // dice que no y se le ofrece salir.
  await expect(page.getByRole('link', { name: /salir/i })).toBeVisible();
  await expect(page.getByLabel(/año de nacimiento/i)).toHaveCount(0);
});

test('al verificar se entra y NO vuelve a preguntar', async ({ page }) => {
  await page.goto('/es');

  await page.getByLabel(/año de nacimiento/i).fill('1990');
  await page.getByRole('button', { name: /continuar/i }).click();

  // La página se recarga sola con la cookie ya puesta.
  await expect(page.getByRole('dialog')).toHaveCount(0);

  /*
   * Y aquí está el fallo que motivó esta prueba: la cookie la pone la API, que
   * en producción vive en otro subdominio. Sin `COOKIE_DOMAIN`, la tienda no
   * la veía al pintar la página siguiente en el servidor y la puerta volvía a
   * aparecer eternamente. Navegar a otra ruta es lo único que lo detecta.
   */
  await page.goto('/es/buscar');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(puerta(await page.title())).toBe(false);
});
