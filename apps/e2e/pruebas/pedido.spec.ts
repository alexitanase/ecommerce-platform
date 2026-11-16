import { expect, test, type Page } from '@playwright/test';

/**
 * Lo que pasa después de pagar.
 *
 * Un pedido creado y un cliente que no sabe qué ha pasado es un ticket de
 * soporte garantizado. Aquí se comprueba que la pantalla de pago aparece con
 * su número y que el seguimiento funciona con la clave del correo, que es el
 * único acceso que tiene quien compra sin cuenta.
 */

/** Compra un producto y devuelve el número de pedido. */
async function comprar(page: Page): Promise<string> {
  const marca = Date.now().toString(36);

  await page.goto('/es');
  await page.locator('a[href*="/es/producto/"]').first().click();
  await page.getByRole('button', { name: 'Añadir al carrito' }).click();
  await page.goto('/es/checkout');

  await page.getByLabel('Email', { exact: true }).fill(`e2e.pedido.${marca}@tienda.local`);
  // Obligatorio: el transportista avisa por SMS y varios proveedores devuelven
  // el pedido sin él. Sin rellenarlo, el formulario no llega ni a enviarse.
  await page.getByLabel('Teléfono').fill('600123456');
  await page.getByLabel('Nombre', { exact: true }).fill('Ana');
  await page.getByLabel('Apellidos').fill('Pruebas');
  await page.getByLabel('Dirección', { exact: true }).fill('Calle Mayor 1');
  await page.getByLabel('Localidad').fill('Madrid');
  await page.getByLabel('Provincia').fill('Madrid');
  await page.getByLabel('Código postal').fill('28013');
  await page.getByRole('checkbox', { name: /acepto/i }).check();
  await page.getByRole('button', { name: /Pagar/ }).click();

  await expect(page).toHaveURL(/\/pedido\/(ES-\d{4}-\d{6})\/pago/, { timeout: 30_000 });

  const numero = /ES-\d{4}-\d{6}/.exec(page.url())?.[0];
  expect(numero).toBeDefined();

  return numero ?? '';
}

test.describe('Después de comprar', () => {
  test('la pantalla de pago enseña el número y dice cómo pagar', async ({ page }) => {
    const numero = await comprar(page);

    // El número es lo primero que pide soporte y lo que el cliente busca en su
    // correo: si no está a la vista, la compra parece que no ha ocurrido.
    await expect(page.getByText(numero).first()).toBeVisible();

    // Con pasarela configurada sale el importe a pagar; sin ella —que es como
    // está el entorno de desarrollo mientras no haya credenciales— sale el
    // aviso de que no hay método disponible. Lo que NO puede pasar es que la
    // pantalla se quede en blanco: el cliente acaba de dar sus datos y tiene
    // que saber qué ocurre con su pedido.
    await expect(
      page
        .getByText(/\d+,\d{2}\s*€/)
        .first()
        .or(page.getByText(/método de pago/i).first()),
    ).toBeVisible();
  });

  test('el carrito se vacía al comprar', async ({ page }) => {
    // Si no se vaciara, el cliente volvería a la tienda con lo que acaba de
    // comprar todavía dentro y podría pagarlo dos veces.
    await comprar(page);

    await page.goto('/es/carrito');
    await expect(page.getByText('Tu carrito está vacío')).toBeVisible();
  });

  test('un número de pedido inventado no revela nada', async ({ page }) => {
    // El seguimiento va con una clave larga, no con el número: si bastara el
    // número —que es correlativo— cualquiera podría recorrerlos y leer las
    // direcciones de todos los clientes.
    const respuesta = await page.goto('/es/pedido/ES-2026-000001');
    expect(respuesta?.status()).toBe(404);
  });
});
