import { AliExpressAdapter } from '../adapters/aliexpress.adapter.js';
import { MockSupplierAdapter } from '../adapters/mock.adapter.js';
import { DreamloveAdapter } from '../adapters/dreamlove/dreamlove.adapter.js';
import type { RepositorioCatalogoDreamlove } from '../adapters/dreamlove/tipos.js';
import { GATEWAY_PRUEBAS, GATEWAY_SYNC } from '../adapters/iop.js';
import type { CredencialesProveedor, SupplierAdapter } from './types.js';

/**
 * Fábrica de adaptadores.
 *
 * Añadir un proveedor nuevo (BigBuy, CJ Dropshipping, Spocket…) es escribir su
 * adaptador y registrarlo aquí. Ningún otro punto del sistema necesita saber
 * qué proveedores existen.
 */

export type ClaveProveedor = 'aliexpress' | 'dreamlove' | 'mock';

export interface CampoCredencial {
  clave: string;
  etiqueta: string;
  secreto: boolean;
  /**
   * Lo consigue el propio sistema al autorizar; no se pide a nadie.
   *
   * Sin esta distinción, dar de alta AliExpress exigía pegar a mano un Access
   * Token que solo existe DESPUÉS de autorizar, y no había forma de autorizar
   * sin haber dado antes de alta el proveedor. Un círculo cerrado.
   */
  porOauth?: boolean;
  ayuda?: string;
  /**
   * Opciones cerradas en vez de texto libre.
   *
   * Para lo que solo admite un puñado de valores válidos: escribir a mano la
   * dirección de una pasarela es la forma más rápida de tener una integración
   * que falla por una letra.
   */
  opciones?: { valor: string; etiqueta: string }[];
  /** Se usa cuando nadie ha elegido nada. */
  porDefecto?: string;
  /** Sin rellenar no se puede dar de alta el proveedor. */
  opcional?: boolean;
}

export const PROVEEDORES_DISPONIBLES: {
  key: ClaveProveedor;
  nombre: string;
  /** Necesita que el titular de la cuenta autorice desde una web del proveedor. */
  usaOauth?: boolean;
  /**
   * No tiene API: su catálogo entra subiendo un fichero.
   *
   * El panel lo consulta para enseñar la subida del catálogo en vez del
   * formulario de credenciales, y para no dar por «no configurado» a un
   * proveedor al que no hay nada que configurarle.
   */
  catalogoPorFichero?: boolean;
  camposCredenciales: CampoCredencial[];
}[] = [
  {
    key: 'aliexpress',
    nombre: 'AliExpress',
    usaOauth: true,
    camposCredenciales: [
      {
        clave: 'appKey',
        etiqueta: 'App Key',
        secreto: false,
        ayuda: 'Consola de AliExpress Open Platform → tu aplicación → App Key.',
      },
      {
        clave: 'appSecret',
        etiqueta: 'App Secret',
        secreto: true,
        ayuda: 'En la misma pantalla. Identifica a la aplicación y firma cada llamada.',
      },
      {
        /*
         * La pasarela es el primer argumento del cliente en el SDK oficial
         * (`new IopClient($url, $appkey, $secretKey)`), y su propio demo apunta
         * al entorno de pruebas. Se ofrece como opción cerrada porque la
         * diferencia entre las dos no es cosmética: contra producción, dar de
         * alta un pedido de prueba compra de verdad y cuesta dinero.
         */
        clave: 'gateway',
        etiqueta: 'Entorno',
        secreto: false,
        opcional: true,
        porDefecto: GATEWAY_SYNC,
        opciones: [
          { valor: GATEWAY_SYNC, etiqueta: 'Producción (compras reales)' },
          { valor: GATEWAY_PRUEBAS, etiqueta: 'Pruebas (sandbox)' },
        ],
        ayuda: 'En producción los pedidos que se envíen al proveedor se compran de verdad.',
      },
      { clave: 'accessToken', etiqueta: 'Access Token', secreto: true, porOauth: true },
      { clave: 'refreshToken', etiqueta: 'Refresh Token', secreto: true, porOauth: true },
    ],
  },
  {
    /*
     * Un proveedor sin nada que configurar.
     *
     * Dreamlove no da claves porque no tiene API: la integración entera es un
     * XML que mandan ellos y que se sube desde la ficha del proveedor. Por eso
     * la lista de credenciales está vacía y no porque falte rellenarla.
     */
    key: 'dreamlove',
    nombre: 'Dreamlove',
    catalogoPorFichero: true,
    camposCredenciales: [],
  },
  {
    key: 'mock',
    nombre: 'Proveedor Simulado (pruebas)',
    camposCredenciales: [],
  },
];

export function crearAdaptador(
  key: ClaveProveedor,
  credenciales: CredencialesProveedor,
  opciones: {
    onLog?: (n: 'info' | 'warn' | 'error', m: string) => void;
    /**
     * De dónde lee su catálogo un proveedor sin API.
     *
     * Lo pone quien construye el adaptador —la API, con Prisma detrás— para
     * que este paquete siga sin depender de la base de datos y se pueda probar
     * con un catálogo en memoria.
     */
    catalogoDreamlove?: RepositorioCatalogoDreamlove;
  } = {},
): SupplierAdapter {
  switch (key) {
    case 'aliexpress':
      return new AliExpressAdapter(credenciales, opciones);
    case 'dreamlove': {
      if (!opciones.catalogoDreamlove) {
        // Sin catálogo el adaptador no puede responder a nada. Se falla aquí,
        // al construirlo, y no en la primera búsqueda: el mensaje llega a
        // quien está montando la integración en vez de a quien busca.
        throw new Error(
          'Dreamlove necesita un repositorio de catálogo: pásalo en `catalogoDreamlove`.',
        );
      }
      return new DreamloveAdapter(opciones.catalogoDreamlove, opciones);
    }
    case 'mock':
      return new MockSupplierAdapter({ latenciaMs: 20 });
    default: {
      // Comprobación exhaustiva: si se añade un proveedor al tipo y se olvida
      // aquí, TypeScript no compila.
      const nunca: never = key;
      throw new Error(`Proveedor no soportado: ${String(nunca)}`);
    }
  }
}
