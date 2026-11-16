import type { Locale } from '@ecom/shared';
import {
  boton,
  enlaceAlternativo,
  envolver,
  escapar,
  h1,
  p,
  precio,
  separador,
  type ContenidoEmail,
  type Marca,
} from './base.js';

/**
 * Catálogo de emails transaccionales.
 *
 * Cada plantilla recibe el idioma del cliente. Escribir a alguien en un idioma
 * que no eligió es la forma más rápida de que marque el correo como spam.
 */

// ── Textos por idioma ───────────────────────────────────────

const T = {
  es: {
    hola: (n: string) => `Hola${n ? `, ${n}` : ''}:`,
    verificarAsunto: 'Confirma tu dirección de email',
    newsletterAsunto: 'Confirma tu suscripción',
    newsletterTitulo: 'Un último paso',
    newsletterCuerpo:
      'Alguien ha pedido suscribir esta dirección a nuestras novedades y ofertas. Si has sido tú, confírmalo con el botón de abajo.',
    newsletterBoton: 'Confirmar suscripción',
    newsletterCaduca: (horas: number) => `El enlace caduca en ${String(horas)} horas.`,
    newsletterNoPedido:
      'Si no has sido tú, ignora este mensaje: sin confirmar no te llegará nada más.',
    verificarTitulo: 'Confirma tu email',
    verificarCuerpo:
      'Solo queda un paso. Pulsa el botón para confirmar que esta dirección es tuya.',
    verificarBoton: 'Confirmar mi email',
    verificarCaduca: 'Este enlace caduca en 24 horas.',
    verificarNoPedido: 'Si no has creado ninguna cuenta, puedes ignorar este mensaje.',

    resetAsunto: 'Restablece tu contraseña',
    resetTitulo: 'Restablecer contraseña',
    resetCuerpo: 'Has pedido cambiar tu contraseña. Pulsa el botón para elegir una nueva.',
    resetBoton: 'Elegir contraseña nueva',
    resetCaduca: 'Este enlace caduca en 1 hora y solo se puede usar una vez.',
    resetNoPedido:
      'Si no has sido tú, ignora este mensaje: tu contraseña actual sigue siendo válida.',

    pedidoAsunto: (n: string) => `Hemos recibido tu pedido ${n}`,
    pedidoTitulo: '¡Gracias por tu compra!',
    pedidoCuerpo: 'Hemos recibido tu pedido y estamos preparándolo.',
    pedidoResumen: 'Resumen del pedido',
    pedidoTotal: 'Total',
    pedidoEnvio: 'Enviar a',
    pedidoPlazo:
      'Los productos se envían desde el proveedor, así que el plazo habitual es de 2 a 4 semanas. Te avisaremos en cuanto salga el paquete.',
    pedidoBoton: 'Ver mi pedido',

    envioAsunto: (n: string) => `Tu pedido ${n} ya está en camino`,
    envioTitulo: 'Tu pedido va de camino',
    envioCuerpo: 'Ya hemos enviado tu pedido. Puedes seguirlo con este número:',
    envioBoton: 'Seguir mi envío',

    entregadoAsunto: (n: string) => `Tu pedido ${n} ha llegado`,
    entregadoTitulo: '¡Tu pedido ha llegado!',
    entregadoCuerpo:
      'Esperamos que todo esté correcto. Si algo no encaja, escríbenos y lo solucionamos.',
    entregadoResena: '¿Nos dejas tu opinión? Ayuda mucho a otros compradores.',
    entregadoBoton: 'Valorar mi compra',

    valoracionAsunto: (n: string) => `¿Qué te ha parecido tu pedido ${n}?`,
    valoracionTitulo: '¿Nos cuentas qué tal?',
    valoracionCuerpo:
      'Ya han pasado unos días desde que recibiste tu pedido. Si te ha gustado —o si no—, tu opinión ayuda muchísimo a quien está dudando.',
    valoracionBoton: 'Valorar',
    valoracionPie: 'Solo se tarda un minuto y no hace falta registrarse si ya tienes cuenta.',

    invitacionAsunto: (m: string) => `Te han invitado a gestionar ${m}`,
    invitacionTitulo: 'Bienvenido al equipo',
    invitacionCuerpo: 'Te han dado acceso al panel de administración. Elige tu contraseña:',
    invitacionBoton: 'Establecer mi contraseña',
    invitacionCaduca: 'Esta invitación caduca en 7 días.',

    incidenciaAsunto: (n: string) => `Incidencia en el pedido ${n}`,
    incidenciaTitulo: 'Un pedido necesita tu atención',
    incidenciaBoton: 'Ver en el panel',

    carritoAsunto: 'Te has dejado algo en el carrito',
    carritoAsuntoCupon: (c: string) => `Tu carrito te espera, y con un ${c} de descuento`,
    carritoTitulo: 'Tu carrito sigue aquí',
    carritoCuerpo: 'Guardamos lo que elegiste. Puedes seguir donde lo dejaste:',
    carritoCupon: (c: string, d: string) =>
      `Usa el código ${c} al pagar y te llevas un ${d} de descuento.`,
    carritoStock: 'No reservamos las unidades, así que si te interesa, mejor no esperar.',
    carritoBoton: 'Volver a mi carrito',
    carritoBaja: 'Si prefieres no recibir estos recordatorios, dínoslo aquí.',
    pieCarrito: 'Te escribimos porque dejaste tu email en nuestro checkout.',

    pagoCaducadoAsunto: (n: string) => `Tu pago del pedido ${n} no llegó a completarse`,
    pagoCaducadoTitulo: 'Tu pedido sigue reservado',
    pagoCaducadoCuerpo:
      'El plazo del pago caducó antes de recibirlo. No se te ha cobrado nada y el pedido sigue guardado: puedes volver a intentarlo cuando quieras.',
    pagoCaducadoCripto:
      'En cripto el importe se fija al empezar y solo vale unos minutos, por eso caduca tan rápido. Al reintentar se calcula de nuevo con el cambio del momento.',
    pagoCaducadoBoton: 'Terminar mi pago',

    referidoAsunto: 'Tienes un descuento por recomendarnos',
    referidoTitulo: 'Gracias por recomendarnos',
    referidoCuerpo: 'Alguien ha comprado con tu código. Este descuento es para ti:',
    referidoBienvenidaAsunto: 'Aquí tienes tu descuento de bienvenida',
    referidoBienvenidaTitulo: 'Bienvenido, y gracias',
    referidoBienvenidaCuerpo:
      'Llegaste recomendado, así que este descuento es para tu próximo pedido:',
    referidoCondiciones: (importe: string, minimo: string, dias: number) =>
      `${importe} de descuento en pedidos de ${minimo} o más. Caduca en ${String(dias)} días.`,
    referidoBoton: 'Ir a la tienda',
    pieReferido: 'Te escribimos por el programa de recomendaciones de la tienda.',

    piePedido: 'Este mensaje se refiere a un pedido que has realizado.',
    pieCuenta: 'Este mensaje se refiere a la seguridad de tu cuenta.',
  },
  ca: {
    hola: (n: string) => `Hola${n ? `, ${n}` : ''}:`,
    verificarAsunto: 'Confirma la teva adreça de correu',
    newsletterAsunto: 'Confirma la teva subscripció',
    newsletterTitulo: 'Un últim pas',
    newsletterCuerpo:
      'Algú ha demanat subscriure aquesta adreça a les nostres novetats i ofertes. Si has estat tu, confirma-ho amb el botó de sota.',
    newsletterBoton: 'Confirma la subscripció',
    newsletterCaduca: (horas: number) => `L'enllaç caduca en ${String(horas)} hores.`,
    newsletterNoPedido:
      'Si no has estat tu, ignora aquest missatge: sense confirmar no rebràs res més.',
    verificarTitulo: 'Confirma el teu correu',
    verificarCuerpo: 'Només queda un pas. Prem el botó per confirmar que aquesta adreça és teva.',
    verificarBoton: 'Confirmar el meu correu',
    verificarCaduca: 'Aquest enllaç caduca en 24 hores.',
    verificarNoPedido: 'Si no has creat cap compte, pots ignorar aquest missatge.',

    resetAsunto: 'Restableix la teva contrasenya',
    resetTitulo: 'Restablir contrasenya',
    resetCuerpo: 'Has demanat canviar la contrasenya. Prem el botó per triar-ne una de nova.',
    resetBoton: 'Triar contrasenya nova',
    resetCaduca: 'Aquest enllaç caduca en 1 hora i només es pot fer servir una vegada.',
    resetNoPedido:
      'Si no has estat tu, ignora aquest missatge: la teva contrasenya actual continua sent vàlida.',

    pedidoAsunto: (n: string) => `Hem rebut la teva comanda ${n}`,
    pedidoTitulo: 'Gràcies per la teva compra!',
    pedidoCuerpo: 'Hem rebut la teva comanda i l’estem preparant.',
    pedidoResumen: 'Resum de la comanda',
    pedidoTotal: 'Total',
    pedidoEnvio: 'Enviar a',
    pedidoPlazo:
      'Els productes s’envien des del proveïdor, així que el termini habitual és de 2 a 4 setmanes. T’avisarem quan surti el paquet.',
    pedidoBoton: 'Veure la meva comanda',

    envioAsunto: (n: string) => `La teva comanda ${n} ja està en camí`,
    envioTitulo: 'La teva comanda va de camí',
    envioCuerpo: 'Ja hem enviat la teva comanda. La pots seguir amb aquest número:',
    envioBoton: 'Seguir el meu enviament',

    entregadoAsunto: (n: string) => `La teva comanda ${n} ha arribat`,
    entregadoTitulo: 'La teva comanda ha arribat!',
    entregadoCuerpo: 'Esperem que tot estigui correcte. Si alguna cosa no encaixa, escriu-nos.',
    entregadoResena: 'Ens deixes la teva opinió? Ajuda molt altres compradors.',
    entregadoBoton: 'Valorar la meva compra',

    valoracionAsunto: (n: string) => `Què t'ha semblat la comanda ${n}?`,
    valoracionTitulo: 'Ens expliques què tal?',
    valoracionCuerpo:
      "Ja fa uns dies que vas rebre la comanda. Tant si t'ha agradat com si no, la teva opinió ajuda moltíssim qui està dubtant.",
    valoracionBoton: 'Valorar',
    valoracionPie: 'Només es triga un minut i no cal registrar-se si ja tens compte.',

    invitacionAsunto: (m: string) => `T'han convidat a gestionar ${m}`,
    invitacionTitulo: 'Benvingut a l’equip',
    invitacionCuerpo: "T'han donat accés al panell d'administració. Tria la teva contrasenya:",
    invitacionBoton: 'Establir la meva contrasenya',
    invitacionCaduca: 'Aquesta invitació caduca en 7 dies.',

    incidenciaAsunto: (n: string) => `Incidència a la comanda ${n}`,
    incidenciaTitulo: 'Una comanda necessita la teva atenció',
    incidenciaBoton: 'Veure al panell',

    carritoAsunto: "T'has deixat alguna cosa al carretó",
    carritoAsuntoCupon: (c: string) => `El teu carretó t'espera, i amb un ${c} de descompte`,
    carritoTitulo: 'El teu carretó continua aquí',
    carritoCuerpo: 'Hem desat el que vas triar. Pots continuar on ho vas deixar:',
    carritoCupon: (c: string, d: string) =>
      `Fes servir el codi ${c} en pagar i t'emportes un ${d} de descompte.`,
    carritoStock: 'No reservem les unitats, així que si t’interessa, millor no esperar.',
    carritoBoton: 'Tornar al meu carretó',
    carritoBaja: 'Si prefereixes no rebre aquests recordatoris, digues-nos-ho aquí.',
    pieCarrito: 'T’escrivim perquè vas deixar el teu correu al nostre checkout.',

    pagoCaducadoAsunto: (n: string) => `El pagament de la comanda ${n} no es va completar`,
    pagoCaducadoTitulo: 'La teva comanda continua reservada',
    pagoCaducadoCuerpo:
      'El termini del pagament va caducar abans de rebre’l. No se t’ha cobrat res i la comanda continua desada: pots tornar-ho a provar quan vulguis.',
    pagoCaducadoCripto:
      'En cripto l’import es fixa en començar i només val uns minuts, per això caduca tan de pressa. En reintentar-ho es calcula de nou amb el canvi del moment.',
    pagoCaducadoBoton: 'Acabar el meu pagament',

    referidoAsunto: 'Tens un descompte per recomanar-nos',
    referidoTitulo: 'Gràcies per recomanar-nos',
    referidoCuerpo: 'Algú ha comprat amb el teu codi. Aquest descompte és per a tu:',
    referidoBienvenidaAsunto: 'Aquí tens el teu descompte de benvinguda',
    referidoBienvenidaTitulo: 'Benvingut, i gràcies',
    referidoBienvenidaCuerpo:
      'Vas arribar recomanat, així que aquest descompte és per a la teva propera comanda:',
    referidoCondiciones: (importe: string, minimo: string, dias: number) =>
      `${importe} de descompte en comandes de ${minimo} o més. Caduca en ${String(dias)} dies.`,
    referidoBoton: 'Anar a la botiga',
    pieReferido: 'T’escrivim pel programa de recomanacions de la botiga.',

    piePedido: 'Aquest missatge fa referència a una comanda que has fet.',
    pieCuenta: 'Aquest missatge fa referència a la seguretat del teu compte.',
  },
  en: {
    hola: (n: string) => `Hello${n ? `, ${n}` : ''},`,
    verificarAsunto: 'Confirm your email address',
    newsletterAsunto: 'Confirm your subscription',
    newsletterTitulo: 'One last step',
    newsletterCuerpo:
      'Someone asked to subscribe this address to our news and offers. If it was you, confirm with the button below.',
    newsletterBoton: 'Confirm subscription',
    newsletterCaduca: (horas: number) => `The link expires in ${String(horas)} hours.`,
    newsletterNoPedido:
      'If it was not you, just ignore this message: without confirming you will not hear from us again.',
    verificarTitulo: 'Confirm your email',
    verificarCuerpo: 'One step to go. Press the button to confirm this address is yours.',
    verificarBoton: 'Confirm my email',
    verificarCaduca: 'This link expires in 24 hours.',
    verificarNoPedido: "If you didn't create an account, you can ignore this message.",

    resetAsunto: 'Reset your password',
    resetTitulo: 'Reset password',
    resetCuerpo: 'You asked to change your password. Press the button to choose a new one.',
    resetBoton: 'Choose a new password',
    resetCaduca: 'This link expires in 1 hour and can only be used once.',
    resetNoPedido: "If this wasn't you, ignore this message: your current password remains valid.",

    pedidoAsunto: (n: string) => `We've received your order ${n}`,
    pedidoTitulo: 'Thank you for your purchase!',
    pedidoCuerpo: "We've received your order and we're preparing it.",
    pedidoResumen: 'Order summary',
    pedidoTotal: 'Total',
    pedidoEnvio: 'Ship to',
    pedidoPlazo:
      'Products ship from the supplier, so the usual lead time is 2 to 4 weeks. We will let you know as soon as the parcel leaves.',
    pedidoBoton: 'View my order',

    envioAsunto: (n: string) => `Your order ${n} is on its way`,
    envioTitulo: 'Your order is on its way',
    envioCuerpo: "We've shipped your order. You can track it with this number:",
    envioBoton: 'Track my shipment',

    entregadoAsunto: (n: string) => `Your order ${n} has arrived`,
    entregadoTitulo: 'Your order has arrived!',
    entregadoCuerpo:
      "We hope everything is right. If something isn't, write to us and we'll fix it.",
    entregadoResena: 'Would you leave a review? It helps other shoppers a lot.',
    entregadoBoton: 'Review my purchase',

    valoracionAsunto: (n: string) => `How was your order ${n}?`,
    valoracionTitulo: 'How did it go?',
    valoracionCuerpo:
      'It has been a few days since your order arrived. Whether you loved it or not, your review helps anyone still deciding.',
    valoracionBoton: 'Write a review',
    valoracionPie:
      'It takes a minute, and there is no need to sign up if you already have an account.',

    invitacionAsunto: (m: string) => `You've been invited to manage ${m}`,
    invitacionTitulo: 'Welcome to the team',
    invitacionCuerpo: "You've been given access to the admin panel. Choose your password:",
    invitacionBoton: 'Set my password',
    invitacionCaduca: 'This invitation expires in 7 days.',

    incidenciaAsunto: (n: string) => `Issue with order ${n}`,
    incidenciaTitulo: 'An order needs your attention',
    incidenciaBoton: 'View in the panel',

    carritoAsunto: 'You left something in your basket',
    carritoAsuntoCupon: (c: string) => `Your basket is waiting, with ${c} off`,
    carritoTitulo: 'Your basket is still here',
    carritoCuerpo: 'We kept what you picked. Carry on where you left off:',
    carritoCupon: (c: string, d: string) => `Use code ${c} at checkout and get ${d} off.`,
    carritoStock: "We don't hold stock, so if you want it, better not to wait.",
    carritoBoton: 'Back to my basket',
    carritoBaja: "If you'd rather not get these reminders, tell us here.",
    pieCarrito: 'We are writing because you left your email at our checkout.',

    pagoCaducadoAsunto: (n: string) => `Your payment for order ${n} was not completed`,
    pagoCaducadoTitulo: 'Your order is still held',
    pagoCaducadoCuerpo:
      'The payment window expired before we received it. You have not been charged and your order is still saved: you can try again whenever you like.',
    pagoCaducadoCripto:
      'With crypto the amount is fixed when you start and only holds for a few minutes, which is why it expires so fast. Trying again quotes it at the current rate.',
    pagoCaducadoBoton: 'Finish my payment',

    referidoAsunto: 'Here is your discount for recommending us',
    referidoTitulo: 'Thanks for the recommendation',
    referidoCuerpo: 'Someone ordered using your code. This discount is for you:',
    referidoBienvenidaAsunto: 'Here is your welcome discount',
    referidoBienvenidaTitulo: 'Welcome, and thanks',
    referidoBienvenidaCuerpo:
      'You came recommended, so this discount is waiting for your next order:',
    referidoCondiciones: (importe: string, minimo: string, dias: number) =>
      `${importe} off orders of ${minimo} or more. Expires in ${String(dias)} days.`,
    referidoBoton: 'Go to the shop',
    pieReferido: 'We are writing about the shop referral programme.',

    piePedido: 'This message relates to an order you placed.',
    pieCuenta: 'This message relates to your account security.',
  },
} as const;

