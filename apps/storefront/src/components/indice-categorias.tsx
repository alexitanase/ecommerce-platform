'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import type { Categoria } from '@/lib/categorias';
import { Icono } from './ui/icono';
import { Vacio } from './ui/estados';

/** Cuántas hijas se enseñan bajo cada raíz antes de resumir con «ver todo». */
const HIJAS_VISIBLES = 6;

/**
 * Aplana una rama a la lista de sus nombres, para poder buscar dentro.
 *
 * Buscando solo por el nombre de la raíz, escribir «anillo» no encontraría
 * nada aunque exista «Juguetes › Anillos»: la raíz se llama «Juguetes». Se
 * mira el nombre de toda la descendencia, que es como la gente espera que
 * funcione un buscador de categorías.
 */
function nombresDeLaRama(categoria: Categoria): string {
  return [categoria.name, ...categoria.children.map(nombresDeLaRama)].join(' ');
}

/**
 * Sin tildes y en minúsculas.
 *
 * «bdsm» tiene que encontrar «BDSM» y «lubricantes» tiene que encontrar
 * «Lubricants & Óleos»: quien escribe en el buscador de una tienda no pone
 * tildes, y una categoría que existe y no aparece se lee como que no está.
 */
const aplanar = (texto: string): string =>
  texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/**
 * El índice del catálogo: todas las categorías, organizadas.
 *
 * Existe porque el menú de la tienda tiene sitio para seis enlaces y el
 * catálogo tiene cientos de categorías: a las que no caben en el menú solo se
 * llegaba acertando con el buscador de productos, que es pedirle a alguien que
 * adivine cómo llamamos nosotros a lo que él busca.
 *
 * Se organiza por raíces —cada una con su foto— y debajo sus hijas como
 * enlaces de texto. Enseñar el árbol entero con foto en cada nivel convertiría
 * la página en un muro de cientos de imágenes que tarda en cargar y en el que
 * no se distingue lo importante de lo accesorio.
 *
 * El buscador filtra en el navegador y no pidiendo nada al servidor: el árbol
 * ya está aquí entero, y una petición por letra para filtrar una lista que ya
 * se tiene es gastar red para ir más lento.
 */
export function IndiceCategorias({ arbol }: { arbol: Categoria[] }) {
  const t = useTranslations('categorias');
  const [consulta, setConsulta] = useState('');

  const visibles = useMemo(() => {
    const buscado = aplanar(consulta.trim());
    // Las vacías se descartan siempre: una categoría que lleva a «sin
    // resultados» es peor que no ofrecerla. En un catálogo importado de un
    // proveedor siempre quedan ramas creadas que todavía no tienen nada.
    const conProductos = arbol.filter((c) => c.productosRama > 0);

    if (!buscado) return conProductos;
    return conProductos.filter((c) => aplanar(nombresDeLaRama(c)).includes(buscado));
  }, [arbol, consulta]);

  if (arbol.length === 0) {
    return <Vacio icono="imagen" titulo={t('vacia')} />;
  }

  return (
    <>
      <div className="relative mb-8 max-w-md">
        <label className="solo-lectores" htmlFor="buscar-categoria">
          {t('buscar')}
        </label>
        <input
          id="buscar-categoria"
          type="search"
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          placeholder={t('buscar')}
          className="campo pl-9"
          autoComplete="off"
        />
        <Icono
          nombre="busqueda"
          tamano={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--texto-tenue)]"
        />
      </div>

      {visibles.length === 0 ? (
        <Vacio
          icono="busqueda"
          titulo={t('sin_resultados', { consulta: consulta.trim() })}
          descripcion={t('sin_resultados_ayuda')}
        />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((raiz) => (
            <section key={raiz.id} className="card overflow-hidden">
              <Link
                href={`/buscar?categoria=${raiz.slug}` as never}
                className="group block focus-visible:outline-offset-[-2px]"
              >
                {/* `div` y no `span`: dentro va el `h2` con el nombre de la
                    categoría, y un titular dentro de contenido en línea es
                    HTML inválido. El enlace sí puede contener bloques. */}
                <div className="relative aspect-[16/9] overflow-hidden bg-[var(--fondo-sutil)]">
                  {raiz.imagen ? (
                    <Image
                      src={raiz.imagen}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-[var(--texto-tenue)]">
                      <Icono nombre="imagen" tamano={32} />
                    </div>
                  )}
                </div>

                <div className="flex items-baseline justify-between gap-3 px-4 pt-3">
                  <h2 className="text-base font-semibold tracking-tight">{raiz.name}</h2>
                  <span className="shrink-0 text-xs text-[var(--texto-tenue)]">
                    {t('productos', { total: raiz.productosRama })}
                  </span>
                </div>
              </Link>

              {raiz.children.length > 0 && (
                <ul className="flex flex-wrap gap-x-3 gap-y-1 px-4 pb-4 pt-2">
                  {raiz.children
                    .filter((h) => h.productosRama > 0)
                    .slice(0, HIJAS_VISIBLES)
                    .map((hija) => (
                      <li key={hija.id}>
                        <Link
                          href={`/buscar?categoria=${hija.slug}` as never}
                          className="text-sm text-[var(--texto-suave)] underline-offset-4 hover:text-[var(--texto)] hover:underline"
                        >
                          {hija.name}
                        </Link>
                      </li>
                    ))}

                  {/* «Ver todo» solo cuando de verdad hay más de lo que se
                      enseña: puesto siempre, es un enlace que promete algo que
                      no está y se deja de pulsar. */}
                  {raiz.children.filter((h) => h.productosRama > 0).length > HIJAS_VISIBLES && (
                    <li>
                      <Link
                        href={`/buscar?categoria=${raiz.slug}` as never}
                        className="text-sm font-medium text-[var(--marca-texto)]"
                      >
                        {t('ver_todo')}
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
