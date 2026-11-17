import { useTranslation } from 'react-i18next';
import type { Ruta } from '@/componentes/enlace';
import { useSesion } from '@/lib/sesion';

/**
 * Mapa de navegación del panel.
 *
 * Vivía dentro del componente de la barra lateral, y eso lo dejaba fuera del
 * alcance de todo lo demás: la paleta de comandos tenía que repetir la lista de
 * pantallas, y las migas de pan no tenían de dónde sacar en qué grupo está la
 * ruta actual. Al declararlo aquí, las tres piezas leen lo mismo y ninguna se
 * queda desactualizada cuando se añade una pantalla.
 *
 * Cada entrada declara el permiso que necesita. Ocultar lo que no se puede usar
 * evita que alguien de soporte pulse «Ajustes» y reciba un 403 sin entender por
 * qué: si no puede, no lo ve.
 */

export interface EntradaNav {
  ruta: Ruta;
  etiqueta: string;
  permiso?: string;
  icono: React.ReactNode;
  /**
   * Sinónimos para el buscador.
   *
   * Quien busca «facturas» quiere Informes, y quien escribe «stock» quiere
   * Productos. Sin esto la paleta de comandos solo encuentra lo que ya sabes
   * cómo se llama, que es justo lo contrario de para lo que sirve.
   */
  alias?: string[];
}

export interface SeccionNav {
  titulo: string;
  entradas: EntradaNav[];
}

export const Ico = ({ d }: { d: string }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ flexShrink: 0 }}
  >
    <path d={d} />
  </svg>
);

/** Iconos usados en más de un sitio (barra lateral, paleta, migas). */
export const ICONOS = {
  panel: 'M3 12h7V3H3zM14 21h7v-9h-7zM14 3v6h7V3zM3 21h7v-6H3z',
  informes: 'M18 20V10M12 20V4M6 20v-6',
  kanban: 'M4 4h6v16H4zM14 4h6v9h-6z',
  retenidos: 'M12 3l8 4v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7zM12 8v5M12 16h.01',
  // Triángulo de aviso. El primer intento fue un paquete, y en el carril
  // contraído era indistinguible del cubo de Productos: con solo el icono, dos
  // dibujos parecidos son dos pantallas que se confunden.
  incidencias:
    'M10.3 3.9L1.8 18.5a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01',
  devoluciones: 'M3 7v6h6M3 13a9 9 0 106-8.5',
  pedidos: 'M6 2h9l5 5v15H6zM15 2v5h5',
  productos: 'M21 16V8l-9-5-9 5v8l9 5zM3.3 7L12 12l8.7-5M12 22V12',
  categorias: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  // Una etiqueta colgando: es lo que distingue una marca de una categoría.
  marcas: 'M20.6 13.4L12 22l-9-9V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01',
  // Una línea que cruza el umbral y se hunde: es de lo que avisa la pantalla.
  margenes: 'M3 8h18M4 13l4-3 4 4 4-6 4 5M4 19h16',
  resenas: 'M12 2l3 6.5 7 1-5 5 1.2 7L12 18l-6.2 3.5L7 14.5l-5-5 7-1z',
  cupones:
    'M20 12a2 2 0 010-4V6a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 010 4v2a2 2 0 010 4v2a2 2 0 002 2h12a2 2 0 002-2v-2a2 2 0 010-4z',
  referidos: 'M16 11a4 4 0 100-8 4 4 0 000 8M8 21v-2a4 4 0 014-4h4M4 11h6M7 8v6',
  experimentos: 'M3 20h18M7 20V9M12 20V4M17 20v-7',
  canales: 'M4 11a9 9 0 019 9M4 4a16 16 0 0116 16M5 19a1 1 0 100-2 1 1 0 000 2',
  clientes: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8',
  portada: 'M3 3h18v6H3zM3 12h8v9H3zM14 12h7v9h-7z',
  // Una barra con tres enlaces: es lo que se está configurando.
  menu: 'M3 4h18v5H3zM6 13h4M12 13h6M6 17h3M11 17h7',
  // Una hoja escrita, con la esquina doblada.
  paginas: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M8 13h8M8 17h5',
  traducciones: 'M4 5h7M9 3v2c0 4-2 7-5 8M5 9c0 3 3 6 7 7M13 21l4-9 4 9M15.5 17h5',
  proveedores:
    'M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 18.5a2 2 0 104 0 2 2 0 10-4 0M17.5 18.5a2 2 0 104 0 2 2 0 10-4 0',
  importar: 'M12 3v12M7 10l5 5 5-5M3 18v3h18v-3',
  pagos: 'M2 7h20v12H2zM2 11h20',
  envios:
    'M16 3h5v13h-5zM1 3h15v13H1zM5.5 18.5a2 2 0 104 0 2 2 0 10-4 0M17.5 18.5a2 2 0 104 0 2 2 0 10-4 0',
  integraciones: 'M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1',
  ajustes:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6h.09A1.65 1.65 0 0010 3.09V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9v.09a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z',
  equipo:
    'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  auditoria: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
  trabajos:
    'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
  buscar: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35',
  // Una mesa de trabajo con una capa encima: es lo que se hace en el Studio, y
  // se distingue del cubo de Productos y de la rejilla de Categorías.
  studio: 'M3 3h18v12H3zM8 8h8v4H8M7 21h10M12 15v6',
  campana: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
} as const;