const textos = (locale: Locale) => T[locale];

// ── Plantillas ──────────────────────────────────────────────

export function verificarEmail(
  marca: Marca,
  datos: { nombre: string; url: string; locale: Locale },
): ContenidoEmail {
  const t = textos(datos.locale);

  const cuerpo = [
    h1(t.verificarTitulo),
    p(escapar(t.hola(datos.nombre))),
    p(escapar(t.verificarCuerpo)),
    boton(t.verificarBoton, datos.url, marca.colorPrimario),
    enlaceAlternativo(datos.url),
    separador(),
    p(
      `<span style="color:#9ca3af;font-size:13px">${escapar(t.verificarCaduca)} ${escapar(t.verificarNoPedido)}</span>`,
    ),
  ].join('');

  return {
    asunto: t.verificarAsunto,
    html: envolver(marca, cuerpo, t.pieCuenta),
    texto: `${t.hola(datos.nombre)}\n\n${t.verificarCuerpo}\n\n${datos.url}\n\n${t.verificarCaduca}\n${t.verificarNoPedido}`,
  };
}

/**
 * Confirmación del alta en la newsletter (doble opt-in).
 *
 * Es el correo que convierte una dirección escrita en un formulario en una
 * suscripción demostrable. Dice explícitamente que si no ha sido esa persona
 * no tiene que hacer nada: quien recibe esto sin haberlo pedido tiene que
 * poder ignorarlo con tranquilidad, no buscar un enlace para darse de baja de
 * algo a lo que nunca se apuntó.
 */
