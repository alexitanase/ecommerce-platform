'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { useCarrito } from '@/lib/carrito';
import { useSesion } from '@/lib/sesion';
import { api, ErrorApi } from '@/lib/api';
import { comprar, empezarCheckout } from '@/lib/analitica';
import { DIVISA_BASE } from '@ecom/shared';
import { precio } from '@/lib/formato';
import { useDivisa, usePrecio } from '@/components/proveedor-divisa';
import { leerReferido, olvidarReferido } from '@/lib/referido';
import { visitante } from '@/lib/experimentos';
import { leerCanal } from '@/lib/canal';
import { CARRIL, Pagina, TituloPagina } from '@/components/ui/pagina';
import { Cargando, Vacio } from '@/components/ui/estados';
import { useEsCliente } from '@/lib/use-es-cliente';

interface Direccion {
  firstName: string;
  lastName: string;
  company?: string;
  taxId?: string;
  line1: string;
  line2?: string;
  city: string;
  province: string;
  postalCode: string;
  countryCode: string;
  phone?: string;
}

/**
 * Lo que la API dice del IVA de este carrito para este destino.
 *
 * Importa sobre todo por `avisos`: si la mercancía viene de fuera de la UE y no
 * cabe en el IOSS, el cliente pagará el IVA de importación y los aranceles al
 * recibir el paquete. Enterarse después de pagar es la razón por la que muchos
 * paquetes se rechazan en la entrega, y callarlo antes es una omisión engañosa.
 */
interface PrevisualizacionIva {
  regimen: string;
  ivaCents: number;
  avisos: string[];
}

/** Una dirección de la cuenta, tal y como la devuelve la API. */
interface DireccionGuardada extends Direccion {
  id: string;
  type: 'SHIPPING' | 'BILLING';
  isDefault: boolean;
}

/**
 * Una forma de enviar el pedido a este destino, con su precio ya calculado.
 *
 * El importe lo pone el servidor a partir del catálogo —precios y pesos— y no
 * a partir de lo que sabe el navegador: es la única manera de que el porte que
 * se enseña aquí sea el mismo que acaba en la factura.
 */
interface OpcionEnvio {
  rateId: string;
  nombre: string;
  transportista: string | null;
  precioCents: number;
  gratis: boolean;
  minDias: number;
  maxDias: number;
}

interface PedidoCreado {
  id: string;
  number: string;
  totalCents: number;
}

const DIRECCION_VACIA: Direccion = {
  firstName: '',
  lastName: '',
  line1: '',
  city: '',
  province: '',
  postalCode: '',
  countryCode: 'ES',
};

/**
 * ¿Es la misma dirección?
 *
 * Se comparan los campos que la identifican de verdad —calle, número, ciudad y
 * país— sin espacios ni mayúsculas. El nombre y el teléfono se dejan fuera a
 * propósito: «Ana» y «Ana María» en la misma casa no son dos direcciones, y
 * guardarlas por separado llena la cuenta de duplicados que hay que borrar a
 * mano.
 */
function esLaMisma(a: Direccion, b: Direccion): boolean {
  const limpio = (v: string | undefined) => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

  return (
    limpio(a.line1) === limpio(b.line1) &&
    limpio(a.line2) === limpio(b.line2) &&
    limpio(a.postalCode) === limpio(b.postalCode) &&
    limpio(a.city) === limpio(b.city) &&
    limpio(a.countryCode) === limpio(b.countryCode)
  );
}

/**
 * Checkout en un solo paso.
 *
 * Los errores se muestran por campo, no como un mensaje genérico arriba: la
 * API los devuelve así y es la diferencia entre corregir a la primera o probar
 * a ciegas. El botón se bloquea mientras se procesa para que un doble clic no
 * cree dos pedidos.
 */
