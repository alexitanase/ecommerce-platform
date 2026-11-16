import { createRootRoute, createRoute, lazyRouteComponent, Outlet } from '@tanstack/react-router';
import { Layout } from '@/componentes/layout';
import { LayoutStudio } from '@/componentes/studio/layout-studio';

/**
 * Árbol de rutas del admin.
 *
 * Las pantallas se cargan de forma perezosa por dos motivos:
 *
 *  1. Rompe el ciclo de tipos. Con importación directa se forma
 *     router → pantalla → tipos del router, y los `<Link to="...">` pierden el
 *     tipado, que es precisamente la ventaja de TanStack Router.
 *
 *  2. Parte el paquete. Quien entra a ver el Kanban no necesita descargar el
 *     editor de productos ni el centro de colas.
 */
const rutaRaiz = createRootRoute({
  component: () => <Outlet />,
});

const rutaLayout = createRoute({
  getParentRoute: () => rutaRaiz,
  id: 'layout',
  component: Layout,
});

/**
 * El Studio cuelga de la raíz, no del layout del panel.
 *
 * Es lo único que hace falta para que sea «otra aplicación» por dentro: mismas
 * sesión, API e idiomas, pero sin barra lateral, sin cabecera y sin migas. Ver
 * STUDIO.md.
 */
const rutaStudio = createRoute({
  getParentRoute: () => rutaRaiz,
  id: 'studio',
  component: LayoutStudio,
});

const definir = (path: string, cargar: Parameters<typeof lazyRouteComponent>[0]) =>
  createRoute({
    getParentRoute: () => rutaLayout,
    path,
    component: lazyRouteComponent(cargar),
  });

const definirStudio = (path: string, cargar: Parameters<typeof lazyRouteComponent>[0]) =>
  createRoute({
    getParentRoute: () => rutaStudio,
    path,
    component: lazyRouteComponent(cargar),
  });

