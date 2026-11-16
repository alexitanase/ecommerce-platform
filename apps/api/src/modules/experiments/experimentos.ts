import crypto from 'node:crypto';

/**
 * Pruebas A/B ligeras.
 *
 * Sirven para responder preguntas que nadie sabe contestar mirando: si el
 * botón debería decir "Comprar" o "Añadir al carrito", si conviene enseñar el
 * envío gratis a partir de 40 € o de 60 €, si la ficha vende más con la
 * galería arriba o al lado.
 *
 * Todo el peligro de un A/B está en dos sitios, y los dos viven en este
 * fichero:
 *
 *  · **El reparto.** Si a la misma persona le toca una variante hoy y otra
 *    mañana, el experimento no mide nada: mide ruido. El reparto tiene que ser
 *    determinista a partir de quién es, no aleatorio en cada visita.
 *
 *  · **La lectura.** Con 30 visitas cualquier variante parece ganar por diez
 *    puntos. Decidir con eso es peor que no medir, porque además da confianza:
 *    se cambia la tienda entera por una diferencia que era casualidad. Por eso
 *    aquí no se devuelve nunca un ganador sin decir con cuánta confianza, y
 *    por debajo del mínimo se dice explícitamente que aún no se sabe.
 *
 * Es puro a propósito: se puede probar caso a caso sin base de datos, que es
 * la única forma de tener confianza en un cálculo estadístico.
 */

export interface Variante {
  /** Identificador corto: 'a', 'b', 'control'… */
  clave: string;
  /** Peso relativo del reparto. Dos variantes a 50 y 50 es el reparto normal. */
  peso: number;
  /** Lo que cambia: textos, importes, disposición. Lo interpreta la tienda. */
  valor: unknown;
}

export interface Experimento {
  clave: string;
  variantes: Variante[];
}

/**
 * Qué variante le toca a quien visita.
 *
 * Determinista: el mismo visitante y el mismo experimento dan siempre el mismo
 * resultado, sin guardar nada. Eso importa porque la asignación tiene que
 * sobrevivir a que se borre la cookie, a que la sesión caduque y a que el
 * servidor se reinicie; si no, la misma persona ve una variante distinta cada
 * día y lo que se acaba midiendo es el desconcierto.
 *
 * El hash lleva la clave del experimento además del visitante para que dos
 * experimentos a la vez no repartan igual: si no, quien cae en la variante B
 * de uno cae en la B de todos, y las dos pruebas dejan de ser independientes.
 */
export function asignarVariante(visitante: string, experimento: Experimento): Variante | null {
  const activas = experimento.variantes.filter((v) => v.peso > 0);
  if (activas.length === 0) return null;

  const total = activas.reduce((suma, v) => suma + v.peso, 0);

  // Los primeros 8 hex del sha256 dan un entero de 32 bits: reparto uniforme y
  // estable entre procesos y despliegues. `Math.random()` no serviría —cambia
  // en cada visita— y el hash de cadena de JavaScript reparte fatal con
  // entradas parecidas, que es justo lo que son los identificadores.
  const digest = crypto
    .createHash('sha256')
    .update(`${experimento.clave}:${visitante}`)
    .digest('hex')
    .slice(0, 8);

  const punto = (parseInt(digest, 16) / 0xffffffff) * total;

  let acumulado = 0;
  for (const v of activas) {
    acumulado += v.peso;
    if (punto < acumulado) return v;
  }

  // Solo se llega aquí por el redondeo del punto flotante cuando el hash cae
  // justo en el extremo. La última variante es la respuesta correcta.
  return activas.at(-1) ?? null;
}

export interface ResultadoVariante {
  clave: string;
  visitas: number;
  conversiones: number;
  ingresoCents: number;
}

/**
 * Visitas mínimas por variante antes de mirar el resultado.
 *
 * No es un número mágico: es el punto por debajo del cual la diferencia entre
 * dos variantes está dominada por el azar en cualquier tienda con conversiones
 * del 1-3 %. Con menos, lo honesto es decir que todavía no se sabe.
 */
export const VISITAS_MINIMAS = 200;

/** Confianza a partir de la cual se acepta que la diferencia es real. */
export const CONFIANZA_MINIMA = 0.95;