/**
 * Aviso del cupón ganado por un referido.
 *
 * Sin este correo el programa no existe: los cupones se emiten en la base de
 * datos y nadie se entera. El código va en grande y las condiciones debajo —el
 * mínimo y la caducidad— porque descubrirlas al ir a pagar es la forma más
 * segura de que el descuento acabe en una reclamación.
 */
export function premioReferido(
  marca: Marca,
  datos: {
    locale: Locale;
    /** true para quien recomienda; false para quien llega recomendado. */
    esReferidor: boolean;
    codigo: string;
    importeCents: number;
    minimoCents: number;
    dias: number;
    url: string;
  },
): ContenidoEmail {
  const t = textos(datos.locale);

  const asunto = datos.esReferidor ? t.referidoAsunto : t.referidoBienvenidaAsunto;
  const titulo = datos.esReferidor ? t.referidoTitulo : t.referidoBienvenidaTitulo;
  const cuerpoTexto = datos.esReferidor ? t.referidoCuerpo : t.referidoBienvenidaCuerpo;
  const condiciones = t.referidoCondiciones(
    precio(datos.importeCents, datos.locale),
    precio(datos.minimoCents, datos.locale),
    datos.dias,
  );

  const cuerpo = [
    h1(titulo),
    p(escapar(cuerpoTexto)),
    `<p style="margin:24px 0;text-align:center;font:700 28px/1.2 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;letter-spacing:3px;color:${escapar(marca.colorPrimario)}">${escapar(datos.codigo)}</p>`,
    p(`<span style="color:#6b7280;font-size:14px">${escapar(condiciones)}</span>`),
    boton(t.referidoBoton, datos.url, marca.colorPrimario),
  ].join('');

  return {
    asunto,
    html: envolver(marca, cuerpo, t.pieReferido),
    texto: `${cuerpoTexto}\n\n${datos.codigo}\n\n${condiciones}\n\n${datos.url}`,
  };
}

