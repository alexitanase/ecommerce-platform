'use client';

import { useEffect, useState } from 'react';

export interface Sugerencia {
  id: string;
  name: string;
  slug: string;
  imagen: string | null;
  priceCents: number;
}

/** Con menos letras no se consulta: los resultados no dirían nada. */
const MINIMO = 2;

/**
 * Cuánto se espera antes de preguntar.
 *
 * No es cosmético: sin él, escribir «zapatillas» dispara once peticiones, diez
 * de las cuales llegan ya obsoletas. Doscientos cincuenta milisegundos es
 * menos de lo que se tarda en escribir la letra siguiente, así que quien
 * escribe seguido solo gasta una petición y quien se para ve la lista al
 * momento.
 */
const RETARDO_MS = 250;

/**
 * Sugerencias del buscador mientras se escribe.
 *
 * Está aquí y no dentro de un componente porque hay dos buscadores —el de la
 * barra en el escritorio y el de pantalla completa en el móvil— y cuando la
 * lógica estaba duplicada bastaba tocar uno para que dejaran de comportarse
 * igual. La búsqueda es lo primero que hace quien entra a una tienda: no puede
 * responder distinto según el tamaño de la pantalla.
 *
 * `credentials: 'include'` no está de adorno: la API decide si enseña el
 * catálogo +18 mirando la cookie de verificación de edad, y la tienda y la API
 * son orígenes distintos. Sin esa opción el navegador no la manda, y quien ya
 * ha declarado su edad escribe el nombre de un producto y el desplegable le
 * dice que no existe, para después encontrarlo al pulsar intro.
 */
export function useSugerencias(consulta: string, locale: string) {
  /*
   * La consulta y su respuesta viajan juntas, y de ahí sale «está cargando».
   *
   * Guardar un `cargando` aparte obliga a apagarlo desde el efecto cada vez
   * que se borra el campo, que es un `setState` dentro de un efecto: React lo
   * desaconseja expresamente porque encadena un render de más por pulsación.
   * Sabiendo a qué consulta corresponde lo que hay, «está cargando» es
   * simplemente «lo que tengo no es de lo que se está escribiendo».
   */
  const [respuesta, setRespuesta] = useState<{ consulta: string; sugerencias: Sugerencia[] }>({
    consulta: '',
    sugerencias: [],
  });

  const limpia = consulta.trim();

  useEffect(() => {
    if (consulta.trim().length < MINIMO) return;

    const controlador = new AbortController();
    const temporizador = setTimeout(() => {
      const base = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
      fetch(`${base}/api/v1/search/suggest?q=${encodeURIComponent(consulta)}&locale=${locale}`, {
        signal: controlador.signal,
        credentials: 'include',
      })
        .then((r) => r.json() as Promise<{ sugerencias: Sugerencia[] }>)
        .then((d) => {
          setRespuesta({ consulta: consulta.trim(), sugerencias: d.sugerencias ?? [] });
        })
        .catch(() => {
          // Petición cancelada o buscador caído: no se molesta a nadie con un
          // error, simplemente no hay sugerencias. Quien está escribiendo
          // puede pulsar intro y llegar a la búsqueda completa igual.
        });
    }, RETARDO_MS);

    return () => {
      clearTimeout(temporizador);
      controlador.abort();
    };
  }, [consulta, locale]);

  return {
    /*
     * Todo derivado, sin un `setState` al vaciar el campo.
     *
     * Al borrar lo escrito las sugerencias tienen que desaparecer en el mismo
     * render, no en el siguiente: calculándolo aquí no hay un fotograma con la
     * lista anterior colgando de un campo vacío.
     *
     * Mientras se escribe se siguen enseñando las de la consulta anterior en
     * vez de vaciar la lista. Vaciarla dejaría el desplegable parpadeando en
     * cada letra, y las anteriores casi siempre siguen valiendo: quien escribe
     * «satisf» y luego «satisfy» busca lo mismo.
     */
    sugerencias: limpia.length < MINIMO ? [] : respuesta.sugerencias,
    cargando: limpia.length >= MINIMO && respuesta.consulta !== limpia,
  };
}