export const arbolDeRutas = rutaRaiz.addChildren([
  rutaLayout.addChildren([
    definir('/', () => import('@/rutas/panel').then((m) => ({ default: m.Panel }))),
    definir('/metodos-pago', () =>
      import('@/rutas/metodos-pago').then((m) => ({ default: m.MetodosPago })),
    ),
    definir('/informes', () => import('@/rutas/informes').then((m) => ({ default: m.Informes }))),
    definir('/kanban', () => import('@/rutas/kanban').then((m) => ({ default: m.Kanban }))),
    definir('/pedidos', () => import('@/rutas/pedidos').then((m) => ({ default: m.Pedidos }))),
    definir('/retenidos', () =>
      import('@/rutas/retenidos').then((m) => ({ default: m.Retenidos })),
    ),
    definir('/incidencias', () =>
      import('@/rutas/incidencias').then((m) => ({ default: m.Incidencias })),
    ),
    definir('/devoluciones', () =>
      import('@/rutas/devoluciones').then((m) => ({ default: m.Devoluciones })),
    ),
    definir('/productos', () =>
      import('@/rutas/productos').then((m) => ({ default: m.Productos })),
    ),
    // Va ANTES que las rutas hermanas para que el parámetro no se coma
    // ninguna: TanStack ordena por especificidad, pero declararlo aquí deja
    // claro que `/productos/algo` es una ficha y no otra pantalla.
    definir('/productos/$productId', () =>
      import('@/rutas/producto-ficha').then((m) => ({ default: m.FichaProducto })),
    ),
    definir('/categorias', () =>
      import('@/rutas/categorias').then((m) => ({ default: m.Categorias })),
    ),
    definir('/marcas', () => import('@/rutas/marcas').then((m) => ({ default: m.Marcas }))),
    definir('/importar', () => import('@/rutas/importar').then((m) => ({ default: m.Importar }))),
    definir('/inventario', () =>
      import('@/rutas/productos').then((m) => ({ default: m.Productos })),
    ),
    definir('/margenes', () => import('@/rutas/margenes').then((m) => ({ default: m.Margenes }))),
    definir('/resenas', () => import('@/rutas/resenas').then((m) => ({ default: m.Resenas }))),
    definir('/cupones', () => import('@/rutas/cupones').then((m) => ({ default: m.Cupones }))),
    definir('/referidos', () =>
      import('@/rutas/referidos').then((m) => ({ default: m.Referidos })),
    ),
    definir('/experimentos', () =>
      import('@/rutas/experimentos').then((m) => ({ default: m.Experimentos })),
    ),
    definir('/canales', () => import('@/rutas/canales').then((m) => ({ default: m.Canales }))),
    definir('/clientes', () => import('@/rutas/clientes').then((m) => ({ default: m.Clientes }))),
    definir('/clientes/$clienteId', () =>
      import('@/rutas/cliente-ficha').then((m) => ({ default: m.ClienteFicha })),
    ),
    definir('/proveedores', () =>
      import('@/rutas/proveedores').then((m) => ({ default: m.Proveedores })),
    ),
    definir('/proveedores/aliexpress', () =>
      import('@/rutas/ayuda-aliexpress').then((m) => ({ default: m.AyudaAliExpress })),
    ),
    definir('/auditoria', () =>
      import('@/rutas/auditoria').then((m) => ({ default: m.Auditoria })),
    ),
    definir('/trabajos', () => import('@/rutas/trabajos').then((m) => ({ default: m.Trabajos }))),
    definir('/envios', () => import('@/rutas/envios').then((m) => ({ default: m.Envios }))),
    definir('/traducciones', () =>
      import('@/rutas/traducciones').then((m) => ({ default: m.Traducciones })),
    ),
    definir('/portada', () => import('@/rutas/portada').then((m) => ({ default: m.Portada }))),
    definir('/menu', () => import('@/rutas/menu').then((m) => ({ default: m.MenuTienda }))),
    definir('/paginas', () => import('@/rutas/paginas').then((m) => ({ default: m.Paginas }))),
    definir('/integraciones', () =>
      import('@/rutas/integraciones').then((m) => ({ default: m.Integraciones })),
    ),
    definir('/ajustes', () => import('@/rutas/ajustes').then((m) => ({ default: m.Ajustes }))),
    definir('/equipo', () => import('@/rutas/equipo').then((m) => ({ default: m.Equipo }))),
    // `/equipo/nuevo` va antes que `/equipo/$userId` para que quede claro que
    // «nuevo» es una pantalla y no el id de nadie. TanStack ordena por
    // especificidad, así que el orden aquí es documentación, no dependencia.
    definir('/equipo/nuevo', () =>
      import('@/rutas/equipo-nuevo').then((m) => ({ default: m.EquipoNuevo })),
    ),
    definir('/equipo/$userId', () =>
      import('@/rutas/equipo-ficha').then((m) => ({ default: m.EquipoFicha })),
    ),
    definir('/perfil', () => import('@/rutas/perfil').then((m) => ({ default: m.Perfil }))),
    definir('/notificaciones', () =>
      import('@/rutas/notificaciones').then((m) => ({ default: m.Notificaciones })),
    ),
  ]),
  rutaStudio.addChildren([
    definirStudio('/studio', () =>
      import('@/rutas/studio/campanas').then((m) => ({ default: m.CampanasStudio })),
    ),
    definirStudio('/studio/biblioteca', () =>
      import('@/rutas/studio/biblioteca').then((m) => ({ default: m.Biblioteca })),
    ),
    definirStudio('/studio/campanas/$campaignId', () =>
      import('@/rutas/studio/campana').then((m) => ({ default: m.FichaCampana })),
    ),
    definirStudio('/studio/creatividades/$creativeId', () =>
      import('@/rutas/studio/editor').then((m) => ({ default: m.Editor })),
    ),
  ]),
]);