export function confirmarNewsletter(
  marca: Marca,
  datos: { url: string; locale: Locale; horas: number },
): ContenidoEmail {
  const t = textos(datos.locale);

  const cuerpo = [
    h1(t.newsletterTitulo),
    p(escapar(t.newsletterCuerpo)),
    boton(t.newsletterBoton, datos.url, marca.colorPrimario),
    enlaceAlternativo(datos.url),
    separador(),
    p(
      `<span style="color:#9ca3af;font-size:13px">${escapar(t.newsletterCaduca(datos.horas))} ${escapar(t.newsletterNoPedido)}</span>`,
    ),
  ].join('');

  return {
    asunto: t.newsletterAsunto,
    html: envolver(marca, cuerpo, t.pieCuenta),
    texto: `${t.newsletterCuerpo}\n\n${datos.url}\n\n${t.newsletterCaduca(datos.horas)}\n${t.newsletterNoPedido}`,
  };
}

export function restablecerPassword(
  marca: Marca,
  datos: { nombre: string; url: string; locale: Locale },
): ContenidoEmail {
  const t = textos(datos.locale);

  const cuerpo = [
    h1(t.resetTitulo),
    p(escapar(t.hola(datos.nombre))),
    p(escapar(t.resetCuerpo)),
    boton(t.resetBoton, datos.url, marca.colorPrimario),
    enlaceAlternativo(datos.url),
    separador(),
    p(
      `<span style="color:#9ca3af;font-size:13px">${escapar(t.resetCaduca)} ${escapar(t.resetNoPedido)}</span>`,
    ),
  ].join('');

  return {
    asunto: t.resetAsunto,
    html: envolver(marca, cuerpo, t.pieCuenta),
    texto: `${t.hola(datos.nombre)}\n\n${t.resetCuerpo}\n\n${datos.url}\n\n${t.resetCaduca}\n${t.resetNoPedido}`,
  };
}