/**
 * Navegación completa, sin filtrar.
 *
 * Se construye con `t` en vez de con claves sueltas porque el orden y la
 * agrupación son decisiones de producto —qué se mira todos los días va arriba—
 * y conviene verlas juntas.
 */
export function construirNavegacion(t: (clave: string) => string): SeccionNav[] {
  return [
    {
      titulo: '',
      entradas: [
        {
          ruta: '/',
          etiqueta: t('nav.panel'),
          icono: <Ico d={ICONOS.panel} />,
          alias: ['inicio', 'dashboard', 'resumen'],
        },
      ],
    },
    {
      titulo: t('nav.informes'),
      entradas: [
        {
          ruta: '/informes',
          etiqueta: t('nav.informes'),
          permiso: 'reports:read',
          icono: <Ico d={ICONOS.informes} />,
          alias: ['ventas', 'margen', 'iva', 'analítica', 'facturación'],
        },
      ],
    },
    {
      titulo: t('nav.pedidos'),
      entradas: [
        {
          ruta: '/kanban',
          etiqueta: t('nav.kanban'),
          permiso: 'orders:read',
          icono: <Ico d={ICONOS.kanban} />,
          alias: ['tablero', 'fulfillment'],
        },
        {
          // Debajo del tablero a propósito: son pedidos cobrados que no
          // avanzan hasta que alguien los mira, así que tienen que verse.
          ruta: '/retenidos',
          etiqueta: t('nav.retenidos'),
          permiso: 'orders:read',
          icono: <Ico d={ICONOS.retenidos} />,
          alias: ['riesgo', 'fraude', 'bloqueados'],
        },
        {
          // Pegado a Retenidos: los dos son pedidos cobrados que no avanzan
          // solos. La diferencia es que aquí ya se ha intentado comprar y ha
          // fallado, así que el cliente lleva esperando más tiempo.
          ruta: '/incidencias',
          etiqueta: t('nav.incidencias'),
          permiso: 'orders:read',
          icono: <Ico d={ICONOS.incidencias} />,
          alias: ['fulfillment', 'fallos', 'sin stock', 'proveedor'],
        },
        {
          ruta: '/devoluciones',
          etiqueta: t('nav.devoluciones'),
          permiso: 'returns:manage',
          icono: <Ico d={ICONOS.devoluciones} />,
          alias: ['rma', 'reembolsos'],
        },
        {
          ruta: '/pedidos',
          etiqueta: t('nav.pedidos'),
          permiso: 'orders:read',
          icono: <Ico d={ICONOS.pedidos} />,
          alias: ['ventas', 'compras'],
        },
      ],
    },
    {
      titulo: t('nav.catalogo'),
      entradas: [
        {
          ruta: '/productos',
          etiqueta: t('nav.productos'),
          permiso: 'products:read',
          icono: <Ico d={ICONOS.productos} />,
          alias: ['stock', 'inventario', 'variantes', 'precios'],
        },
        {
          ruta: '/margenes',
          etiqueta: t('nav.margenes'),
          permiso: 'products:read',
          icono: <Ico d={ICONOS.margenes} />,
          alias: ['rentabilidad', 'pérdidas', 'coste', 'iva', 'beneficio'],
        },
        {
          ruta: '/categorias',
          etiqueta: t('nav.categorias'),
          permiso: 'categories:write',
          icono: <Ico d={ICONOS.categorias} />,
          alias: ['colecciones', 'atributos'],
        },
        {
          ruta: '/marcas',
          etiqueta: t('nav.marcas'),
          permiso: 'categories:write',
          icono: <Ico d={ICONOS.marcas} />,
          alias: ['fabricantes', 'logotipos', 'satisfyer'],
        },
        {
          ruta: '/resenas',
          etiqueta: t('nav.resenas'),
          permiso: 'reviews:moderate',
          icono: <Ico d={ICONOS.resenas} />,
          alias: ['opiniones', 'moderación'],
        },
      ],
    },
    {
      titulo: t('nav.marketing'),
      entradas: [
        {
          ruta: '/cupones',
          etiqueta: t('nav.cupones'),
          permiso: 'marketing:write',
          icono: <Ico d={ICONOS.cupones} />,
          alias: ['descuentos', 'promociones', 'campañas'],
        },
        {
          ruta: '/referidos',
          etiqueta: t('nav.referidos'),
          permiso: 'marketing:write',
          icono: <Ico d={ICONOS.referidos} />,
        },
        {
          ruta: '/experimentos',
          etiqueta: t('nav.experimentos'),
          permiso: 'marketing:write',
          icono: <Ico d={ICONOS.experimentos} />,
          alias: ['a/b', 'pruebas'],
        },
        {
          ruta: '/canales',
          etiqueta: t('nav.canales'),
          permiso: 'marketing:write',
          icono: <Ico d={ICONOS.canales} />,
          alias: ['tráfico', 'atribución'],
        },
        {
          ruta: '/studio',
          etiqueta: t('nav.studio'),
          permiso: 'studio:read',
          icono: <Ico d={ICONOS.studio} />,
          alias: ['banners', 'creatividades', 'anuncios', 'diseño', 'exoclick'],
        },
      ],
    },
    {
      titulo: t('nav.clientes'),
      entradas: [
        {
          ruta: '/clientes',
          etiqueta: t('nav.clientes'),
          permiso: 'customers:read',
          icono: <Ico d={ICONOS.clientes} />,
          alias: ['crm', 'compradores', 'rgpd'],
        },
      ],
    },
    {
      titulo: t('nav.contenido'),
      entradas: [
        {
          ruta: '/portada',
          etiqueta: t('nav.portada'),
          permiso: 'content:write',
          icono: <Ico d={ICONOS.portada} />,
          alias: ['home', 'bloques', 'banners'],
        },
        {
          ruta: '/menu',
          etiqueta: t('nav.menu'),
          permiso: 'content:write',
          icono: <Ico d={ICONOS.menu} />,
          alias: ['navegación', 'enlaces', 'cabecera', 'barra'],
        },
        {
          ruta: '/paginas',
          etiqueta: t('nav.paginas'),
          permiso: 'content:write',
          icono: <Ico d={ICONOS.paginas} />,
          alias: ['legal', 'privacidad', 'cookies', 'condiciones', 'aviso legal', 'rgpd', 'lssi'],
        },
        {
          ruta: '/traducciones',
          etiqueta: t('nav.traducciones'),
          permiso: 'products:write',
          icono: <Ico d={ICONOS.traducciones} />,
          alias: ['idiomas', 'i18n'],
        },
      ],
    },
    {
      titulo: t('nav.proveedores'),
      entradas: [
        {
          ruta: '/proveedores',
          etiqueta: t('nav.proveedores'),
          permiso: 'suppliers:read',
          icono: <Ico d={ICONOS.proveedores} />,
          alias: ['aliexpress', 'sincronización'],
        },
        {
          // Entra aquí y no en Catálogo a propósito: importar es traer
          // mercancía de un proveedor, y quien lo hace viene de configurarlo.
          ruta: '/importar',
          etiqueta: t('nav.importar'),
          permiso: 'products:import',
          icono: <Ico d={ICONOS.importar} />,
          alias: ['importación', 'alta masiva'],
        },
      ],
    },
    {
      titulo: t('nav.ajustes'),
      entradas: [
        {
          ruta: '/metodos-pago',
          etiqueta: t('nav.metodos_pago'),
          permiso: 'payments:read',
          icono: <Ico d={ICONOS.pagos} />,
          alias: ['pasarelas', 'stripe', 'payiad', 'cripto', 'paypal'],
        },
        {
          ruta: '/envios',
          etiqueta: t('nav.envios'),
          permiso: 'settings:read',
          icono: <Ico d={ICONOS.envios} />,
          alias: ['tarifas', 'zonas', 'iva', 'impuestos'],
        },
        {
          ruta: '/integraciones',
          etiqueta: t('nav.integraciones'),
          permiso: 'settings:write',
          icono: <Ico d={ICONOS.integraciones} />,
          alias: ['api', 'credenciales', 'correo'],
        },
        {
          ruta: '/ajustes',
          etiqueta: t('nav.ajustes'),
          permiso: 'settings:write',
          icono: <Ico d={ICONOS.ajustes} />,
          alias: ['marca', 'configuración', 'mantenimiento'],
        },
        {
          ruta: '/equipo',
          etiqueta: t('nav.equipo'),
          permiso: 'users:read',
          icono: <Ico d={ICONOS.equipo} />,
          alias: ['usuarios', 'roles', 'permisos', 'invitaciones'],
        },
        {
          ruta: '/auditoria',
          etiqueta: t('nav.auditoria'),
          permiso: 'audit:read',
          icono: <Ico d={ICONOS.auditoria} />,
          alias: ['registro', 'actividad', 'logs'],
        },
        {
          ruta: '/trabajos',
          etiqueta: t('nav.trabajos'),
          permiso: 'jobs:manage',
          icono: <Ico d={ICONOS.trabajos} />,
          alias: ['colas', 'bullmq', 'fallidos'],
        },
      ],
    },
  ];
}

