/**
 * Contabilidad de los cobros en cripto.
 *
 * Cobrar en cripto no es cobrar en euros con otro nombre. Fiscalmente es una
 * **permuta**: se entrega mercancía y se recibe un activo, valorado en euros al
 * cambio del momento en que llega. Ese valor es el ingreso, y coincide con el
 * de la factura.
 *
 * Lo que casi nadie registra viene después. Ese activo se queda en el balance y,
 * cuando se convierte a euros —o se usa para pagar—, la diferencia entre lo que
 * valía al recibirlo y lo que vale al venderlo es una **ganancia o pérdida
 * patrimonial** que hay que declarar. No aparece en ninguna factura ni en el
 * modelo 303; sale solo si alguien la calcula.
 *
 * Y hay que calcularla por **FIFO**: la Agencia Tributaria exige que, al vender
 * monedas homogéneas, se consideren transmitidas las adquiridas en primer lugar
 * (criterio del art. 37.2 de la Ley del IRPF, aplicado a monedas virtuales en
 * sus consultas vinculantes). Usar el precio medio da otro número, y es el
 * número que no cuadra si lo revisan.
 *
 * Todo en céntimos de euro para los importes fiscales y en texto para las
 * cantidades de cripto, que tienen hasta dieciocho decimales.
 */

/** Entrada: cripto recibida por un cobro. */
export interface EntradaCripto {
  id: string;
  fecha: Date;
  moneda: string;
  /** Cantidad recibida, como texto para no perder decimales. */
  cantidad: string;
  /** Valor en euros en el momento de recibirla: es el ingreso de la venta. */
  valorEurCents: number;
  referencia?: string;
}

/** Salida: conversión a euros o pago con la cripto. */
export interface SalidaCripto {
  id: string;
  fecha: Date;
  moneda: string;
  cantidad: string;
  /** Euros realmente obtenidos, ya descontada la comisión del exchange. */
  valorEurCents: number;
  referencia?: string;
}

export interface ResultadoLote {
  /** Entrada de la que sale esta porción. */
  entradaId: string;
  fechaEntrada: Date;
  cantidad: string;
  /** Coste de adquisición imputable a esta porción. */
  costeEurCents: number;
  /** Parte del importe obtenido que corresponde a esta porción. */
  ingresoEurCents: number;
  gananciaEurCents: number;
}

export interface ResultadoSalida {
  salidaId: string;
  fecha: Date;
  moneda: string;
  cantidad: string;
  valorEurCents: number;
  costeEurCents: number;
  /** Positivo es ganancia; negativo, pérdida. */
  gananciaEurCents: number;
  /** De qué entradas ha salido, en orden FIFO. */
  lotes: ResultadoLote[];
}

export interface SaldoMoneda {
  moneda: string;
  /** Cantidad que queda sin convertir. */
  cantidad: string;
  /** Lo que costó adquirirla, en euros: el valor en libros. */
  costeEurCents: number;
}

/**
 * Precisión de trabajo.
 *
 * Se opera con enteros escalados y no con `number` decimal: sumar y restar
 * cantidades de cripto en coma flotante deja restos que convierten un saldo de
 * cero en 0,00000000000001, y ese resto luego se arrastra a un cálculo fiscal.
 */
const DECIMALES = 18n;
const ESCALA = 10n ** DECIMALES;

/** Texto decimal a entero escalado. */
export function aEntero(cantidad: string): bigint {
  const limpio = cantidad.trim();
  const negativo = limpio.startsWith('-');
  const [entera = '0', decimal = ''] = limpio.replace('-', '').split('.');
  const rellenada = (decimal + '0'.repeat(Number(DECIMALES))).slice(0, Number(DECIMALES));
  const valor = BigInt(entera) * ESCALA + BigInt(rellenada || '0');
  return negativo ? -valor : valor;
}

/** Entero escalado a texto decimal, sin ceros sobrantes al final. */
export function aTexto(valor: bigint): string {
  const negativo = valor < 0n;
  const abs = negativo ? -valor : valor;
  const entera = abs / ESCALA;
  const decimal = (abs % ESCALA).toString().padStart(Number(DECIMALES), '0').replace(/0+$/, '');
  return `${negativo ? '-' : ''}${entera.toString()}${decimal ? `.${decimal}` : ''}`;
}

/**
 * Calcula el resultado de cada conversión aplicando FIFO.
 *
 * @returns resultado por salida y saldo pendiente de cada moneda
 */