export function confirmacionPedido(
  marca: Marca,
  datos: {
    nombre: string;
    numero: string;
    lineas: { nombre: string; cantidad: number; totalCents: number }[];
    totalCents: number;
    direccion: string;
    url: string;
    locale: Locale;
  },
): ContenidoEmail {
  const t = textos(datos.locale);

  const filas = datos.lineas
    .map(
      (l) => `<tr>
        <td style="padding:8px 0;font:400 14px/1.5 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#374151;border-bottom:1px solid #f3f4f6">
          ${escapar(l.nombre)}<br><span style="color:#9ca3af;font-size:13px">×${String(l.cantidad)}</span>
        </td>
        <td align="right" style="padding:8px 0;font:400 14px -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#374151;border-bottom:1px solid #f3f4f6;white-space:nowrap">
          ${precio(l.totalCents, datos.locale)}
        </td>
      </tr>`,
    )
    .join('');

  const cuerpo = [
    h1(t.pedidoTitulo),
    p(escapar(t.hola(datos.nombre))),
    p(escapar(t.pedidoCuerpo)),
    p(`<strong>${escapar(datos.numero)}</strong>`),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0">
      ${filas}
      <tr>
        <td style="padding:12px 0 0;font:600 16px -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#111827">${escapar(t.pedidoTotal)}</td>
        <td align="right" style="padding:12px 0 0;font:600 16px -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#111827">${precio(datos.totalCents, datos.locale)}</td>
      </tr>
    </table>`,
    separador(),
    p(
      `<strong>${escapar(t.pedidoEnvio)}</strong><br><span style="color:#6b7280">${escapar(datos.direccion)}</span>`,
    ),
    // El plazo real se dice claro y pronto: es la primera causa de reclamación
    // en dropshipping, y avisarlo evita la mitad de los tickets de soporte.
    p(`<span style="color:#6b7280;font-size:14px">${escapar(t.pedidoPlazo)}</span>`),
    boton(t.pedidoBoton, datos.url, marca.colorPrimario),
  ].join('');

  const texto = [
    t.hola(datos.nombre),
    '',
    t.pedidoCuerpo,
    datos.numero,
    '',
    ...datos.lineas.map(
      (l) => `  ${String(l.cantidad)}x ${l.nombre} — ${precio(l.totalCents, datos.locale)}`,
    ),
    '',
    `${t.pedidoTotal}: ${precio(datos.totalCents, datos.locale)}`,
    '',
    `${t.pedidoEnvio}: ${datos.direccion}`,
    '',
    t.pedidoPlazo,
    '',
    datos.url,
  ].join('\n');

  return {
    asunto: t.pedidoAsunto(datos.numero),
    html: envolver(marca, cuerpo, t.piePedido),
    texto,
  };
}

export function pedidoEnviado(
  marca: Marca,
  datos: {
    nombre: string;
    numero: string;
    transportista: string;
    seguimiento: string;
    urlSeguimiento: string;
    locale: Locale;
  },
): ContenidoEmail {
  const t = textos(datos.locale);

  const cuerpo = [
    h1(t.envioTitulo),
    p(escapar(t.hola(datos.nombre))),
    p(escapar(t.envioCuerpo)),
    p(
      `<strong style="font-family:monospace;font-size:16px">${escapar(datos.seguimiento)}</strong><br>` +
        `<span style="color:#9ca3af;font-size:13px">${escapar(datos.transportista)}</span>`,
    ),
    boton(t.envioBoton, datos.urlSeguimiento, marca.colorPrimario),
  ].join('');

  return {
    asunto: t.envioAsunto(datos.numero),
    html: envolver(marca, cuerpo, t.piePedido),
    texto: `${t.hola(datos.nombre)}\n\n${t.envioCuerpo}\n\n${datos.seguimiento} (${datos.transportista})\n\n${datos.urlSeguimiento}`,
  };
}

export function pedidoEntregado(
  marca: Marca,
  datos: { nombre: string; numero: string; url: string; locale: Locale },
): ContenidoEmail {
  const t = textos(datos.locale);

  const cuerpo = [
    h1(t.entregadoTitulo),
    p(escapar(t.hola(datos.nombre))),
    p(escapar(t.entregadoCuerpo)),
    separador(),
    p(escapar(t.entregadoResena)),
    boton(t.entregadoBoton, datos.url, marca.colorPrimario),
  ].join('');

  return {
    asunto: t.entregadoAsunto(datos.numero),
    html: envolver(marca, cuerpo, t.piePedido),
    texto: `${t.hola(datos.nombre)}\n\n${t.entregadoCuerpo}\n\n${t.entregadoResena}\n${datos.url}`,
  };
}

/**
 * Petición de valoración, unos días después de la entrega.
 *
 * Cada producto va con su enlace directo a su ficha. Es la diferencia entre
 * que valoren y que no: mandando a «mi cuenta» hay que acordarse de qué se
 * compró, buscarlo y encontrar dónde se valora, y ahí se cae casi todo el
 * mundo. Con dos productos son dos botones y se acabó.
 */
export function pedirValoracion(
  marca: Marca,
  datos: {
    nombre: string;
    numero: string;
    locale: Locale;
    productos: { nombre: string; url: string }[];
  },
): ContenidoEmail {
  const t = textos(datos.locale);

  const cuerpo = [
    h1(t.valoracionTitulo),
    p(escapar(t.hola(datos.nombre))),
    p(escapar(t.valoracionCuerpo)),
    separador(),
    // Un botón por producto. Se limita a tres: un correo con ocho botones deja
    // de leerse como una petición y pasa a leerse como publicidad.
    ...datos.productos
      .slice(0, 3)
      .flatMap((producto) => [
        p(`<strong>${escapar(producto.nombre)}</strong>`),
        boton(t.valoracionBoton, producto.url, marca.colorPrimario),
      ]),
    separador(),
    p(`<span style="color:#9ca3af;font-size:13px">${escapar(t.valoracionPie)}</span>`),
  ].join('');

  return {
    asunto: t.valoracionAsunto(datos.numero),
    html: envolver(marca, cuerpo, t.piePedido),
    texto: [
      t.hola(datos.nombre),
      '',
      t.valoracionCuerpo,
      '',
      ...datos.productos.slice(0, 3).map((x) => `${x.nombre}: ${x.url}`),
    ].join('\n'),
  };
}

export function invitacionEquipo(
  marca: Marca,
  datos: { url: string; locale: Locale },
): ContenidoEmail {
  const t = textos(datos.locale);

  const cuerpo = [
    h1(t.invitacionTitulo),
    p(escapar(t.invitacionCuerpo)),
    boton(t.invitacionBoton, datos.url, marca.colorPrimario),
    enlaceAlternativo(datos.url),
    separador(),
    p(`<span style="color:#9ca3af;font-size:13px">${escapar(t.invitacionCaduca)}</span>`),
  ].join('');

  return {
    asunto: t.invitacionAsunto(marca.nombre),
    html: envolver(marca, cuerpo, t.pieCuenta),
    texto: `${t.invitacionCuerpo}\n\n${datos.url}\n\n${t.invitacionCaduca}`,
  };
}

/** Aviso interno al equipo: no lleva marca ni florituras, va al grano. */
export function avisoIncidencia(
  marca: Marca,
  datos: { numero: string; motivo: string; url: string },
): ContenidoEmail {
  const t = textos('es');

  const cuerpo = [
    h1(t.incidenciaTitulo),
    p(`<strong>${escapar(datos.numero)}</strong>`),
    p(escapar(datos.motivo)),
    boton(t.incidenciaBoton, datos.url, marca.colorPrimario),
  ].join('');

  return {
    asunto: t.incidenciaAsunto(datos.numero),
    html: envolver(marca, cuerpo),
    texto: `${datos.numero}\n\n${datos.motivo}\n\n${datos.url}`,
  };
}

/**
 * Recordatorio de carrito abandonado.
 *
 * Enseña lo que el cliente eligió, no un "vuelve a la tienda" genérico: el
 * correo tiene que recordarle qué se dejó, que es lo que le hace volver.
 *
 * El enlace de baja va siempre, aunque sea un correo transaccional a caballo
 * entre el servicio y el marketing: sin él, el que no lo quiere solo tiene el
 * botón de spam, y eso arrastra también a los correos de pedido.
 */
export function carritoAbandonado(
  marca: Marca,
  datos: {
    nombre: string;
    lineas: { nombre: string; cantidad: number; totalCents: number }[];
    totalCents: number;
    url: string;
    urlBaja: string;
    cupon?: { codigo: string; descripcion: string };
    locale: Locale;
  },
): ContenidoEmail {
  const t = textos(datos.locale);

  const filas = datos.lineas
    .map(
      (l) => `<tr>
        <td style="padding:8px 0;font:400 14px/1.5 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#374151;border-bottom:1px solid #f3f4f6">
          ${escapar(l.nombre)}<br><span style="color:#9ca3af;font-size:13px">×${String(l.cantidad)}</span>
        </td>
        <td align="right" style="padding:8px 0;font:400 14px -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#374151;border-bottom:1px solid #f3f4f6;white-space:nowrap">
          ${precio(l.totalCents, datos.locale)}
        </td>
      </tr>`,
    )
    .join('');

  const cuerpo = [
    h1(t.carritoTitulo),
    p(escapar(t.hola(datos.nombre))),
    p(escapar(t.carritoCuerpo)),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0">
      ${filas}
      <tr>
        <td style="padding:12px 0 0;font:600 16px -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#111827">${escapar(t.pedidoTotal)}</td>
        <td align="right" style="padding:12px 0 0;font:600 16px -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#111827">${precio(datos.totalCents, datos.locale)}</td>
      </tr>
    </table>`,
    datos.cupon
      ? p(
          `<strong>${escapar(t.carritoCupon(datos.cupon.codigo, datos.cupon.descripcion))}</strong>`,
        )
      : '',
    // Decirlo evita la reclamación de "lo tenía guardado y ha subido": en
    // dropshipping el precio y el stock los mueve el proveedor, no nosotros.
    p(`<span style="color:#6b7280;font-size:14px">${escapar(t.carritoStock)}</span>`),
    boton(t.carritoBoton, datos.url, marca.colorPrimario),
    separador(),
    `<p style="margin:0;font:400 13px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#9ca3af">
      ${escapar(t.carritoBaja)}<br><a href="${escapar(datos.urlBaja)}" style="color:#9ca3af">${escapar(datos.urlBaja)}</a>
    </p>`,
  ].join('');

  const texto = [
    t.hola(datos.nombre),
    '',
    t.carritoCuerpo,
    '',
    ...datos.lineas.map(
      (l) => `  ${String(l.cantidad)}x ${l.nombre} — ${precio(l.totalCents, datos.locale)}`,
    ),
    '',
    `${t.pedidoTotal}: ${precio(datos.totalCents, datos.locale)}`,
    ...(datos.cupon ? ['', t.carritoCupon(datos.cupon.codigo, datos.cupon.descripcion)] : []),
    '',
    datos.url,
    '',
    `${t.carritoBaja} ${datos.urlBaja}`,
  ].join('\n');

  return {
    asunto: datos.cupon ? t.carritoAsuntoCupon(datos.cupon.descripcion) : t.carritoAsunto,
    html: envolver(marca, cuerpo, t.pieCarrito),
    texto,
  };
}

