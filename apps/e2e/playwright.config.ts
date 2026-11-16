import { defineConfig, devices } from '@playwright/test';
import { ESTADO_VERIFICADO } from './preparar.js';

/**
 * Pruebas de extremo a extremo.
 *
 * Aquí no se prueba código: se prueba la tienda. Cada prueba abre un navegador
 * de verdad contra la tienda y la API en marcha, y hace lo que haría un
 * cliente. Es lo único que detecta que el checkout se ha roto por un cambio en
 * el carrito, en la API o en un estilo que tapa el botón de pagar.
 *
 * Por eso son pocas y solo del camino crítico: una suite de doscientas pruebas
 * lentas que nadie mira no protege nada. Estas cinco cubren lo que, si se
 * rompe, deja la tienda sin vender.
 */

const TIENDA = process.env['E2E_TIENDA'] ?? 'http://localhost:3000';
const API = process.env['E2E_API'] ?? 'http://localhost:3001';
/** El panel va aparte: es otra aplicación en otro puerto. */
const ADMIN = process.env['E2E_ADMIN'] ?? 'http://localhost:5174';

/**
 * Regresión visual: solo dentro del contenedor.
 *
 * Va en su propio proyecto porque tiene una exigencia que los demás no tienen:
 * **la misma máquina**. La tienda usa la tipografía del sistema, así que el
 * mismo texto se dibuja distinto en un portátil y en el runner de CI, y una
 * captura tomada aquí no coincidiría allí ni con la página intacta.
 *
 * Por eso el proyecto ni siquiera se registra salvo que lo pida quien sabe
 * dónde está: lo hace `pnpm e2e:visual`, que ejecuta dentro de la imagen
 * oficial de Playwright. Sin esta condición, un `pnpm e2e` normal daría ocho
 * fallos que no son fallos, y unas pruebas que fallan sin motivo se acaban
 * desactivando enteras.
 */
const PROYECTO_VISUAL = {
  name: 'visual',
  testMatch: /visual\.spec\.ts/,
  use: { ...devices['Desktop Chrome'], storageState: ESTADO_VERIFICADO },
};

export default defineConfig({
  testDir: './pruebas',
  /*
   * Cruza la puerta de edad una vez y guarda la cookie para todas las pruebas.
   *
   * La tienda es +18 y sin verificar responde el formulario de edad en todas
   * sus rutas. Sin este paso, cada prueba de tienda fallaría diciendo que no
   * encuentra lo que busca, que es la peor forma posible de enterarse.
   */
  globalSetup: './preparar.ts',
  // Un fallo en local se arregla; uno en CI puede ser lentitud del runner.
  retries: process.env['CI'] ? 2 : 0,
  // En serie: comparten catálogo y stock, y dos compras a la vez del mismo
  // producto se pisan el inventario y hacen fallar la que llegue segunda.
  workers: 1,
  timeout: 60_000,

  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],

  /*
   * Tolerancia de las comparaciones de imagen.
   *
   * Cero sería lo ideal y es inalcanzable: el antialiasing del texto varía
   * entre ejecuciones aun en la misma máquina.
   *
   * Se cuenta en píxeles absolutos y no en porcentaje del área, y esto costó
   * un fallo real: con un 1 % del área, una cabecera de 1280×66 admitía 845
   * píxeles de diferencia, más de los que cambian al mover el buscador 176 px
   * de sitio. La cabecera se rediseñó, la captura no se enteró y la referencia
   * se quedó enseñando una maqueta que ya no existía.
   *
   * El ruido de antialiasing depende de cuánto TEXTO hay, no del tamaño de la
   * imagen, así que un número absoluto es la unidad correcta. Las capturas de
   * página completa, que llevan mucho más texto, suben el suyo donde toca.
   *
   * `threshold` es el otro ajuste que hacía falta y el menos evidente: mide
   * cuánto tiene que cambiar UN píxel para contarlo. Con el 0,2 de fábrica, un
   * borde gris claro sobre blanco no llegaba al listón, así que mover un campo
   * con borde de 1 px no cambiaba "ningún" píxel por muchos que se movieran.
   * Con 0,1 el mismo movimiento sale como 1.091 píxeles distintos y falla,
   * que es lo que se le pide.
   */
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixels: 300, threshold: 0.1 } },

  use: {
    baseURL: TIENDA,
    // Solo al reintentar: grabar siempre multiplica por tres lo que tarda.
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'es-ES',
  },

  projects: [
    {
      name: 'escritorio',
      // `storageState` trae la cookie de edad; sin ella la tienda entera
      // responde con la puerta. La prueba de la propia puerta la descarta.
      use: { ...devices['Desktop Chrome'], storageState: ESTADO_VERIFICADO },
      testIgnore: /(admin|visual|puerta-edad)\.spec\.ts/,
    },
    ...(process.env['E2E_VISUAL'] === '1' ? [PROYECTO_VISUAL] : []),
    {
      /*
       * El panel, aparte de la tienda.
       *
       * Necesita su propia `baseURL` —es otra aplicación en otro puerto— y no
       * tiene sentido pasarlo por el proyecto móvil: quien gestiona pedidos y
       * cuadra precios lo hace desde un escritorio, y probar en un Pixel 7 una
       * tabla de ocho columnas solo produce fallos que a nadie le importan.
       */
      name: 'admin',
      testMatch: /admin\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: ADMIN },
    },
    {
      /*
       * La puerta de edad, en su propio proyecto.
       *
       * Es la única prueba que necesita empezar SIN verificar, así que no
       * puede compartir el `storageState` de las demás. Separarla es más
       * limpio que hacer que cada prueba decida si borra las cookies.
       */
      name: 'puerta',
      testMatch: /puerta-edad\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: { cookies: [], origins: [] } },
    },
    {
      // La mitad del tráfico de una tienda es móvil, y es donde se rompen los
      // formularios: un botón tapado por el teclado no se ve en escritorio.
      name: 'movil',
      use: { ...devices['Pixel 7'], storageState: ESTADO_VERIFICADO },
      testIgnore: /(admin|visual|puerta-edad)\.spec\.ts/,
    },
  ],

  /*
   * Los servidores se dan por levantados.
   *
   * `webServer` de Playwright arrancaría la tienda, pero no la API, ni
   * Postgres, ni Redis: sin ellos la tienda levanta y falla en la primera
   * petición. Levantar la pila entera es trabajo del guion de CI y del
   * `pnpm dev` de cada uno, no de la configuración de las pruebas.
   */
  metadata: { tienda: TIENDA, api: API, admin: ADMIN },
});
