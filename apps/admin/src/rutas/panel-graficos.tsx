import { useTranslation } from 'react-i18next';
import { ContenedorGrafico, GraficoArea, GraficoBarras } from '@/componentes/ui/graficos';

/**
 * Los dos gráficos del panel, en su propio módulo.
 *
 * Están separados por peso, no por orden: la librería de gráficos son ~400 kB
 * y es lo más grande que carga el panel. Al aislarla, las tarjetas KPI y la
 * tabla —que es lo que se mira primero— se pintan sin esperarla, y el dibujo
 * entra después en su hueco reservado, sin mover nada de sitio.
 */

/*
 * Los puntos llevan índice abierto porque el contenedor del gráfico los
 * exporta y los pinta como tabla sin saber qué campos trae cada uno: es el
 * mismo componente para las ventas por día y para el top de productos.
 */
interface Punto extends Record<string, unknown> {
  x: string;
  ingresos: number;
  margen: number;
}

interface Producto extends Record<string, unknown> {
  x: string;
  margen: number;
  sku: string;
  unidades: number;
}

export default function PanelGraficos({
  evolucion,
  productos,
  permiso,
  cargandoEvolucion,
  errorEvolucion,
  reintentarEvolucion,
  cargandoProductos,
  errorProductos,
  reintentarProductos,
  formato,
}: {
  evolucion: Punto[];
  productos: Producto[];
  permiso: boolean;
  cargandoEvolucion: boolean;
  errorEvolucion?: unknown;
  reintentarEvolucion: () => void;
  cargandoProductos: boolean;
  errorProductos?: unknown;
  reintentarProductos: () => void;
  formato: (valor: number) => string;
}) {
  const { t } = useTranslation();

  return (
    <div className="rejilla mt-4">
      <div className="col-8">
        <ContenedorGrafico
          titulo={t('panel.evolucion')}
          descripcion={t('panel.evolucion_ayuda')}
          permiso={permiso}
          cargando={cargandoEvolucion}
          error={errorEvolucion}
          reintentar={reintentarEvolucion}
          datos={evolucion}
          columnasCsv={[
            { clave: 'x', titulo: t('app.fecha') },
            { clave: 'ingresos', titulo: t('panel.ingresos') },
            { clave: 'margen', titulo: t('panel.margen') },
          ]}
          nombreExport="ventas-por-dia"
          leyenda={[
            { nombre: t('panel.ingresos'), color: 'var(--serie-1)' },
            { nombre: t('panel.margen'), color: 'var(--serie-2)' },
          ]}
        >
          <GraficoArea
            datos={evolucion}
            formato={formato}
            series={[
              { clave: 'ingresos', nombre: t('panel.ingresos'), color: 0 },
              { clave: 'margen', nombre: t('panel.margen'), color: 1 },
            ]}
          />
        </ContenedorGrafico>
      </div>

      <div className="col-4">
        <ContenedorGrafico
          titulo={t('panel.top_productos')}
          descripcion={t('panel.top_productos_ayuda')}
          permiso={permiso}
          cargando={cargandoProductos}
          error={errorProductos}
          reintentar={reintentarProductos}
          datos={productos}
          columnasCsv={[
            { clave: 'x', titulo: t('productos.nombre') },
            { clave: 'unidades', titulo: t('panel.unidades') },
            { clave: 'margen', titulo: t('panel.margen') },
          ]}
          nombreExport="top-productos"
          alto={300}
        >
          <GraficoBarras
            datos={productos}
            horizontal
            formato={formato}
            series={[{ clave: 'margen', nombre: t('panel.margen'), color: 0 }]}
          />
        </ContenedorGrafico>
      </div>
    </div>
  );
}
