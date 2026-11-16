import { useTranslation } from 'react-i18next';
import { useQueries } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { useSesion } from '@/lib/sesion';
import type { Ruta } from '@/componentes/enlace';

/**
 * Avisos de la campana.
 *
 * No hay una tabla de "notificaciones" en la base de datos ni hace falta: lo
 * que el equipo necesita saber al entrar es qué está parado ahora mismo, y eso
 * ya lo contesta la propia operativa. Cada aviso es una consulta real —pedidos
 * fallidos, retenidos por riesgo, colas caídas, devoluciones sin responder,
 * reseñas sin moderar, stock a cero— y desaparece solo cuando el problema se
 * resuelve, sin que nadie tenga que marcarlo como leído.
 *
 * Cada consulta va condicionada al permiso: quien no puede ver pedidos tampoco
 * recibe el aviso de que hay pedidos parados, porque no podría hacer nada con
 * él y solo sería ruido.
 */

export type TonoAviso = 'error' | 'aviso' | 'info';

export interface Aviso {
  id: string;
  texto: string;
  cantidad: number;
  tono: TonoAviso;
  ruta: Ruta;
}

interface PedidoBreve {
  id: string;
  status: string;
}

interface MetricasColas {
  colas: { nombre: string; fallidos: number }[];
  outbox: { fallidos: number };
}

interface DevolucionBreve {
  id: string;
  status: string;
}

/** Marca de tiempo más antigua entre las consultas ya resueltas; 0 si ninguna lo está. */
function masViejo(marcas: number[]): number {
  const cargadas = marcas.filter((m) => m > 0);
  return cargadas.length > 0 ? Math.min(...cargadas) : 0;
}

export function useAvisos() {
  const { t } = useTranslation();
  const { puede } = useSesion();

  const consultas = useQueries({
    queries: [
      {
        queryKey: ['avisos', 'pedidos'],
        queryFn: () => get<{ items: PedidoBreve[] }>('/orders?limite=100'),
        enabled: puede('orders:read'),
        refetchInterval: 60_000,
      },
      {
        queryKey: ['avisos', 'retenidos'],
        queryFn: () => get<unknown[]>('/orders/retenidos'),
        enabled: puede('orders:read'),
        refetchInterval: 60_000,
      },
      {
        queryKey: ['avisos', 'incidencias'],
        queryFn: () => get<unknown[]>('/orders/incidencias'),
        enabled: puede('orders:read'),
        refetchInterval: 60_000,
      },
      {
        queryKey: ['avisos', 'colas'],
        queryFn: () => get<MetricasColas>('/jobs'),
        enabled: puede('jobs:manage'),
        refetchInterval: 30_000,
      },
      {
        queryKey: ['avisos', 'devoluciones'],
        queryFn: () => get<DevolucionBreve[]>('/returns'),
        enabled: puede('returns:manage'),
        refetchInterval: 120_000,
      },
      {
        queryKey: ['avisos', 'resenas'],
        queryFn: () => get<unknown[]>('/reviews/pending'),
        enabled: puede('reviews:moderate'),
        refetchInterval: 120_000,
      },
      {
        queryKey: ['avisos', 'stock'],
        queryFn: () => get<unknown[]>('/catalog/inventory/low-stock'),
        enabled: puede('products:read'),
        refetchInterval: 300_000,
      },
    ],
  });

  const [pedidos, retenidos, incidencias, colas, devoluciones, resenas, stock] = consultas;

  const avisos: Aviso[] = [];
  const agregar = (id: string, cantidad: number, tono: TonoAviso, ruta: Ruta, clave: string) => {
    if (cantidad > 0) avisos.push({ id, cantidad, tono, ruta, texto: t(clave, { n: cantidad }) });
  };

  const fallidos = (pedidos.data?.items ?? []).filter((p) => p.status === 'FAILED').length;
  agregar('pedidos-fallidos', fallidos, 'error', '/kanban', 'avisos.pedidos_fallidos');

  agregar(
    'colas-fallidas',
    (colas.data?.colas.reduce((a, c) => a + c.fallidos, 0) ?? 0) +
      (colas.data?.outbox.fallidos ?? 0),
    'error',
    '/trabajos',
    'avisos.trabajos_fallidos',
  );

  /*
   * Error y no aviso, y por encima de los retenidos: aquí el cobro ya está
   * hecho y la compra al proveedor ha fallado. Un retenido todavía se puede
   * soltar; esto ya salió mal y el cliente está esperando.
   */
  agregar(
    'incidencias',
    incidencias.data?.length ?? 0,
    'error',
    '/incidencias',
    'avisos.incidencias',
  );

  agregar('retenidos', retenidos.data?.length ?? 0, 'aviso', '/retenidos', 'avisos.retenidos');

  agregar(
    'devoluciones',
    (devoluciones.data ?? []).filter((d) => d.status === 'REQUESTED').length,
    'aviso',
    '/devoluciones',
    'avisos.devoluciones',
  );

  agregar('resenas', resenas.data?.length ?? 0, 'info', '/resenas', 'avisos.resenas');
  agregar('stock', stock.data?.length ?? 0, 'aviso', '/productos', 'avisos.stock');

  // El orden importa: lo que rompe la venta primero, lo que se puede mirar
  // luego después. La campana los enseña todos, pero el color del contador lo
  // marca el peor.
  const peso: Record<TonoAviso, number> = { error: 0, aviso: 1, info: 2 };
  avisos.sort((a, b) => peso[a.tono] - peso[b.tono]);

  return {
    avisos,
    total: avisos.reduce((a, x) => a + x.cantidad, 0),
    hayError: avisos.some((a) => a.tono === 'error'),
    cargando: consultas.some((c) => c.isLoading),
    fallo: consultas.find((c) => c.error)?.error ?? null,
    refrescar: () => consultas.forEach((c) => void c.refetch()),
    /**
     * Momento del dato más viejo de los que se están enseñando.
     *
     * El más viejo y no el más nuevo: la campana es tan fresca como su peor
     * fuente, y decir lo contrario es prometer una frescura que no hay.
     */
    actualizado: masViejo(consultas.map((c) => c.dataUpdatedAt)),
  };
}