export function FormularioCheckout({ locale }: { locale: string }) {
  const t = useTranslations('checkout');
  /*
   * El checkout se queda en euros, y es deliberado: es el importe que va a la
   * pasarela y el que aparecerá en el extracto de la tarjeta. Lo que se añade es
   * la equivalencia en la divisa con la que el visitante ha estado mirando el
   * catálogo, para que el salto no parezca un cambio de precio.
   */
  const { actual: divisaVisitante } = useDivisa();
  const fmtDivisaVisitante = usePrecio(locale);
  const tc = useTranslations('comun');
  const tcar = useTranslations('carrito');
  const router = useRouter();
  const { lineas, cartId, subtotalCents, vaciar } = useCarrito();
  // El carrito vive en localStorage: hasta que el navegador no lo lee, vacío
  // y "todavía no lo sé" son indistinguibles.
  const montado = useEsCliente();

  /*
   * Quién está comprando.
   *
   * `recuperar()` hace falta AQUÍ y no sobra: el access token vive en memoria,
   * así que al abrir el checkout directamente —desde el carrito, desde un enlace,
   * tras recargar— no hay token todavía aunque la sesión exista. Sin esta
   * llamada, el pedido se creaba sin identificar a nadie y quedaba registrado
   * como de invitado: con el email correcto y sin aparecer en «mis pedidos».
   */
  const { usuario, token, recuperar } = useSesion();

  useEffect(() => {
    void recuperar();
  }, [recuperar]);

  /**
   * El email escrito a mano. Vacío mientras no se toque.
   *
   * El que se usa es `emailEfectivo`: se deriva de la cuenta en lugar de
   * copiarse al estado con un efecto. Copiándolo hay dos fuentes de verdad y una
   * carrera —la sesión llega tarde y pisa lo que se estaba escribiendo—; así el
   * campo enseña el de la cuenta desde el primer render y sigue siendo editable.
   */
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [envio, setEnvio] = useState<Direccion>(DIRECCION_VACIA);
  const [mismaDireccion, setMisma] = useState(true);
  const [facturacion, setFacturacion] = useState<Direccion>(DIRECCION_VACIA);
  const [nota, setNota] = useState('');
  const [acepta, setAcepta] = useState(false);
  /** Publicidad: siempre desmarcado. Preseleccionarlo no es consentimiento. */
  const [quiereOfertas, setQuiereOfertas] = useState(false);

  /** Las que ya tiene la cuenta: para rellenar y para no duplicarlas después. */
  const [guardadas, setGuardadas] = useState<DireccionGuardada[]>([]);

  const [enviando, setEnviando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string[]>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  /** Última respuesta recibida, junto con la consulta que la produjo. */
  const [fiscal, setFiscal] = useState<{ consulta: string; datos: PrevisualizacionIva } | null>(
    null,
  );

  /**
   * Las opciones de envío del destino, o el motivo por el que no hay ninguna.
   *
   * Van juntas con la consulta que las produjo, igual que los datos fiscales: un
   * porte calculado para otro código postal es peor que no enseñar ninguno.
   */
  const [envios, setEnvios] = useState<{
    consulta: string;
    opciones: OpcionEnvio[];
    error: string | null;
  } | null>(null);

  /** La tarifa elegida. El servidor vuelve a calcular su precio al cobrar. */
  const [tarifa, setTarifa] = useState<string | null>(null);

  const emailEfectivo = email || usuario?.email || '';

  const subtotal = subtotalCents();

  // Las líneas cambian de identidad en cada render del carrito; esta cadena no.
  // Sin ella el efecto se relanzaría solo, sin parar.
  const claveLineas = lineas.map((l) => `${l.variantId}:${String(l.cantidad)}`).join(',');
  const pais = envio.countryCode.trim().toUpperCase();
  const codigoPostal = envio.postalCode.trim();
  const consulta = `${pais}|${codigoPostal}|${claveLineas}`;

  const destinoCompleto = pais.length === 2 && codigoPostal.length >= 3 && claveLineas !== '';

  // Solo se enseña la respuesta de la consulta actual. Si el cliente cambia de
  // país, el aviso anterior deja de pintarse en el mismo render en que cambia,
  // sin esperar a que llegue el nuevo: enseñar "sin IVA, pagas en aduana" con
  // una dirección que ya no es esa sería peor que no enseñar nada.
  const datosFiscales = fiscal?.consulta === consulta ? fiscal.datos : null;

  // Lo mismo con el envío: al cambiar de destino, el porte anterior desaparece
  // en el acto en vez de quedarse a la vista mientras llega el nuevo.
  const enviosActuales = envios?.consulta === consulta ? envios : null;
  const opcionesEnvio = enviosActuales?.opciones ?? [];

  /*
   * El porte que se suma al total.
   *
   * Mientras no haya destino no se inventa nada: el total enseña solo la
   * mercancía y debajo se dice que el envío se calcula al escribir el código
   * postal. Poner cero ahí sería anunciar un envío gratis que no existe, y
   * subirle el precio al cliente en el paso siguiente es donde se pierden las
   * compras.
   */
  const opcionElegida = opcionesEnvio.find((o) => o.rateId === tarifa) ?? opcionesEnvio[0] ?? null;
  const envioCents = opcionElegida?.precioCents ?? null;
  const total = subtotal + (envioCents ?? 0);

  /**
   * Lo que ya se sabe de quien está comprando, sin volver a preguntarlo.
   *
   * Con sesión abierta, el checkout pedía el email otra vez —el que ya está en la
   * cuenta— y la dirección desde cero aunque la tuviera guardada. Se rellena una
   * sola vez: si después se corrige algo a mano, no se vuelve a pisar.
   *
   * La dirección se pide aparte y no viene con el usuario porque son datos que
   * solo hacen falta aquí: cargarlas en cada página para nada sería una consulta
   * de más en toda la tienda.
   */
  /*
   * Se rellena una sola vez, y con una referencia y no con estado: el guardia
   * tiene que valer ya en la misma vuelta del efecto, y un `useState` no cambia
   * hasta el render siguiente —así que la petición saldría dos veces—.
   */
  const yaRellenado = useRef(false);

  useEffect(() => {
    if (yaRellenado.current || !usuario || !token) return;
    yaRellenado.current = true;

    const nombreDeLaCuenta = (actual: Direccion): Direccion =>
      actual.firstName === ''
        ? { ...actual, firstName: usuario.firstName ?? '', lastName: usuario.lastName ?? '' }
        : actual;

    api<DireccionGuardada[]>('/addresses', { token })
      .then((direcciones) => {
        setGuardadas(direcciones);

        // La predeterminada; si no hay ninguna marcada, la primera de envío.
        const preferida =
          direcciones.find((d) => d.isDefault && d.type === 'SHIPPING') ??
          direcciones.find((d) => d.type === 'SHIPPING') ??
          direcciones[0];

        if (!preferida) {
          setEnvio(nombreDeLaCuenta);
          return;
        }

        setEnvio((actual) => {
          // Solo si no se ha escrito nada: pisar lo que el cliente acaba de
          // teclear porque una respuesta llega tarde es peor que no rellenar.
          if (actual.line1 !== '' || actual.firstName !== '') return actual;

          return {
            firstName: preferida.firstName,
            lastName: preferida.lastName,
            ...(preferida.company ? { company: preferida.company } : {}),
            ...(preferida.taxId ? { taxId: preferida.taxId } : {}),
            line1: preferida.line1,
            ...(preferida.line2 ? { line2: preferida.line2 } : {}),
            city: preferida.city,
            province: preferida.province,
            postalCode: preferida.postalCode,
            countryCode: preferida.countryCode,
            ...(preferida.phone ? { phone: preferida.phone } : {}),
          };
        });

        if (preferida.phone) {
          const suyo = preferida.phone;
          setTelefono((actual) => actual || suyo);
        }
      })
      .catch(() => {
        // Sin direcciones guardadas —o si la petición falla— se sigue con el
        // formulario a medio rellenar: no puede impedir comprar.
        setEnvio(nombreDeLaCuenta);
      });
  }, [usuario, token]);

  /**
   * Copia del carrito en el servidor, para poder recuperarlo si se abandona.
   *
   * Se manda en cuanto hay un email con pinta de válido: es el momento en que
   * el cliente pasa de "mirando" a "comprando", y también el punto donde más
   * gente se cae. Sin esta copia, un carrito abandonado en el checkout no deja
   * ni rastro y no hay a quién escribirle.
   */
  useEffect(() => {
    if (!emailEfectivo.includes('@') || claveLineas === '') return;

    const espera = setTimeout(() => {
      const lineasCopia = claveLineas.split(',').map((parte) => {
        const [variantId = '', cantidad = '1'] = parte.split(':');
        return { variantId, cantidad: Number(cantidad) };
      });

      void api('/cart/sync', {
        method: 'POST',
        body: JSON.stringify({ email: emailEfectivo, locale, lineas: lineasCopia }),
      })
        // Que falle la copia no puede impedir comprar: es una red de seguridad
        // para si el cliente se va, no parte del checkout.
        .catch(() => undefined);
    }, 1500);

    return () => {
      clearTimeout(espera);
    };
  }, [emailEfectivo, claveLineas, locale]);

  useEffect(() => {
    if (!destinoCompleto) return;

    // Con retardo: el código postal se teclea dígito a dígito y sin esperar se
    // lanzarían cinco peticiones para acabar usando la última.
    const espera = setTimeout(() => {
      const lineasConsulta = claveLineas.split(',').map((parte) => {
        const [variantId = '', cantidad = '1'] = parte.split(':');
        return { variantId, quantity: Number(cantidad) };
      });

      void api<PrevisualizacionIva>('/orders/tax-preview', {
        method: 'POST',
        body: JSON.stringify({
          countryCode: pais,
          postalCode: codigoPostal,
          lineas: lineasConsulta,
        }),
      })
        .then((datos) => {
          setFiscal({ consulta, datos });
        })
        // Que falle el aviso no puede impedir comprar: el importe bueno lo
        // calcula el servidor al crear el pedido, esto solo lo anticipa.
        .catch(() => undefined);

      /*
       * El porte, en la misma vuelta.
       *
       * Se mandan las líneas y no un subtotal: el precio y el peso los pone el
       * catálogo, que es con lo que se va a cobrar. Aquí un error SÍ se enseña,
       * al revés que el aviso fiscal: «no hacemos envíos a esa dirección» es
       * justo lo que hay que saber antes de rellenar el resto del formulario, y
       * callarlo lleva a que el pedido reviente al pulsar «pagar».
       */
      void api<{ opciones: OpcionEnvio[] }>('/shipping/quote', {
        method: 'POST',
        body: JSON.stringify({
          countryCode: pais,
          postalCode: codigoPostal,
          lineas: lineasConsulta,
        }),
      })
        .then(({ opciones }) => {
          setEnvios({ consulta, opciones, error: null });
          setTarifa((actual) =>
            // La elegida se respeta si sigue estando; si no, la primera, que es
            // la más barata. Sin esto, corregir el código postal deshace en
            // silencio la opción que el cliente acababa de marcar.
            actual && opciones.some((o) => o.rateId === actual)
              ? actual
              : (opciones[0]?.rateId ?? null),
          );
        })
        .catch((error: unknown) => {
          setEnvios({
            consulta,
            opciones: [],
            error: error instanceof ErrorApi ? error.message : tc('error'),
          });
          setTarifa(null);
        });
    }, 400);

    return () => {
      clearTimeout(espera);
    };
  }, [consulta, destinoCompleto, pais, codigoPostal, claveLineas, tc]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrores({});
    setErrorGeneral(null);

    if (!acepta) {
      setErrores({ acepta: [t('acepto_requerido')] });
      return;
    }

    setEnviando(true);

    // Antes de crear el pedido: mide la INTENCIÓN. La diferencia entre este
    // evento y el de compra es el abandono de carrito, que suele ser el mayor
    // agujero del embudo de cualquier tienda.
    empezarCheckout(
      lineas.map((l) => ({
        id: l.variantId,
        nombre: l.nombre,
        precioCents: l.precioCents,
        cantidad: l.cantidad,
      })),
      subtotal,
    );

    const referido = leerReferido();
    const idVisitante = visitante();
    const canal = leerCanal();

    try {
      const pedido = await api<PedidoCreado>('/orders', {
        method: 'POST',
        // El token es lo que ata el pedido a la cuenta. La ruta es pública —hay
        // que poder comprar sin registrarse— así que sin él la API no tiene
        // forma de saber quién compra, y el pedido nace huérfano.
        ...(token ? { token } : {}),
        body: JSON.stringify({
          email: emailEfectivo,
          phone: telefono,
          locale,
          cartId,
          lineas: lineas.map((l) => ({ variantId: l.variantId, quantity: l.cantidad })),
          // El teléfono viaja también dentro de la dirección: es lo que se
          // manda al proveedor y lo que lee el transportista para avisar.
          shippingAddress: { ...envio, phone: telefono },
          // La tarifa elegida, no su precio: el servidor lo vuelve a calcular
          // con el catálogo. Sin esto se cobraba siempre la más barata, y el
          // cliente que elegía la urgente recibía —y pagaba— la normal.
          ...(tarifa ? { shippingRateId: tarifa } : {}),
          ...(mismaDireccion ? {} : { billingAddress: facturacion }),
          ...(nota ? { customerNote: nota } : {}),
          marketingConsent: quiereOfertas,
          // No descuenta nada en este pedido: deja la invitación anotada y los
          // cupones se emiten al cobrar. Un código caducado o inventado no
          // impide comprar.
          ...(referido ? { referralCode: referido } : {}),
          // Solo para atribuir la venta a la variante de la prueba A/B que se
          // vio. No identifica a nadie.
          ...(idVisitante ? { visitorId: idVisitante } : {}),
          // De dónde vino. El servidor lo vuelve a limpiar; aquí solo se
          // reenvía lo que se guardó al llegar.
          ...(canal
            ? {
                utmSource: canal.fuente,
                ...(canal.medio ? { utmMedium: canal.medio } : {}),
                ...(canal.campana ? { utmCampaign: canal.campana } : {}),
                ...(canal.contenido ? { utmContent: canal.contenido } : {}),
              }
            : {}),
        }),
      });

      // Se olvida en cuanto se ha usado: dejarlo puesto haría que el siguiente
      // pedido de la misma persona intentara premiar otra vez lo mismo.
      if (referido) olvidarReferido();

      // La compra se mide aquí y no en la página de pago: allí se llega
      // también al recargar o al volver desde el correo, y el pedido se
      // contaría varias veces. Aun así viaja el número como identificador de
      // transacción, para que las plataformas puedan deduplicar por su cuenta.
      comprar(
        pedido.number,
        lineas.map((l) => ({
          id: l.variantId,
          nombre: l.nombre,
          precioCents: l.precioCents,
          cantidad: l.cantidad,
        })),
        { totalCents: subtotal },
      );

      /*
       * La dirección se guarda en la cuenta si es nueva.
       *
       * Quien compra con sesión y escribe una dirección se quedaba sin ella en
       * «mis direcciones», y en el pedido siguiente la volvía a teclear entera.
       *
       * Se compara con las que ya tiene para no acumular la misma cinco veces:
       * el checkout se usa muchas más veces que la pantalla de direcciones, y
       * una lista con la misma dirección repetida es peor que no guardarla.
       *
       * Va con el error tragado y sin esperar a la respuesta: es una comodidad,
       * y no puede retrasar —ni mucho menos impedir— llegar al pago de un pedido
       * que ya está creado.
       */
      if (token && !guardadas.some((d) => esLaMisma(d, envio))) {
        void api('/addresses', {
          method: 'POST',
          token,
          body: JSON.stringify({
            type: 'SHIPPING',
            ...envio,
            // Con el teléfono dentro: es obligatorio para la entrega, así que
            // guardarlo sin él obligaría a escribirlo otra vez en cada compra.
            phone: telefono,
            // La primera se marca como predeterminada: si no, la cuenta se
            // queda con una dirección que el checkout no volvería a proponer.
            isDefault: guardadas.length === 0,
          }),
        }).catch(() => null);
      }

      // El carrito se vacía solo cuando el pedido existe de verdad: si se
      // vaciara antes y fallara la creación, el cliente perdería la compra.
      vaciar();
      router.push(`/pedido/${pedido.number}/pago?id=${pedido.id}` as never);
    } catch (error) {
      if (error instanceof ErrorApi) {
        if (error.campos) setErrores(error.campos);
        else setErrorGeneral(error.message);
      } else {
        setErrorGeneral(tc('error'));
      }
      setEnviando(false);
    }
  };

  const campo = (
    nombre: string,
    etiqueta: string,
    valor: string,
    alCambiar: (v: string) => void,
    opciones: {
      requerido?: boolean;
      tipo?: string;
      autoComplete?: string;
      /** Por qué se pide. Solo para los campos donde la pregunta es legítima. */
      ayuda?: string;
    } = {},
  ) => {
    const erroresCampo = errores[nombre] ?? errores[`shippingAddress.${nombre}`];
    // El error manda sobre la ayuda: si el campo está mal, lo que hay que leer
    // es qué falla, no para qué se pedía.
    const descrito = erroresCampo
      ? `${nombre}-error`
      : opciones.ayuda
        ? `${nombre}-ayuda`
        : undefined;

    return (
      // El asterisco va FUERA de la etiqueta, no dentro con `aria-hidden`.
      // Dentro, el navegador lo mete igual en el nombre accesible del campo
      // —comprobado en Chrome— y un lector de pantalla dice "Email asterisco".
      // Que el campo es obligatorio ya lo anuncia el atributo `required`.
      <div className="block">
        <span className="mb-1 flex gap-1 text-sm font-medium">
          <label htmlFor={`campo-${nombre}`}>{etiqueta}</label>
          {opciones.requerido && <span aria-hidden="true">*</span>}
        </span>
        <input
          id={`campo-${nombre}`}
          type={opciones.tipo ?? 'text'}
          value={valor}
          onChange={(e) => alCambiar(e.target.value)}
          required={opciones.requerido}
          autoComplete={opciones.autoComplete}
          aria-invalid={erroresCampo ? true : undefined}
          aria-describedby={descrito}
          className="campo"
        />
        {erroresCampo ? (
          <span
            id={`${nombre}-error`}
            className="mt-1 block text-xs"
            style={{ color: 'var(--error)' }}
          >
            {erroresCampo.join('. ')}
          </span>
        ) : (
          opciones.ayuda && (
            <span id={`${nombre}-ayuda`} className="mt-1 block text-xs text-[var(--texto-tenue)]">
              {opciones.ayuda}
            </span>
          )
        )}
      </div>
    );
  };

  /*
   * Sin líneas hay dos situaciones distintas y no se pueden pintar igual.
   *
   * Antes de hidratar, el carrito vive en `localStorage` y el servidor no
   * sabe qué hay dentro: ahí toca esperar. Después de hidratar, un carrito
   * vacío es un carrito vacío, y hasta ahora se quedaba enseñando un
   * esqueleto para siempre — quien llegaba al checkout desde un enlace veía
   * una página cargando que no iba a cargar nunca.
   */
  if (lineas.length === 0) {
    return (
      <Pagina>
        <TituloPagina titulo={t('titulo')} />
        {montado ? (
          <Vacio icono="carrito" titulo={tcar('vacio')} descripcion={tcar('vacio_ayuda')}>
            <Link href="/buscar" className="btn btn-primario">
              {tcar('seguir_comprando')}
            </Link>
          </Vacio>
        ) : (
          <Cargando etiqueta={tc('cargando')} filas={2} />
        )}
      </Pagina>
    );
  }

  return (
    // El mismo carril que la cabecera. Estuvo un rato en 5xl "para reducir
    // distracciones" y el efecto real era otro: el título del checkout no
    // caía debajo del logo, y el paso más delicado de la compra parecía una
    // página de otra tienda.
    <form onSubmit={enviar} className={`mx-auto w-full ${CARRIL} px-4 py-10 sm:px-6`}>
      <TituloPagina titulo={t('titulo')} />

      {/* `min-w-0` en las dos columnas: sin él, el nombre del producto del
          resumen —que va en una línea, sin partir— fija el ancho mínimo de la
          pista del grid, la columna se queda en 446 px dentro de un móvil de
          412 y toda la página se desplaza en horizontal. En el checkout eso
          significa que el botón de pagar se sale de la pantalla. */}
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-8">
          <section className="card p-5">
            <h2 className="mb-4 font-semibold">{t('contacto')}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {campo('email', t('email'), emailEfectivo, setEmail, {
                requerido: true,
                tipo: 'email',
                autoComplete: 'email',
              })}
              {/* Obligatorio: el transportista avisa por SMS o llamando, y
                  varios proveedores devuelven el pedido sin él. */}
              {campo('phone', t('telefono'), telefono, setTelefono, {
                requerido: true,
                tipo: 'tel',
                autoComplete: 'tel',
                ayuda: t('telefono_ayuda'),
              })}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-4 font-semibold">{t('envio')}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {campo(
                'firstName',
                t('nombre'),
                envio.firstName,
                (v) => setEnvio({ ...envio, firstName: v }),
                { requerido: true, autoComplete: 'given-name' },
              )}
              {campo(
                'lastName',
                t('apellidos'),
                envio.lastName,
                (v) => setEnvio({ ...envio, lastName: v }),
                { requerido: true, autoComplete: 'family-name' },
              )}
            </div>

            <div className="mt-4 grid gap-4">
              {campo(
                'line1',
                t('direccion'),
                envio.line1,
                (v) => setEnvio({ ...envio, line1: v }),
                { requerido: true, autoComplete: 'address-line1' },
              )}
              {campo(
                'line2',
                t('direccion_2'),
                envio.line2 ?? '',
                (v) => setEnvio({ ...envio, line2: v }),
                { autoComplete: 'address-line2' },
              )}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {campo(
                'postalCode',
                t('codigo_postal'),
                envio.postalCode,
                (v) => setEnvio({ ...envio, postalCode: v }),
                { requerido: true, autoComplete: 'postal-code' },
              )}
              {campo('city', t('ciudad'), envio.city, (v) => setEnvio({ ...envio, city: v }), {
                requerido: true,
                autoComplete: 'address-level2',
              })}
              {campo(
                'province',
                t('provincia'),
                envio.province,
                (v) => setEnvio({ ...envio, province: v }),
                { requerido: true, autoComplete: 'address-level1' },
              )}
            </div>

            <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={mismaDireccion}
                onChange={(e) => setMisma(e.target.checked)}
              />
              <span>{t('misma_direccion')}</span>
            </label>
          </section>

          {/*
            El envío, con su precio, ANTES de pagar.

            El carrito prometía que el porte se calculaba «en el siguiente paso»
            y el siguiente paso no lo enseñaba: el primer sitio donde aparecía
            era la pantalla de la pasarela, con el importe ya distinto del que
            ponía el botón. Además de ser la sorpresa que más carritos tira, un
            precio final que solo se ve al pagar incumple el art. 60.2.c del
            TRLGDCU, que obliga a informar de los gastos de entrega antes de que
            el cliente quede vinculado.

            La sección se pinta siempre, también sin código postal: un hueco que
            aparece a mitad del formulario mueve el botón de pagar de sitio
            justo cuando se está a punto de pulsarlo.
          */}
          <section className="card p-5">
            <h2 className="mb-4 font-semibold">{t('envio_metodo')}</h2>

            {!destinoCompleto ? (
              <p className="text-sm text-[var(--texto-tenue)]">{t('envio_pendiente')}</p>
            ) : enviosActuales === null ? (
              <p className="text-sm text-[var(--texto-tenue)]">{t('envio_calculando')}</p>
            ) : enviosActuales.error ? (
              <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
                {enviosActuales.error}
              </p>
            ) : (
              <ul className="space-y-2">
                {opcionesEnvio.map((opcion) => (
                  <li key={opcion.rateId}>
                    {/* Radios de verdad, no botones: con varias tarifas es una
                        elección entre opciones excluyentes, y así se navega con
                        las flechas y lo anuncia el lector de pantalla. */}
                    <label
                      className="flex cursor-pointer items-center gap-3 rounded-[--radius-card] border p-3 text-sm"
                      style={{
                        borderColor:
                          opcion.rateId === opcionElegida?.rateId
                            ? 'var(--marca-primario)'
                            : 'var(--borde)',
                      }}
                    >
                      <input
                        type="radio"
                        name="envio-tarifa"
                        value={opcion.rateId}
                        checked={opcion.rateId === opcionElegida?.rateId}
                        onChange={() => setTarifa(opcion.rateId)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{opcion.nombre}</span>
                        <span className="block text-xs text-[var(--texto-tenue)]">
                          {opcion.transportista ? `${opcion.transportista} · ` : ''}
                          {t('envio_plazo', { min: opcion.minDias, max: opcion.maxDias })}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold">
                        {opcion.gratis ? t('envio_gratis') : precio(opcion.precioCents, locale)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!mismaDireccion && (
            <section className="card p-5">
              <h2 className="mb-4 font-semibold">{t('facturacion')}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {campo(
                  'bFirstName',
                  t('nombre'),
                  facturacion.firstName,
                  (v) => setFacturacion({ ...facturacion, firstName: v }),
                  { requerido: true },
                )}
                {campo(
                  'bLastName',
                  t('apellidos'),
                  facturacion.lastName,
                  (v) => setFacturacion({ ...facturacion, lastName: v }),
                  { requerido: true },
                )}
                {campo('company', t('empresa'), facturacion.company ?? '', (v) =>
                  setFacturacion({ ...facturacion, company: v }),
                )}
                {campo('taxId', t('nif'), facturacion.taxId ?? '', (v) =>
                  setFacturacion({ ...facturacion, taxId: v }),
                )}
              </div>
              <div className="mt-4 grid gap-4">
                {campo(
                  'bLine1',
                  t('direccion'),
                  facturacion.line1,
                  (v) => setFacturacion({ ...facturacion, line1: v }),
                  { requerido: true },
                )}
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {campo(
                  'bPostal',
                  t('codigo_postal'),
                  facturacion.postalCode,
                  (v) => setFacturacion({ ...facturacion, postalCode: v }),
                  { requerido: true },
                )}
                {campo(
                  'bCity',
                  t('ciudad'),
                  facturacion.city,
                  (v) => setFacturacion({ ...facturacion, city: v }),
                  { requerido: true },
                )}
                {campo(
                  'bProvince',
                  t('provincia'),
                  facturacion.province,
                  (v) => setFacturacion({ ...facturacion, province: v }),
                  { requerido: true },
                )}
              </div>
            </section>
          )}

          <section className="card p-5">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">{t('nota')}</span>
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={3}
                maxLength={500}
                className="campo resize-none"
              />
            </label>
          </section>
        </div>

        <aside className="card h-fit min-w-0 p-5 lg:sticky lg:top-24">
          <h2 className="mb-4 font-semibold">{t('resumen')}</h2>

          <ul className="mb-4 space-y-2 text-sm">
            {lineas.map((l) => (
              <li key={l.variantId} className="flex justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-[var(--texto-suave)]">
                  {l.cantidad}× {l.nombre}
                </span>
                <span>{precio(l.precioCents * l.cantidad, locale)}</span>
              </li>
            ))}
          </ul>

          {/* Subtotal y envío desglosados, y el total debajo. Un único «Total»
              con el importe de la mercancía era mentira en cuanto el porte no
              es cero: el cliente pulsaba «Pagar 39,99 €» y la pasarela le pedía
              44,94 €. */}
          <dl className="space-y-1 border-t border-[var(--borde)] pt-4 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--texto-suave)]">{t('subtotal')}</dt>
              <dd>{precio(subtotal, locale)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--texto-suave)]">{t('envio_coste')}</dt>
              <dd className={envioCents === null ? 'text-[var(--texto-tenue)]' : undefined}>
                {envioCents === null
                  ? t('envio_por_calcular')
                  : envioCents === 0
                    ? t('envio_gratis')
                    : precio(envioCents, locale)}
              </dd>
            </div>
          </dl>

          <div className="mt-3 flex justify-between border-t border-[var(--borde)] pt-3 text-lg font-semibold">
            <span>{t('total')}</span>
            <span>{precio(total, locale)}</span>
          </div>

          {divisaVisitante !== DIVISA_BASE && (
            <p className="mt-1 text-xs text-[var(--texto-tenue)]">
              {t('total_aproximado', { importe: fmtDivisaVisitante(total) })}
            </p>
          )}

          {datosFiscales && (
            <p className="mt-1 text-xs text-[var(--texto-tenue)]">
              {datosFiscales.ivaCents > 0
                ? `${t('iva_incluido')}: ${precio(datosFiscales.ivaCents, locale)}`
                : t('sin_iva')}
            </p>
          )}

          {/* El aviso de aduanas va junto al total y antes del botón, no en la
              letra pequeña: es lo que decide si el cliente quiere seguir. */}
          {datosFiscales && datosFiscales.avisos.length > 0 && (
            <div
              className="mt-4 rounded-lg px-3 py-2 text-xs"
              style={{
                background: 'color-mix(in srgb, var(--aviso) 12%, transparent)',
                color: 'var(--aviso)',
              }}
            >
              <p className="mb-1 font-semibold">{t('avisos_fiscales')}</p>
              {datosFiscales.avisos.map((aviso) => (
                <p key={aviso.slice(0, 24)}>{aviso}</p>
              ))}
            </div>
          )}

          <label className="mt-5 flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={acepta}
              onChange={(e) => setAcepta(e.target.checked)}
              className="mt-0.5"
              aria-invalid={errores['acepta'] ? true : undefined}
            />
            <span className="text-[var(--texto-suave)]">
              {t.rich('acepto', {
                terminos: (c) => (
                  <a href={`/${locale}/condiciones`} className="underline">
                    {c}
                  </a>
                ),
                privacidad: (c) => (
                  <a href={`/${locale}/privacidad`} className="underline">
                    {c}
                  </a>
                ),
              })}
            </span>
          </label>
          {/* Separado de las condiciones a propósito: el RGPD exige que el
              consentimiento de publicidad sea una decisión aparte, no algo que
              se acepta de paso al comprar. */}
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={quiereOfertas}
              onChange={(e) => setQuiereOfertas(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-[var(--texto-suave)]">{t('quiero_ofertas')}</span>
          </label>

          {errores['acepta'] && (
            <p className="mt-1 text-xs" style={{ color: 'var(--error)' }}>
              {errores['acepta'].join('. ')}
            </p>
          )}

          {errorGeneral && (
            <p
              role="alert"
              className="mt-4 rounded-lg px-3 py-2 text-sm"
              style={{
                background: 'color-mix(in srgb, var(--error) 10%, transparent)',
                color: 'var(--error)',
              }}
            >
              {errorGeneral}
            </p>
          )}

          <button type="submit" disabled={enviando} className="btn btn-primario mt-5 w-full">
            {/* El importe del botón es el TOTAL, porte incluido: es la última
                cifra que se lee antes de pulsar y tiene que ser la que se
                cobra. */}
            {enviando ? t('procesando') : t('pagar', { importe: precio(total, locale) })}
          </button>
        </aside>
      </div>
    </form>
  );
}
