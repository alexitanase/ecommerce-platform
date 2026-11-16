/**
 * Lo que comparten el listado de clientes y la ficha de uno.
 *
 * Vive aparte porque la ficha se ha ido a su propia pantalla y las dos necesitan
 * las mismas formas. Tenerlas en uno de los dos ficheros obligaría al otro a
 * importar de él, y la dirección de esa flecha no significaría nada: ni el
 * listado depende de la ficha ni la ficha del listado.
 */

export interface Cliente {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  locale: string;
  isActive: boolean;
  emailVerifiedAt: string | null;
  marketingConsentAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  pedidos: number;
  gastadoCents: number;
  ultimoPedido: string | null;
}

export interface Direccion {
  id: string;
  type: string;
  firstName: string;
  lastName: string;
  line1: string;
  line2: string | null;
  city: string;
  province: string;
  postalCode: string;
  countryCode: string;
  isDefault: boolean;
}

export interface PedidoResumen {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  totalCents: number;
  createdAt: string;
}

/** Cómo entró en la tienda. Las dos vías no se excluyen. */
export interface Acceso {
  /** Tiene contraseña propia. */
  directo: boolean;
  proveedores: string[];
  identidades: { provider: string; createdAt: string }[];
}

export interface Sesion {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Un carrito que se quedó sin comprar. */
export interface Carrito {
  id: string;
  actualizadoEn: string;
  expiraEn: string;
  avisosEnviados: number;
  sinAvisos: boolean;
  unidades: number;
  totalCents: number;
  lineas: { sku: string; nombre: string; cantidad: number; precioCents: number }[];
}

export interface Ficha extends Cliente {
  phone: string | null;
  deletedAt: string | null;
  ticketMedioCents: number;
  addresses: Direccion[];
  historial: PedidoResumen[];
  acceso: Acceso;
  sesiones: Sesion[];
  carritos: Carrito[];
}

export const euros = (c: number) => (c / 100).toFixed(2).replace('.', ',') + ' €';

export const nombre = (c: { firstName: string | null; lastName: string | null; email: string }) =>
  [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email;