/**
 * El pago se quedó a medias y caducó.
 *
 * Es el correo que más ventas rescata en una tienda que cobra en cripto: la
 * ventana de pago dura minutos porque el cambio está bloqueado, y quien se
 * distrae se queda con un pedido pendiente sin entender qué pasó. Decir
 * explícitamente que **no se le ha cobrado nada** evita la mitad de los
 * tickets de soporte.
 */
export function pagoCaducado(
  marca: Marca,
  datos: { nombre: string; numero: string; url: string; esCripto: boolean; locale: Locale },
): ContenidoEmail {
  const t = textos(datos.locale);

  const cuerpo = [
    h1(t.pagoCaducadoTitulo),
    p(escapar(t.hola(datos.nombre))),
    p(`<strong>${escapar(datos.numero)}</strong>`),
    p(escapar(t.pagoCaducadoCuerpo)),
    datos.esCripto
      ? p(`<span style="color:#6b7280;font-size:14px">${escapar(t.pagoCaducadoCripto)}</span>`)
      : '',
    boton(t.pagoCaducadoBoton, datos.url, marca.colorPrimario),
    enlaceAlternativo(datos.url),
  ].join('');

  return {
    asunto: t.pagoCaducadoAsunto(datos.numero),
    html: envolver(marca, cuerpo, t.piePedido),
    texto: [
      t.hola(datos.nombre),
      '',
      datos.numero,
      '',
      t.pagoCaducadoCuerpo,
      ...(datos.esCripto ? ['', t.pagoCaducadoCripto] : []),
      '',
      datos.url,
    ].join('\n'),
  };
}