/**
 * Navegación ya filtrada por los permisos de quien mira, más utilidades para
 * las migas de pan y la paleta de comandos.
 */
export function useNavegacion() {
  const { t } = useTranslation();
  const { puede } = useSesion();

  const secciones = construirNavegacion(t)
    .map((s) => ({ ...s, entradas: s.entradas.filter((e) => !e.permiso || puede(e.permiso)) }))
    .filter((s) => s.entradas.length > 0);

  const planas = secciones.flatMap((s) => s.entradas.map((e) => ({ ...e, grupo: s.titulo })));

  return {
    secciones,
    planas,
    /**
     * Entrada que corresponde a una ruta, para el título y las migas.
     *
     * Si no hay coincidencia exacta se busca la sección que la contiene: la
     * ficha de un producto vive en `/productos/<id>`, que no está en el menú, y
     * sin esto sus migas saltaban de «Panel» al nombre del producto dejándose
     * «Productos» por el camino —justo el enlace que se usa para volver—.
     *
     * Se compara por segmentos y no con `startsWith` para que `/productos` no
     * dé por suya una hipotética `/productos-agotados`.
     */
    buscarRuta: (ruta: string) => {
      const exacta = planas.find((e) => e.ruta === ruta);
      if (exacta) return exacta;

      const segmentos = ruta.split('/').filter(Boolean);
      // De la más específica a la más general, saltándose la raíz.
      for (let i = segmentos.length - 1; i > 0; i--) {
        const padre = `/${segmentos.slice(0, i).join('/')}`;
        const encontrada = planas.find((e) => e.ruta === padre);
        if (encontrada) return encontrada;
      }
      return undefined;
    },
  };
}