export interface Lectura {
  variantes: (ResultadoVariante & {
    /** Tasa de conversión, de 0 a 1. */
    tasa: number;
    /** Ingreso medio por visita: lo que de verdad decide. */
    ingresoPorVisitaCents: number;
  })[];
  /** Clave de la variante ganadora, o null si aún no se puede decir. */
  ganadora: string | null;
  /** Probabilidad de que la diferencia no sea casualidad, de 0 a 1. */
  confianza: number;
  /** Por qué todavía no hay ganadora, para enseñarlo en el panel. */
  motivo: 'DATOS_INSUFICIENTES' | 'SIN_DIFERENCIA' | 'CONCLUYENTE';
  /** Cuántas visitas faltan en la variante más floja. */
  visitasQueFaltan: number;
}

/**
 * Lee el resultado de un experimento de dos variantes.
 *
 * Compara la de más conversión contra la otra con un contraste de proporciones
 * de dos colas. No se usa una sola cola aunque la tentación sea grande: la
 * pregunta real no es "¿B es mejor que A?" sino "¿son distintas?", y usar una
 * cola porque se espera que B gane infla la confianza justo cuando más se
 * quiere creer en ella.
 *
 * Con más de dos variantes se compara la mejor contra la segunda; es una
 * aproximación, pero una prueba A/B/C en una tienda pequeña casi nunca reúne
 * datos para más rigor y una lectura conservadora vale más que ninguna.
 */
export function leerResultado(resultados: ResultadoVariante[]): Lectura {
  const variantes = resultados.map((r) => ({
    ...r,
    tasa: r.visitas > 0 ? r.conversiones / r.visitas : 0,
    ingresoPorVisitaCents: r.visitas > 0 ? Math.round(r.ingresoCents / r.visitas) : 0,
  }));

  const ordenadas = [...variantes].sort((a, b) => b.tasa - a.tasa);
  const mejor = ordenadas[0];
  const segunda = ordenadas[1];

  const minimas = variantes.length > 0 ? Math.min(...variantes.map((v) => v.visitas)) : 0;
  const visitasQueFaltan = Math.max(0, VISITAS_MINIMAS - minimas);

  if (!mejor || !segunda || visitasQueFaltan > 0) {
    return {
      variantes,
      ganadora: null,
      confianza: 0,
      motivo: 'DATOS_INSUFICIENTES',
      visitasQueFaltan,
    };
  }

  const confianza = confianzaDeLaDiferencia(mejor, segunda);

  if (confianza < CONFIANZA_MINIMA) {
    return { variantes, ganadora: null, confianza, motivo: 'SIN_DIFERENCIA', visitasQueFaltan: 0 };
  }

  return {
    variantes,
    ganadora: mejor.clave,
    confianza,
    motivo: 'CONCLUYENTE',
    visitasQueFaltan: 0,
  };
}

/**
 * Contraste de proporciones entre dos variantes.
 *
 * Devuelve 1 − p, es decir la confianza en que la diferencia observada no sea
 * casualidad. Es la fórmula clásica del z de dos proporciones con varianza
 * agrupada bajo la hipótesis de que las dos son iguales.
 */
function confianzaDeLaDiferencia(
  a: { conversiones: number; visitas: number },
  b: { conversiones: number; visitas: number },
): number {
  if (a.visitas === 0 || b.visitas === 0) return 0;

  const pA = a.conversiones / a.visitas;
  const pB = b.conversiones / b.visitas;
  const agrupada = (a.conversiones + b.conversiones) / (a.visitas + b.visitas);

  // Sin conversiones en ninguna de las dos —o con todas convertidas— no hay
  // varianza y el cálculo se va a infinito. No hay diferencia que medir.
  if (agrupada <= 0 || agrupada >= 1) return 0;

  const error = Math.sqrt(agrupada * (1 - agrupada) * (1 / a.visitas + 1 / b.visitas));
  if (error === 0) return 0;

  const z = Math.abs(pA - pB) / error;

  // Dos colas: la pregunta es si son distintas, no si una es mejor.
  return 2 * normalAcumulada(z) - 1;
}

/**
 * Φ(z) para z ≥ 0, con la aproximación de Zelen & Severo (Abramowitz &
 * Stegun 26.2.17). El error máximo es de 7,5e-8, muy por debajo de lo que
 * cambiaría cualquier decisión que se tome mirando esto.
 */
function normalAcumulada(z: number): number {
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);

  const polinomio =
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));

  return 1 - d * polinomio;
}
