import { expect, test, type Page } from '@playwright/test';

/**
 * Entrar, registrarse y salir.
 *
 * Estas pruebas existen porque durante semanas **no había forma de iniciar
 * sesión en la tienda**. La API lo soportaba entero —registro, login, 2FA,
 * recuperar contraseña— y las pantallas no estaban: `/entrar` devolvía un 404
 * y los enlaces de los correos ya enviados, también. No falló ningún test
 * porque ninguno abría esas rutas.
 *
 * De ahí que lo primero que se comprueba sea lo más tonto: que las páginas
 * respondan.
 */

/**
 * Una cuenta fija que se crea la primera vez y se reutiliza siempre.
 *
 * Registrarse tiene un límite de 5 por hora y por IP, y está bien que lo
 * tenga: es lo que impide que alguien cree mil cuentas para agotar cupones.
 * Pero una prueba por cuenta agotaba el cupo a la segunda pasada y la suite
 * empezaba a fallar sola, con un error que no era un fallo del código.
 *
 * Hoy el cupo también va multiplicado fuera de producción, pero reutilizar la
 * cuenta se queda: cada registro es un usuario más en la base de pruebas y
 * veinte pasadas dejaban doscientos.
 *
 * Unas pruebas que fallan según la hora a la que se ejecuten se acaban
 * desactivando, y entonces no protegen nada. Así que se intenta entrar
 * primero y solo se registra si la cuenta no existe todavía: a partir de la
 * primera vez, cero registros.
 */
let cuenta: string;

const CUENTA_FIJA = 'e2e-cliente@ejemplo.es';
const PASSWORD = 'Contrasena123';

