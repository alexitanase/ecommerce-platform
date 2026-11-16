import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { api } from '@/lib/api';
import { arbolCategorias, navegarCategorias } from '@/lib/categorias';
import { type ProductoResumen } from '@/components/tarjeta-producto';
import { FiltrosListado } from '@/components/filtros-listado';
import { ResultadosListado } from '@/components/resultados-listado';
import { Pagina, TituloPagina } from '@/components/ui/pagina';
import { Vacio } from '@/components/ui/estados';

/**
 * El listado del catálogo: resultados, filtros y navegación por categorías.
 *
 * Vive aparte de la página porque lo usan dos: el catálogo (`/buscar`) y las
 * ofertas (`/ofertas`), que es exactamente el mismo listado con un filtro
 * puesto de antemano. Copiarlo habría significado mantener dos veces el
 * reenvío de filtros, el de cookies y la clave de recarga —y ese reparto es
 * justo el que hace que la página 2 de una búsqueda filtrada llegue sin
 * filtrar—.
 */

export interface RespuestaBusqueda {
  hits: ProductoResumen[];
  total: number;
  pagina: number;
  porPagina: number;
  facetas: Record<string, Record<string, number>>;
  /** En qué categoría se está, cuando se ha entrado por una. */
  categoria?: { id: string; slug: string; nombre: string };
  tiempoMs: number;
}

const POR_PAGINA = 24;

/** El primer valor de un parámetro que puede venir repetido. */
export const uno = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/** Los que convierten el listado en «un corte del listado». */
const DE_LA_URL = ['categoria', 'categoryId', 'marca', 'precioMin', 'precioMax'] as const;

export async function ListadoCatalogo({
  locale,
  sp,
  fijos = {},
  titulo,
  descripcion,
}: {
  locale: string;
  sp: Record<string, string | string[] | undefined>;
  /**
   * Filtros que no se pueden quitar desde la interfaz.
   *
   * Es lo que distingue `/ofertas` de `/buscar`: allí `soloOfertas` va siempre
   * puesto, y por eso viaja aquí y no en la URL. Si estuviera en la URL, el
   * botón de limpiar filtros lo borraría y la página de ofertas pasaría a
   * enseñar el catálogo entero.
   */
  fijos?: Record<string, string>;
  /** Encabezado propio de la página. Sin él manda el de la búsqueda. */
  titulo?: string;
  descripcion?: string;
}) {
  const t = await getTranslations('listado');

  const consulta = uno(sp['q']) ?? '';
  // Una página que no es un número —o que es cero, o negativa— no puede tumbar
  // el catálogo: la API recibiría un `NaN` y devolvería un error donde tenía
  // que haber productos. Cualquier cosa rara se lee como la primera página.
  const pedida = Number(uno(sp['pagina']) ?? '1');
  const pagina = Number.isFinite(pedida) && pedida >= 1 ? Math.floor(pedida) : 1;
  const orden = uno(sp['orden']) ?? fijos['orden'] ?? 'relevancia';

  /*
   * Los filtros, en un objeto plano.
   *
   * Se construye una vez y se usa dos veces: aquí para pedir la primera página
   * y en el navegador para pedir las siguientes conforme se baja. Antes se
   * armaba a mano en cada sitio, y ese es justo el reparto que hace que la
   * página 2 de una búsqueda filtrada llegue sin filtrar.
   */
  const filtros: Record<string, string> = { ...fijos, q: consulta, orden };

  for (const clave of DE_LA_URL) {
    const valor = uno(sp[clave]);
    if (valor) filtros[clave] = valor;
  }
  if (uno(sp['soloDisponibles']) === 'true') filtros['soloDisponibles'] = 'true';

  const parametros = new URLSearchParams({
    ...filtros,
    locale,
    pagina: String(pagina),
    porPagina: String(POR_PAGINA),
  });

  /*
   * Las cookies del visitante, reenviadas a mano.
   *
   * En un componente de servidor no hay navegador que las adjunte. La API sí
   * miraba la verificación de edad para decidir si devuelve el catálogo +18,
   * pero como aquí no llegaba ninguna cookie, siempre la veía sin verificar: el
   * buscador no encontraba nunca un producto restringido, ni a quien acababa de
   * declarar su edad.
   */
  const galletas = (await cookies()).toString();

  /*
   * El árbol se pide junto con los resultados, no después.
   *
   * Es lo que da la navegación por categorías de la barra lateral, y viene de
   * la misma consulta cacheada que ya usa la cabecera en todas las páginas: no
   * cuesta una llamada de más. Con las facetas del buscador no se puede hacer,
   * porque solo traen las categorías de los resultados actuales —al elegir una,
   * la lista se quedaba con esa sola dentro y no había forma de salir—.
   */
  const [resultado, arbol] = await Promise.all([
    api<RespuestaBusqueda>(`/search?${parametros.toString()}`, {
      ...(galletas ? { cache: 'no-store' as const, cookies: galletas } : {}),
    }).catch((): RespuestaBusqueda => ({
      hits: [],
      total: 0,
      pagina: 1,
      porPagina: POR_PAGINA,
      facetas: {},
      tiempoMs: 0,
    })),
    arbolCategorias(locale),
  ]);

  const navegacion = navegarCategorias(arbol, uno(sp['categoria']));

  return (
    <Pagina>
      {/* Sin búsqueda el título era «Filtros», que es el nombre de la barra
          lateral, no el de la página: quien llegaba desde el menú veía una
          pantalla que decía llamarse como uno de sus controles.

          Entrando por una categoría, el título es su nombre: llegar a
          «Vibradores» desde el menú y encontrarse una página titulada
          «Listado» no dice a dónde se ha llegado, y es la primera señal de que
          el filtro no se ha aplicado. */}
      <TituloPagina
        titulo={consulta ? `«${consulta}»` : (resultado.categoria?.nombre ?? titulo ?? t('titulo'))}
        descripcion={!consulta && !resultado.categoria ? descripcion : undefined}
      >
        <p className="text-sm text-[var(--texto-suave)]">
          {t('resultados', { total: resultado.total })}
        </p>
      </TituloPagina>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <FiltrosListado
          facetas={resultado.facetas}
          navegacion={navegacion}
          ordenPorDefecto={fijos['orden'] ?? 'relevancia'}
          conRecuento={Object.keys(fijos).length === 0}
        />

        <div>
          {resultado.hits.length === 0 ? (
            <Vacio
              icono="busqueda"
              titulo={t('sin_resultados', { consulta })}
              descripcion={t('sin_resultados_ayuda')}
            />
          ) : (
            /*
             * `key` con los filtros dentro, y esto no es un detalle.
             *
             * El listado guarda en su estado las páginas que ha ido cargando al
             * bajar. Al cambiar un filtro, el servidor manda otra primera
             * página pero React reutilizaría el mismo componente con su estado
             * intacto: debajo de los resultados nuevos seguirían colgando los
             * de la búsqueda anterior. Con la clave, cambiar un filtro es un
             * componente nuevo y una lista limpia.
             */
            <ResultadosListado
              key={parametros.toString()}
              inicial={resultado.hits}
              total={resultado.total}
              pagina={pagina}
              porPagina={POR_PAGINA}
              locale={locale}
              parametros={filtros}
            />
          )}
        </div>
      </div>
    </Pagina>
  );
}
