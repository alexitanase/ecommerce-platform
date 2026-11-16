/**
 * Formulario modelo de desistimiento.
 *
 * Facilitarlo es **obligatorio** (anexo B del texto refundido de la LGDCU, que
 * traspone el anexo I.B de la Directiva 2011/83/UE). No es un texto orientativo:
 * su contenido está fijado por norma, así que se reproduce con esa estructura.
 *
 * El cliente NO está obligado a usarlo —puede desistir por cualquier medio que
 * deje constancia, incluido el botón de la tienda—, pero nosotros sí estamos
 * obligados a ponérselo a mano. No hacerlo alarga su plazo a doce meses.
 */

import type { Locale } from '@ecom/shared';

export interface DatosEmisor {
  razonSocial: string;
  nif: string;
  domicilio: string;
  email: string;
  telefono?: string | null;
}

export interface DatosPedido {
  numero: string;
  fechaPedido: Date;
  fechaEntrega: Date | null;
}

const TEXTOS = {
  es: {
    titulo: 'Formulario de desistimiento',
    intro:
      'Solo debe cumplimentar y enviar este formulario si desea desistir del contrato. ' +
      'No es obligatorio usarlo: puede comunicarnos su decisión por cualquier medio que deje constancia.',
    destinatario: 'A la atención de',
    cuerpo:
      'Por la presente le comunico que desisto de mi contrato de venta de los siguientes bienes:',
    pedidoNum: 'Número de pedido',
    fechaPedido: 'Pedido realizado el',
    fechaRecepcion: 'Recibido el',
    nombreConsumidor: 'Nombre del consumidor',
    domicilioConsumidor: 'Domicilio del consumidor',
    firma: 'Firma del consumidor (solo si se presenta en papel)',
    fecha: 'Fecha',
    plazoAviso:
      'Dispone de 14 días naturales desde la recepción del pedido para desistir, sin necesidad de justificación. ' +
      'Le reembolsaremos todos los pagos recibidos, incluidos los gastos de envío ordinarios, ' +
      'como muy tarde 14 días naturales desde que nos comunique su decisión.',
    excepciones:
      'Quedan excluidos del derecho de desistimiento los productos precintados que no sean aptos para su devolución ' +
      'por razones de higiene o protección de la salud y hayan sido desprecintados tras la entrega, ' +
      'así como los bienes confeccionados a medida o claramente personalizados.',
  },
  ca: {
    titulo: 'Formulari de desistiment',
    intro:
      'Només cal que empleneu i envieu aquest formulari si voleu desistir del contracte. ' +
      'No és obligatori fer-lo servir: podeu comunicar-nos la decisió per qualsevol mitjà que en deixi constància.',
    destinatario: "A l'atenció de",
    cuerpo:
      'Per la present us comunico que desisteixo del meu contracte de venda dels béns següents:',
    pedidoNum: 'Número de comanda',
    fechaPedido: 'Comanda feta el',
    fechaRecepcion: 'Rebuda el',
    nombreConsumidor: 'Nom del consumidor',
    domicilioConsumidor: 'Domicili del consumidor',
    firma: 'Signatura del consumidor (només si es presenta en paper)',
    fecha: 'Data',
    plazoAviso:
      'Disposeu de 14 dies naturals des de la recepció de la comanda per desistir, sense necessitat de justificació. ' +
      "Us reemborsarem tots els pagaments rebuts, incloses les despeses d'enviament ordinàries, " +
      'com a molt tard 14 dies naturals des que ens comuniqueu la decisió.',
    excepciones:
      'Queden exclosos del dret de desistiment els productes precintats que no siguin aptes per a la devolució ' +
      "per raons d'higiene o protecció de la salut i hagin estat desprecintats després del lliurament, " +
      'així com els béns fets a mida o clarament personalitzats.',
  },
  en: {
    titulo: 'Withdrawal form',
    intro:
      'Complete and return this form only if you wish to withdraw from the contract. ' +
      'Using it is not mandatory: you may inform us of your decision by any means that leaves a record.',
    destinatario: 'To',
    cuerpo: 'I hereby give notice that I withdraw from my contract of sale of the following goods:',
    pedidoNum: 'Order number',
    fechaPedido: 'Ordered on',
    fechaRecepcion: 'Received on',
    nombreConsumidor: 'Consumer name',
    domicilioConsumidor: 'Consumer address',
    firma: 'Consumer signature (only if this form is submitted on paper)',
    fecha: 'Date',
    plazoAviso:
      'You have 14 calendar days from receipt of the order to withdraw, without giving any reason. ' +
      'We will refund all payments received, including standard delivery costs, ' +
      'no later than 14 calendar days from the day we are informed of your decision.',
    excepciones:
      'Sealed goods which are not suitable for return for health protection or hygiene reasons and were ' +
      'unsealed after delivery are excluded from the right of withdrawal, as are goods made to the ' +
      "consumer's specifications or clearly personalised.",
  },
} as const;

function formatearFecha(fecha: Date, locale: Locale): string {
  const idioma = locale === 'ca' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES';
  return new Intl.DateTimeFormat(idioma, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    fecha,
  );
}

/**
 * Genera el formulario en texto plano.
 *
 * En texto y no en PDF a propósito: se puede pegar en un correo, imprimir o
 * descargar, y no exige que el cliente tenga con qué abrir un PDF. La norma
 * no impone formato, solo contenido.
 */
export function formularioDesistimiento(
  emisor: DatosEmisor,
  pedido: DatosPedido,
  locale: Locale = 'es',
): string {
  const t = TEXTOS[locale] ?? TEXTOS.es;
  const linea = '─'.repeat(60);

  return [
    t.titulo.toUpperCase(),
    linea,
    '',
    t.intro,
    '',
    `${t.destinatario}:`,
    `  ${emisor.razonSocial} · ${emisor.nif}`,
    `  ${emisor.domicilio}`,
    `  ${emisor.email}${emisor.telefono ? ` · ${emisor.telefono}` : ''}`,
    '',
    linea,
    '',
    t.cuerpo,
    '',
    `  ${t.pedidoNum}: ${pedido.numero}`,
    `  ${t.fechaPedido}: ${formatearFecha(pedido.fechaPedido, locale)}`,
    `  ${t.fechaRecepcion}: ${
      pedido.fechaEntrega ? formatearFecha(pedido.fechaEntrega, locale) : '________________'
    }`,
    '',
    `  ${t.nombreConsumidor}: ________________________________`,
    '',
    `  ${t.domicilioConsumidor}: ______________________________`,
    '',
    `  ${t.firma}: __________________`,
    '',
    `  ${t.fecha}: ______________`,
    '',
    linea,
    '',
    t.plazoAviso,
    '',
    t.excepciones,
    '',
  ].join('\n');
}
