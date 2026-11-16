import { Link } from '@tanstack/react-router';

/**
 * Rutas del panel.
 *
 * Se declaran aquí como fuente única de verdad. El enrutador las registra y
 * este componente las expone tipadas, de modo que escribir `/kanbam` no
 * compila.
 */
export const RUTAS = [
  '/',
  '/kanban',
  '/informes',
  '/metodos-pago',
  '/pedidos',
  '/devoluciones',
  '/retenidos',
  '/incidencias',
  '/productos',
  // Primera ruta con parámetro del panel: la ficha de un producto. El valor se
  // pasa por `params`, no concatenado en la cadena, para que el enrutador siga
  // validando el destino en compilación.
  '/productos/$productId',
  '/importar',
  '/categorias',
  '/marcas',
  '/inventario',
  '/margenes',
  '/resenas',
  '/cupones',
  '/referidos',
  '/experimentos',
  '/canales',
  '/clientes',
  '/clientes/$clienteId',
  '/proveedores',
  '/proveedores/aliexpress',
  '/portada',
  '/menu',
  '/paginas',
  '/traducciones',
  '/envios',
  '/auditoria',
  '/trabajos',
  '/integraciones',
  '/ajustes',
  '/equipo',
  // Alta y ficha del personal. Crear y editar van en pantalla propia, nunca en
  // un desplegable del listado: hay que elegir accesos leyendo lo que conceden,
  // y eso no cabe en una tira de casillas sobre la tabla.
  '/equipo/nuevo',
  '/equipo/$userId',
  '/perfil',
  '/notificaciones',
  // Studio. Cuelgan de otro layout —sin barra lateral ni cabecera del panel—
  // pero son rutas de la misma aplicación, así que se declaran aquí igual.
  '/studio',
  '/studio/biblioteca',
  '/studio/campanas/$campaignId',
  '/studio/creatividades/$creativeId',
] as const;

export type Ruta = (typeof RUTAS)[number];

/**
 * Enlace interno.
 *
 * Envuelve al `Link` de TanStack Router porque con enrutado por código se forma
 * un ciclo de tipos —router → pantalla → tipos del router— y `to` acaba
 * resolviéndose como `"/" | "." | ".."`. La conversión vive aquí, en un solo
 * sitio y documentada; el resto de la aplicación usa `Ruta`, que sí valida los
 * destinos en compilación.
 *
 * Si algún día se migra al enrutado por ficheros de TanStack (que genera el
 * árbol y elimina el ciclo), este componente puede sustituirse por `Link` a
 * secas sin tocar nada más.
 */
export function Enlace({
  a,
  params,
  children,
  activo,
  activoExacto = false,
  ...resto
}: {
  a: Ruta;
  /** Valores de los parámetros cuando la ruta los lleva (`$productId`). */
  params?: Record<string, string>;
  children: React.ReactNode;
  /**
   * Estilo cuando este enlace apunta a la pantalla actual.
   *
   * Lo decide el enrutador, no nosotros. Antes el menú comparaba a mano la ruta
   * actual con `startsWith`, y se equivocaba: estando en `/pedidos` resaltaba
   * «Panel». Además `startsWith` daría por activa `/productos` estando en una
   * hipotética `/productos-agotados`. El enrutador ya sabe qué ruta está
   * montada; preguntárselo a él no puede desincronizarse.
   */
  activo?: React.CSSProperties;
  /** Solo activo en la ruta exacta; necesario para la raíz, que prefija todo. */
  activoExacto?: boolean;
} & Omit<React.ComponentProps<'a'>, 'href'>) {
  return (
    <Link
      to={a as never}
      {...(params ? { params: params as never } : {})}
      {...(activo ? { activeProps: { style: activo } } : {})}
      activeOptions={{ exact: activoExacto }}
      {...resto}
    >
      {children}
    </Link>
  );
}