async function asegurarCuenta(page: Page): Promise<string> {
  await page.goto('/es/entrar');
  await page.getByLabel('Email', { exact: true }).fill(CUENTA_FIJA);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  const entro = await page
    .waitForURL(/\/es\/cuenta/, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  if (entro) return CUENTA_FIJA;

  await page.goto('/es/registro');
  await page.getByLabel('Email', { exact: true }).fill(CUENTA_FIJA);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.waitForURL(/\/es\/cuenta/);

  return CUENTA_FIJA;
}

async function entrar(page: Page, email: string): Promise<void> {
  await page.goto('/es/entrar');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.waitForURL(/\/es\/cuenta/);
}

async function salir(page: Page): Promise<void> {
  await page.goto('/es/cuenta');

  /*
   * Se espera a que la cuenta termine de recuperar la sesión antes de buscar
   * el botón.
   *
   * Al cargar, la página no sabe todavía si hay sesión: pide un token con la
   * cookie y hasta que responde enseña el esqueleto. Buscando el botón sin
   * esperar, la prueba fallaba de vez en cuando con un timeout de 60 s que no
   * decía nada — y solo dentro de la suite completa, que es cuando la API va
   * más cargada y esa respuesta tarda un poco más.
   */
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toBeVisible();
}

const PANTALLAS = [
  { nombre: 'entrar', ruta: '/es/entrar' },
  { nombre: 'registro', ruta: '/es/registro' },
  { nombre: 'recuperar contraseña', ruta: '/es/recuperar' },
  { nombre: 'restablecer contraseña', ruta: '/es/restablecer' },
  { nombre: 'verificar email', ruta: '/es/verificar-email' },
  { nombre: 'confirmar newsletter', ruta: '/es/preferencias/confirmar' },
];

test.describe('Las pantallas de sesión existen', () => {
  for (const { nombre, ruta } of PANTALLAS) {
    test(`la de ${nombre} responde y tiene título`, async ({ page }) => {
      const respuesta = await page.goto(ruta);

      expect(respuesta?.status(), `${ruta} no responde`).toBe(200);
      await expect(page.locator('main h1')).toBeVisible();
    });
  }
});

test.describe('Registrarse', () => {
  test('crear una cuenta nueva deja la sesión abierta', async ({ page }) => {
    const email = `cliente-${String(Date.now())}@ejemplo.es`;

    await page.goto('/es/registro');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();

    /*
     * El registro está limitado a 5 por hora y por IP, y está bien que lo
     * esté: es lo que impide crear mil cuentas para agotar cupones.
     *
     * Fuera de producción el cupo va multiplicado —ver el almacén del
     * limitador en la API— precisamente para que esta suite pueda ejecutarse
     * las veces que haga falta, así que en condiciones normales no se llega
     * aquí. Se deja la salida por si se ejecuta contra un entorno con los
     * cupos de verdad: ahí agotar el cupo no es un fallo del código.
     *
     * Se marca como saltada en lugar de fallar, porque un rojo que no
     * significa nada enseña a ignorar los rojos. Lo que sí se comprueba antes
     * de saltar es que la tienda lo explique en condiciones: si en vez del
     * aviso saliera un `ThrottlerException` en inglés, eso sí sería un fallo.
     */
    const limite = page.getByText(/demasiados intentos/i);
    if (await limite.isVisible().catch(() => false)) {
      test.skip(true, 'Cupo de registros por hora agotado en esta IP');
      return;
    }

    await page.waitForURL(/\/es\/cuenta/);
    await expect(page.getByText(email)).toBeVisible();
  });
});

test.describe.serial('Entrar y salir', () => {
  test('la sesión sobrevive a recargar la página', async ({ page }) => {
    // El token vive en memoria y se recupera de la cookie httpOnly. Si esto se
    // rompe, cada recarga echa al cliente sin que nadie se entere.
    cuenta = await asegurarCuenta(page);
    await page.reload();

    await expect(page.getByText(cuenta)).toBeVisible();
  });

  test('salir cierra de verdad, también al recargar', async ({ page }) => {
    await asegurarCuenta(page);
    await salir(page);

    // Si la sesión volviera al recargar, "cerrar sesión" no estaría cerrando
    // nada, y en un ordenador compartido eso es grave.
    await page.reload();
    await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toBeVisible();
  });

  test('y se puede volver a entrar con la misma cuenta', async ({ page }) => {
    await entrar(page, CUENTA_FIJA);

    await expect(page.getByText(CUENTA_FIJA)).toBeVisible();
  });
});

test.describe('Lo que no debe pasar', () => {
  test('una contraseña mala explica por qué, campo a campo', async ({ page }) => {
    await page.goto('/es/registro');
    await page.getByLabel('Email', { exact: true }).fill('prueba-password@ejemplo.es');
    await page.getByLabel('Contraseña', { exact: true }).fill('corta');
    await page.getByRole('button', { name: 'Crear cuenta' }).click();

    // El mensaje va pegado al campo, no en un aviso genérico arriba.
    await expect(page.locator('#password-error')).toBeVisible();
  });

  test('entrar con credenciales que no existen no dice cuál falla', async ({ page }) => {
    // Decir "ese email no existe" convierte el formulario en una forma de
    // saber quién es cliente de una tienda +18.
    await page.goto('/es/entrar');
    await page.getByLabel('Email', { exact: true }).fill('nadie@ejemplo.es');
    await page.getByLabel('Contraseña', { exact: true }).fill('LoQueSea123');
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();

    const aviso = page.getByRole('alert');
    await expect(aviso).toBeVisible();
    await expect(aviso).not.toContainText(/no existe|no encontrad/i);
  });

  test('el enlace de restablecer sin token no enseña el formulario', async ({ page }) => {
    await page.goto('/es/restablecer');

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test('no se puede saltar a otro dominio con ?volver=', async ({ page }) => {
    // Un salto abierto aquí permite montar un phishing con la URL de la tienda
    // delante: se entra de verdad y se acaba en otro sitio.
    await page.goto('/es/entrar?volver=//ejemplo-malo.test/');
    await page.getByLabel('Email', { exact: true }).fill(CUENTA_FIJA);
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();

    await page.waitForURL(/\/es\/cuenta/);
    expect(page.url()).not.toContain('ejemplo-malo');
  });
});

test.describe.serial('Mi cuenta, contra la API', () => {
  /*
   * La cuenta enseñaba las direcciones y no dejaba tocarlas, y no había forma
   * de cambiar la contraseña, de activar el segundo factor ni de ver dónde
   * había sesiones abiertas. Todo eso existía en la API desde el principio.
   *
   * Estas pruebas recorren cada sección: no comprueban el aspecto, comprueban
   * que el botón llama a la API y que lo que vuelve se ve.
   */

  /**
   * Abre una sección del área de cliente.
   *
   * Eran pestañas (`role=tab`) y ahora son un índice de filas: seis pestañas
   * no cabían en la fila de un móvil. En el escritorio el índice queda a la
   * izquierda y pulsar la fila cambia el contenido; en el móvil son dos
   * pantallas. El gesto es el mismo en los dos casos, así que la prueba no
   * necesita saber dónde está.
   */
  const abrirSeccion = async (page: Page, nombre: string): Promise<void> => {
    await page
      .getByRole('button', { name: new RegExp(nombre, 'i') })
      .first()
      .click();
  };

  test('se puede crear una dirección, editarla y borrarla', async ({ page }) => {
    /*
     * La calle lleva un número de serie y las aserciones van sobre ÉL, no
     * sobre el número de tarjetas de la lista.
     *
     * La primera versión daba por hecho que la cuenta empezaba sin
     * direcciones, y en cuanto una ejecución anterior dejó una a medias
     * —porque el borrado estaba roto— la prueba empezó a fallar por el
     * desorden que ella misma había dejado. Una prueba que depende de cómo
     * quedó la anterior falla el día que menos conviene.
     */
    const calle = `Calle ${String(Date.now()).slice(-6)}`;
    const calleEditada = `${calle} bis`;

    await asegurarCuenta(page);
    await abrirSeccion(page, 'Direcciones');

    await page.getByRole('button', { name: /Nueva dirección/ }).click();
    await page.getByLabel('Nombre', { exact: true }).fill('Ana');
    await page.getByLabel('Apellidos', { exact: true }).fill('Ruiz');
    await page.getByLabel('Dirección', { exact: true }).fill(calle);
    await page.getByLabel('Código postal').fill('28013');
    await page.getByLabel('Localidad').fill('Madrid');
    await page.getByLabel('Provincia').fill('Madrid');
    await page.getByRole('button', { name: 'Guardar' }).click();

    const tarjeta = page.locator('li').filter({ hasText: calle });
    await expect(tarjeta).toHaveCount(1);

    // Editar: la dirección vieja no puede quedarse ahí para siempre.
    await tarjeta.getByRole('button', { name: 'Editar' }).click();
    await page.getByLabel('Dirección', { exact: true }).fill(calleEditada);
    await page.getByRole('button', { name: 'Guardar' }).click();

    const editada = page.locator('li').filter({ hasText: calleEditada });
    await expect(editada).toHaveCount(1);

    page.once('dialog', (d) => void d.accept());
    await editada.getByRole('button', { name: 'Eliminar' }).click();

    await expect(page.locator('li').filter({ hasText: calleEditada })).toHaveCount(0);
  });

  test('un código postal imposible lo rechaza la API y se ve en el campo', async ({ page }) => {
    // En España los dos primeros dígitos son la provincia: 99xxx no existe.
    // La regla vive en la API y aquí solo se comprueba que llegue al campo.
    await asegurarCuenta(page);
    await abrirSeccion(page, 'Direcciones');
    await page.getByRole('button', { name: /Nueva dirección/ }).click();

    await page.getByLabel('Nombre', { exact: true }).fill('Ana');
    await page.getByLabel('Apellidos', { exact: true }).fill('Ruiz');
    await page.getByLabel('Dirección', { exact: true }).fill('Calle Rechazada 1');
    await page.getByLabel('Código postal').fill('99999');
    await page.getByLabel('Localidad').fill('Madrid');
    await page.getByLabel('Provincia').fill('Madrid');
    await page.getByRole('button', { name: 'Guardar' }).click();

    await expect(page.locator('#dir-postalCode-error')).toBeVisible();
  });

  test('el perfil guarda el nombre y se ve al recargar', async ({ page }) => {
    await asegurarCuenta(page);
    await abrirSeccion(page, 'Mis datos');

    const nombre = `Ana${String(Date.now()).slice(-4)}`;
    await page.getByLabel('Nombre', { exact: true }).fill(nombre);
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Datos guardados')).toBeVisible();

    await page.reload();
    await abrirSeccion(page, 'Mis datos');
    await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue(nombre);
  });

  test('seguridad enseña las sesiones abiertas y marca la actual', async ({ page }) => {
    await asegurarCuenta(page);
    await abrirSeccion(page, 'Seguridad');

    await expect(page.getByRole('heading', { name: 'Sesiones abiertas' })).toBeVisible();
    await expect(page.getByText('Esta sesión')).toBeVisible();
  });

  test('activar el segundo factor empieza por enseñar el QR', async ({ page }) => {
    await asegurarCuenta(page);
    await abrirSeccion(page, 'Seguridad');

    await page.getByRole('button', { name: 'Activar', exact: true }).click();

    await expect(page.getByAltText(/QR/i)).toBeVisible();
    // Y el secreto en texto, para quien no puede escanear.
    await page.getByText('No puedo escanearlo').click();
    await expect(page.locator('details p')).toBeVisible();
  });

  test('cambiar la contraseña con la actual mal puesta lo dice', async ({ page }) => {
    await asegurarCuenta(page);
    await abrirSeccion(page, 'Seguridad');

    await page.getByLabel('Contraseña actual').fill('EstaNoEsLaBuena9');
    await page.getByLabel('Elige una contraseña nueva').fill('OtraContrasena9');
    await page.getByRole('button', { name: 'Cambiar contraseña' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
  });
});

/**
 * Entrar con Google.
 *
 * Otro caso de lo mismo que abre este fichero: la API tenía el acceso social
 * entero —flujo de código con PKCE, `state` en servidor, vinculación con la
 * cuenta existente— y la tienda no lo ofrecía en ninguna parte. Quien lo
 * configuraba en el panel no veía aparecer nada, y el único camino que había
 * —escribir la URL a mano— terminaba en una página de JSON con el token a la
 * vista, sin sesión y sin tienda.
 *
 * Estas pruebas no hablan con Google: comprueban las dos costuras que se
 * rompieron, que son las nuestras.
 */
test.describe('Acceso con Google', () => {
  const API = process.env['E2E_API'] ?? 'http://localhost:3001';

  test('la pantalla de acceso ofrece lo que la API dice tener configurado', async ({ page }) => {
    const respuesta = await page.request.get(`${API}/api/v1/auth/oauth`);
    expect(respuesta.ok()).toBeTruthy();
    const { proveedores } = (await respuesta.json()) as { proveedores: string[] };

    await page.goto('/es/entrar');
    const boton = page.locator('[data-prueba="acceso-google"]');

    if (proveedores.includes('google')) {
      await expect(boton).toBeVisible();
    } else {
      /*
       * Sin configurar, el botón NO puede estar: lleva a una pantalla de error
       * de Google que el cliente lee como un fallo de la tienda, y justo en el
       * momento de entrar a comprar.
       */
      await expect(boton).toHaveCount(0);
    }

    // Y el acceso de siempre sigue ahí en los dos casos: el social se añade, no
    // sustituye.
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  });

  test('una vuelta fallida devuelve a la tienda y explica qué ha pasado', async ({ page }) => {
    /*
     * Se entra por la puerta de la API, que es por donde entra el navegador del
     * cliente al volver de Google. Con un `state` que no existe —lo que ocurre
     * cuando se tarda más de diez minutos— antes se respondía un 401 en JSON;
     * ahora tiene que acabar en la tienda, en la pantalla de acceso y con el
     * motivo escrito.
     */
    await page.goto(`${API}/api/v1/auth/oauth/google/callback?code=x&state=noexiste`);

    await expect(page).toHaveURL(/\/es\/entrar\?error=caducado/);
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('un motivo de error inventado no pinta nada en la pantalla', async ({ page }) => {
    // El motivo llega en la URL, así que se lo puede escribir cualquiera. Se
    // comprueba contra una lista cerrada; sin eso, la clave de traducción
    // —o el texto que hubiera puesto quien montara el enlace— acabaría dentro
    // de nuestra pantalla de acceso.
    await page.goto('/es/entrar?error=<b>texto-ajeno</b>');

    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    // `innerText` y no `textContent`: el segundo incluye el contenido de los
    // `<script>`, y Next serializa ahí los parámetros de la URL. Lo que importa
    // es que no se LEA en la pantalla.
    expect(await page.locator('body').innerText()).not.toContain('texto-ajeno');
  });
});