export function calcularFifo(
  entradas: EntradaCripto[],
  salidas: SalidaCripto[],
): { resultados: ResultadoSalida[]; saldos: SaldoMoneda[] } {
  // Cola por moneda, en orden de llegada: es lo que define el FIFO.
  const colas = new Map<string, { entrada: EntradaCripto; queda: bigint; coste: bigint }[]>();

  for (const e of [...entradas].sort((a, b) => a.fecha.getTime() - b.fecha.getTime())) {
    const moneda = e.moneda.toUpperCase();
    const cola = colas.get(moneda) ?? [];
    cola.push({ entrada: e, queda: aEntero(e.cantidad), coste: BigInt(e.valorEurCents) });
    colas.set(moneda, cola);
  }

  const resultados: ResultadoSalida[] = [];

  for (const s of [...salidas].sort((a, b) => a.fecha.getTime() - b.fecha.getTime())) {
    const moneda = s.moneda.toUpperCase();
    const cola = colas.get(moneda) ?? [];

    let porConsumir = aEntero(s.cantidad);
    const lotes: ResultadoLote[] = [];
    let costeTotal = 0n;

    while (porConsumir > 0n && cola.length > 0) {
      const lote = cola[0];
      if (!lote) break;

      const tomado = lote.queda < porConsumir ? lote.queda : porConsumir;
      const cantidadOriginal = aEntero(lote.entrada.cantidad);

      // Coste proporcional a la porción que se consume del lote.
      const costeLote =
        cantidadOriginal === 0n
          ? 0n
          : (BigInt(lote.entrada.valorEurCents) * tomado) / cantidadOriginal;

      // El ingreso también se reparte, para que cada lote muestre su propio
      // resultado: es lo que permite explicar de dónde sale la ganancia.
      const ingresoLote =
        aEntero(s.cantidad) === 0n ? 0n : (BigInt(s.valorEurCents) * tomado) / aEntero(s.cantidad);

      lotes.push({
        entradaId: lote.entrada.id,
        fechaEntrada: lote.entrada.fecha,
        cantidad: aTexto(tomado),
        costeEurCents: Number(costeLote),
        ingresoEurCents: Number(ingresoLote),
        gananciaEurCents: Number(ingresoLote - costeLote),
      });

      costeTotal += costeLote;
      lote.queda -= tomado;
      lote.coste -= costeLote;
      porConsumir -= tomado;

      if (lote.queda === 0n) cola.shift();
    }

    resultados.push({
      salidaId: s.id,
      fecha: s.fecha,
      moneda,
      cantidad: s.cantidad,
      valorEurCents: s.valorEurCents,
      costeEurCents: Number(costeTotal),
      // La ganancia se calcula sobre el total y no sumando los lotes: el
      // reparto por lote redondea y la suma podría desviarse un céntimo del
      // importe que de verdad se declara.
      gananciaEurCents: s.valorEurCents - Number(costeTotal),
      lotes,
    });
  }

  const saldos: SaldoMoneda[] = [];
  for (const [moneda, cola] of colas) {
    const cantidad = cola.reduce((a, l) => a + l.queda, 0n);
    if (cantidad === 0n) continue;

    saldos.push({
      moneda,
      cantidad: aTexto(cantidad),
      costeEurCents: cola.reduce((a, l) => a + Number(l.coste), 0),
    });
  }

  return { resultados, saldos };
}

/**
 * Umbral del modelo 721.
 *
 * Declaración informativa de monedas virtuales situadas en el extranjero: hay
 * que presentarla si el saldo conjunto a 31 de diciembre supera los 50.000 €.
 * Los fondos que custodia la pasarela cuentan, y no presentarla teniéndola que
 * presentar tiene sanción propia, al margen de que los impuestos estén bien.
 */
export const UMBRAL_MODELO_721_CENTS = 5_000_000;

/**
 * ¿Toca presentar el modelo 721?
 *
 * Se compara con el valor **de mercado a 31 de diciembre**, no con el coste de
 * adquisición: es lo que pide la declaración, y una moneda que se ha
 * revalorizado puede pasar el umbral sin que se haya comprado nada más.
 */
export function obligaModelo721(valorMercadoCents: number): boolean {
  return valorMercadoCents > UMBRAL_MODELO_721_CENTS;
}

export interface ResumenEjercicio {
  ingresosPorVentasCents: number;
  gananciasCents: number;
  perdidasCents: number;
  resultadoNetoCents: number;
  saldos: SaldoMoneda[];
  costeSaldosCents: number;
}

/** Resumen de un ejercicio, tal y como lo necesita el asesor. */
export function resumirEjercicio(
  entradas: EntradaCripto[],
  salidas: SalidaCripto[],
): ResumenEjercicio {
  const { resultados, saldos } = calcularFifo(entradas, salidas);

  const ganancias = resultados
    .filter((r) => r.gananciaEurCents > 0)
    .reduce((a, r) => a + r.gananciaEurCents, 0);

  // Las pérdidas se devuelven aparte y en positivo: en la declaración van en
  // casillas distintas, y compensarlas antes de tiempo esconde el detalle.
  const perdidas = resultados
    .filter((r) => r.gananciaEurCents < 0)
    .reduce((a, r) => a - r.gananciaEurCents, 0);

  return {
    ingresosPorVentasCents: entradas.reduce((a, e) => a + e.valorEurCents, 0),
    gananciasCents: ganancias,
    perdidasCents: perdidas,
    resultadoNetoCents: ganancias - perdidas,
    saldos,
    costeSaldosCents: saldos.reduce((a, s) => a + s.costeEurCents, 0),
  };
}
