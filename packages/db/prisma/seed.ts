import path from 'node:path';
import argon2 from 'argon2';
import { config as loadDotenv } from 'dotenv';
import { createId } from '@paralleldrive/cuid2';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const { createPrismaClient } = await import('../src/index.js');
const prisma = createPrismaClient();

/** En producción se siembra la referencia, nunca los usuarios de ejemplo. */
const esProduccion = process.env['NODE_ENV'] === 'production';

// ═══════════════════════════════════════════════════════════
//  Catálogo de permisos
//  Forma "recurso:acción". Añadir uno nuevo es añadir una línea
//  aquí y asignarlo al rol que corresponda más abajo.
// ═══════════════════════════════════════════════════════════

const PERMISOS: { key: string; description: string }[] = [
  // Catálogo
  { key: 'products:read', description: 'Ver productos' },
  { key: 'products:write', description: 'Crear y editar productos' },
  { key: 'products:delete', description: 'Eliminar productos' },
  { key: 'products:import', description: 'Importar productos del proveedor' },
  { key: 'categories:write', description: 'Gestionar categorías y colecciones' },
  { key: 'media:write', description: 'Subir y gestionar imágenes' },
  // Pedidos
  { key: 'orders:read', description: 'Ver pedidos' },
  { key: 'orders:write', description: 'Editar pedidos y notas internas' },
  { key: 'orders:fulfill', description: 'Enviar pedidos al proveedor' },
  { key: 'orders:cancel', description: 'Cancelar pedidos' },
  { key: 'orders:refund', description: 'Emitir reembolsos' },
  { key: 'orders:close', description: 'Cerrar pedidos entregados en el Kanban' },
  { key: 'returns:manage', description: 'Gestionar devoluciones y RMA' },
  // Clientes
  { key: 'customers:read', description: 'Ver clientes' },
  { key: 'customers:write', description: 'Editar clientes' },
  { key: 'customers:gdpr', description: 'Exportar o anonimizar datos personales' },
  // Proveedores
  { key: 'suppliers:read', description: 'Ver proveedores y su estado' },
  { key: 'suppliers:write', description: 'Configurar proveedores y credenciales' },
  // Pagos
  { key: 'payments:read', description: 'Ver cobros y conciliación' },
  { key: 'payments:write', description: 'Configurar pasarelas de pago' },
  { key: 'payments:payout', description: 'Aprobar reembolsos en cripto' },
  // Contenido y marca
  { key: 'content:write', description: 'Editar páginas, menús y contenido' },
  { key: 'marketing:write', description: 'Gestionar cupones, promociones y campañas' },
  { key: 'brand:write', description: 'Modificar logo, colores y datos de marca' },
  { key: 'reviews:moderate', description: 'Moderar reseñas de clientes' },
  // Imágenes IA
  { key: 'ai_images:run', description: 'Procesar imágenes con IA' },
  { key: 'ai_images:approve', description: 'Aprobar imágenes generadas' },
  // Studio
  { key: 'studio:read', description: 'Entrar al Studio y ver campañas y creatividades' },
  { key: 'studio:write', description: 'Crear y editar campañas, creatividades y plantillas' },
  { key: 'studio:publish', description: 'Aprobar, publicar y exportar creatividades en lote' },
  // Plataforma
  { key: 'settings:read', description: 'Ver ajustes, envíos e impuestos' },
  { key: 'settings:write', description: 'Cambiar ajustes generales' },
  { key: 'users:read', description: 'Ver usuarios del equipo' },
  { key: 'users:write', description: 'Invitar y gestionar el equipo' },
  { key: 'roles:write', description: 'Gestionar roles y permisos' },
  { key: 'audit:read', description: 'Consultar el registro de auditoría' },
  { key: 'jobs:manage', description: 'Ver y reintentar trabajos en cola' },
  { key: 'reports:read', description: 'Ver informes y analítica' },
];

// ═══════════════════════════════════════════════════════════
//  Roles del sistema
// ═══════════════════════════════════════════════════════════

const TODOS = PERMISOS.map((p) => p.key);

const ROLES: { key: string; name: string; description: string; permissions: string[] }[] = [
  {
    key: 'owner',
    name: 'Propietario',
    description: 'Control total, incluida la gestión de roles y la facturación',
    permissions: TODOS,
  },
  {
    key: 'admin',
    name: 'Administrador',
    description: 'Gestiona toda la operativa salvo los roles del sistema',
    permissions: TODOS.filter((k) => k !== 'roles:write'),
  },
  {
    key: 'orders',
    name: 'Gestor de pedidos',
    description: 'Procesa pedidos, devoluciones e incidencias con el proveedor',
    permissions: [
      'orders:read',
      'orders:write',
      'orders:fulfill',
      'orders:cancel',
      'orders:refund',
      'orders:close',
      'returns:manage',
      'customers:read',
      'suppliers:read',
      'payments:read',
      'products:read',
      'reports:read',
    ],
  },
  {
    key: 'catalog',
    name: 'Gestor de catálogo',
    description: 'Importa y mantiene productos, precios e imágenes',
    permissions: [
      'products:read',
      'products:write',
      'products:import',
      'categories:write',
      'media:write',
      'suppliers:read',
      'ai_images:run',
      'ai_images:approve',
      'reviews:moderate',
    ],
  },
  {
    key: 'support',
    name: 'Atención al cliente',
    description: 'Consulta pedidos y clientes para dar soporte, sin tocar dinero',
    permissions: [
      'orders:read',
      'orders:write',
      'customers:read',
      'returns:manage',
      'products:read',
    ],
  },
  {
    key: 'content',
    name: 'Editor de contenido',
    description: 'Edita páginas legales, menús, blog y textos de la tienda',
    permissions: ['content:write', 'products:read', 'media:write', 'reviews:moderate'],
  },
  /*
   * Existe para poder dar el Studio a alguien de fuera sin darle la tienda.
   * Sin este rol, encargar las creatividades a un diseñador obliga a hacerle
   * administrador, y con ello a darle los pedidos, los clientes y las claves de
   * las pasarelas.
   *
   * Lleva `products:read` porque los bloques de producto leen del catálogo: sin
   * eso no puede montar un banner con un precio real. No lleva `studio:publish`
   * a propósito — quien diseña propone, y aprobar es una decisión del negocio.
   */
  {
    key: 'studio',
    name: 'Creativo',
    description: 'Diseña campañas y creatividades en el Studio, y nada más',
    permissions: ['studio:read', 'studio:write', 'media:write', 'products:read', 'ai_images:run'],
  },
];

// ═══════════════════════════════════════════════════════════
//  Ajustes iniciales de marca y tienda
// ═══════════════════════════════════════════════════════════

const AJUSTES: { namespace: string; key: string; value: unknown; isPublic: boolean }[] = [
  { namespace: 'brand', key: 'name', value: 'Mi Tienda', isPublic: true },
  {
    namespace: 'brand',
    key: 'tagline',
    value: { es: 'Tu tienda online', ca: 'La teva botiga en línia', en: 'Your online store' },
    isPublic: true,
  },
  { namespace: 'brand', key: 'logoLight', value: null, isPublic: true },
  { namespace: 'brand', key: 'logoDark', value: null, isPublic: true },
  { namespace: 'brand', key: 'favicon', value: null, isPublic: true },
  { namespace: 'brand', key: 'primaryColor', value: '#4f46e5', isPublic: true },
  { namespace: 'brand', key: 'accentColor', value: '#7c3aed', isPublic: true },

  { namespace: 'shop', key: 'defaultLocale', value: 'es', isPublic: true },
  { namespace: 'shop', key: 'supportedLocales', value: ['es', 'ca', 'en'], isPublic: true },
  { namespace: 'shop', key: 'defaultCurrency', value: 'EUR', isPublic: true },
  /*
   * Divisas en las que se puede ENSEÑAR un precio. Solo euro de salida.
   *
   * Se cobra siempre en euros; esto decide en qué divisa lo ve el visitante. Con
   * solo el euro no aparece selector en la tienda y no se convierte nada, que es
   * lo que se quiere hasta que haya proveedor de tipo de cambio configurado.
   */
  { namespace: 'shop', key: 'currencies', value: ['EUR'], isPublic: true },
  { namespace: 'shop', key: 'defaultCountry', value: 'ES', isPublic: true },
  { namespace: 'shop', key: 'maintenanceMode', value: false, isPublic: true },
  { namespace: 'shop', key: 'freeShippingThreshold', value: 5000, isPublic: true },

  { namespace: 'checkout', key: 'guestCheckout', value: true, isPublic: true },
  // El orden manda en el checkout: NOWPayments es la pasarela principal.
  {
    namespace: 'checkout',
    key: 'paymentProviders',
    // Solo la implementada viene activada. Listar las cuatro dejaba
    // "activadas" pasarelas que no existen todavía, y el panel las mostraba
    // como si la tienda hubiera decidido ofrecerlas.
    value: [
      { key: 'nowpayments', activa: true, orden: 0, minCents: 0, maxCents: null },
      { key: 'revolut', activa: false, orden: 1, minCents: 0, maxCents: null },
      { key: 'stripe', activa: false, orden: 2, minCents: 0, maxCents: null },
      { key: 'paypal', activa: false, orden: 3, minCents: 0, maxCents: null },
    ],
    isPublic: true,
  },
  { namespace: 'checkout', key: 'defaultTaxRate', value: 21, isPublic: false },

  { namespace: 'legal', key: 'companyName', value: '', isPublic: true },
  { namespace: 'legal', key: 'taxId', value: '', isPublic: true },
  { namespace: 'legal', key: 'address', value: '', isPublic: true },
  { namespace: 'legal', key: 'invoicePrefix', value: 'ES', isPublic: false },
  { namespace: 'legal', key: 'withdrawalDays', value: 14, isPublic: true },
  { namespace: 'legal', key: 'adultContentEnabled', value: false, isPublic: true },

  // Cupón que acompaña al segundo y tercer aviso de carrito abandonado.
  // Vacío = los avisos salen sin descuento, que es lo correcto hasta decidir
  // cuánto margen se está dispuesto a ceder por recuperar una venta.
  { namespace: 'marketing', key: 'recoveryCoupon', value: '', isPublic: false },

  // ── Fiscalidad transfronteriza ──
  // El país de la tienda: es quien recauda mientras no se cruce el umbral de
  // los 10.000 € de ventas a distancia a otros países de la UE.
  { namespace: 'tax', key: 'homeCountry', value: 'ES', isPublic: false },
  // Alta en la ventanilla única. NO decide el IVA que se cobra: una vez
  // superado el umbral, la venta tributa en destino esté uno dado de alta o
  // no, y cobrar el 21 % español significa poner la diferencia del propio
  // margen cuando Hacienda regularice. Sirve para avisar de que falta el alta.
  { namespace: 'tax', key: 'ossRegistered', value: false, isPublic: false },
  // Alta en IOSS: permite cobrar el IVA de destino en envíos de hasta 150 €
  // que entran de fuera de la UE, y que el paquete pase la aduana sin que el
  // cliente tenga que pagar nada al recibirlo.
  { namespace: 'tax', key: 'iossRegistered', value: false, isPublic: false },
  { namespace: 'tax', key: 'iossNumber', value: '', isPublic: false },
];

// ═══════════════════════════════════════════════════════════

/**
 * Zonas de envío de una tienda española.
 *
 * Las cuatro son necesarias desde el primer día, y la separación no es
 * cosmética: Canarias, Ceuta y Melilla están FUERA del territorio de
 * aplicación del IVA. Meterlas en la zona general haría que se les cobrara
 * IVA español, que es un error fiscal, y que no se les avisara de los
 * trámites de aduana, que acaba en paquete devuelto.
 */
async function sembrarEnvios(): Promise<void> {
  const existentes = await prisma.shippingZone.count();
  if (existentes > 0) {
    console.info('  · zonas de envío ya configuradas, se dejan como están\n');
    return;
  }

  const zonas = [
    {
      name: 'Península',
      countries: ['ES'],
      postalPrefixes: [] as string[],
      // Península es "España menos las islas y las ciudades autónomas".
      excludedPostalPrefixes: ['35', '38', '51', '52', '07'],
      outsideVatTerritory: false,
      customsWarning: false,
      priority: 10,
      tarifas: [
        { name: 'Estándar', priceCents: 495, freeFromCents: 4900, minDays: 3, maxDays: 7 },
        { name: 'Urgente', priceCents: 995, freeFromCents: null, minDays: 1, maxDays: 3 },
      ],
    },
    {
      name: 'Baleares',
      countries: ['ES'],
      postalPrefixes: ['07'],
      excludedPostalPrefixes: [] as string[],
      // Baleares SÍ está dentro del territorio IVA: se separa por coste, no
      // por fiscalidad.
      outsideVatTerritory: false,
      customsWarning: false,
      priority: 20,
      tarifas: [{ name: 'Estándar', priceCents: 795, freeFromCents: 7900, minDays: 4, maxDays: 9 }],
    },
    {
      name: 'Canarias',
      countries: ['ES'],
      postalPrefixes: ['35', '38'],
      excludedPostalPrefixes: [] as string[],
      outsideVatTerritory: true,
      customsWarning: true,
      priority: 20,
      tarifas: [
        { name: 'Estándar', priceCents: 1295, freeFromCents: null, minDays: 5, maxDays: 12 },
      ],
    },
    {
      name: 'Ceuta y Melilla',
      countries: ['ES'],
      postalPrefixes: ['51', '52'],
      excludedPostalPrefixes: [] as string[],
      outsideVatTerritory: true,
      customsWarning: true,
      priority: 20,
      tarifas: [
        { name: 'Estándar', priceCents: 1495, freeFromCents: null, minDays: 5, maxDays: 14 },
      ],
    },
  ];

  for (const { tarifas, ...zona } of zonas) {
    const creada = await prisma.shippingZone.create({ data: { id: createId(), ...zona } });

    await prisma.shippingRate.createMany({
      data: tarifas.map((tarifa, i) => ({
        id: createId(),
        zoneId: creada.id,
        carrier: null,
        type: 'FLAT' as const,
        position: i,
        ...tarifa,
      })),
    });
  }

  console.info('  ✓ 4 zonas de envío (Península, Baleares, Canarias, Ceuta y Melilla)\n');
}

async function main(): Promise<void> {
  console.info('Sembrando la base de datos…\n');

  // ── Permisos ──────────────────────────────────────────────
  for (const p of PERMISOS) {
    const [resource = '', action = ''] = p.key.split(':');
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { description: p.description, resource, action },
      create: { id: createId(), key: p.key, resource, action, description: p.description },
    });
  }
  console.info(`  ✓ ${PERMISOS.length} permisos`);

  // ── Roles ─────────────────────────────────────────────────
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { key: r.key },
      update: { name: r.name, description: r.description, isSystem: true },
      create: {
        id: createId(),
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: true,
      },
    });

    // Se reasignan los permisos en cada seed para que el rol refleje
    // exactamente lo declarado arriba, sin restos de ejecuciones anteriores.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    const permisos = await prisma.permission.findMany({ where: { key: { in: r.permissions } } });
    await prisma.rolePermission.createMany({
      data: permisos.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }
  console.info(`  ✓ ${ROLES.length} roles`);

  // ── Ajustes ───────────────────────────────────────────────
  for (const s of AJUSTES) {
    await prisma.setting.upsert({
      where: { namespace_key: { namespace: s.namespace, key: s.key } },
      update: {},
      create: {
        id: createId(),
        namespace: s.namespace,
        key: s.key,
        value: s.value as never,
        isPublic: s.isPublic,
      },
    });
  }
  console.info(`  ✓ ${AJUSTES.length} ajustes de marca y tienda`);

  // ═══════════════════════════════════════════════════════════
  //  Páginas legales obligatorias
  //
  //  En España una tienda online necesita, como mínimo: aviso legal (LSSI),
  //  política de privacidad y de cookies (RGPD/LOPDGDD) y condiciones de venta
  //  con el derecho de desistimiento. Se crean como borrador con un texto de
  //  partida: publicarlas sin revisar los datos fiscales reales sería peor que
  //  no tenerlas.
  // ═══════════════════════════════════════════════════════════

  const PAGINAS: {
    handle: string;
    posicion: number;
    titulos: Record<string, string>;
    contenido: Record<string, string>;
  }[] = [
    {
      handle: 'aviso-legal',
      posicion: 1,
      titulos: { es: 'Aviso legal', ca: 'Avís legal', en: 'Legal notice' },
      contenido: {
        es: 'PENDIENTE DE COMPLETAR con los datos fiscales reales.\n\nTitular: [razón social]\nNIF: [NIF/CIF]\nDomicilio: [domicilio fiscal]\nEmail de contacto: [email]\n\nEste sitio web se rige por la Ley 34/2002 de Servicios de la Sociedad de la Información y de Comercio Electrónico (LSSI-CE).',
        ca: 'PENDENT DE COMPLETAR amb les dades fiscals reals.\n\nTitular: [raó social]\nNIF: [NIF/CIF]\nDomicili: [domicili fiscal]\nCorreu de contacte: [correu]',
        en: 'PENDING COMPLETION with the actual tax details.\n\nOwner: [legal name]\nTax ID: [tax ID]\nAddress: [registered address]\nContact email: [email]',
      },
    },
    {
      handle: 'privacidad',
      posicion: 2,
      titulos: { es: 'Política de privacidad', ca: 'Política de privacitat', en: 'Privacy policy' },
      contenido: {
        es: 'PENDIENTE DE REVISAR POR UN ASESOR.\n\nResponsable del tratamiento: [razón social], NIF [NIF].\n\nQué datos tratamos: los que nos facilitas al crear una cuenta o hacer un pedido (nombre, email, dirección de envío y teléfono) y los datos de tu pedido.\n\nPara qué: gestionar tu compra, enviarte el pedido, emitir la factura y atenderte. Con tu permiso, también para enviarte novedades.\n\nCuánto tiempo: mientras tengas cuenta activa, y después el tiempo que obliga la ley fiscal para conservar facturas.\n\nCon quién los compartimos: con el proveedor que envía tu pedido y con la pasarela de pago. No vendemos tus datos a nadie.\n\nTus derechos: acceder, rectificar, suprimir, oponerte y portar tus datos. Puedes descargarlos tú mismo desde tu cuenta, o escribirnos.',
        ca: "PENDENT DE REVISAR PER UN ASSESSOR.\n\nResponsable del tractament: [raó social], NIF [NIF].\n\nPots exercir els teus drets d'accés, rectificació, supressió, oposició i portabilitat escrivint-nos.",
        en: 'PENDING REVIEW BY AN ADVISER.\n\nData controller: [legal name], tax ID [tax ID].\n\nYou may exercise your rights of access, rectification, erasure, objection and portability by contacting us.',
      },
    },
    {
      handle: 'cookies',
      posicion: 3,
      titulos: { es: 'Política de cookies', ca: 'Política de galetes', en: 'Cookie policy' },
      contenido: {
        es: 'Usamos cookies propias necesarias para que la tienda funcione: mantener tu sesión y tu carrito. Estas no se pueden desactivar porque sin ellas no podrías comprar.\n\nCon tu permiso usamos también cookies analíticas, para saber qué funciona y qué no, y de marketing.\n\nPuedes cambiar tu decisión cuando quieras desde el aviso que aparece al entrar. Rechazar es tan fácil como aceptar.',
        ca: 'Fem servir galetes pròpies necessàries perquè la botiga funcioni: mantenir la sessió i la cistella. Amb el teu permís, també analítiques i de màrqueting.',
        en: 'We use our own necessary cookies to keep the shop working: your session and your cart. With your permission we also use analytics and marketing cookies.',
      },
    },
    {
      handle: 'condiciones',
      posicion: 4,
      titulos: { es: 'Condiciones de venta', ca: 'Condicions de venda', en: 'Terms of sale' },
      contenido: {
        es: 'PENDIENTE DE REVISAR POR UN ASESOR.\n\nPrecios: todos los precios incluyen el IVA aplicable.\n\nPlazos de entrega: los productos se envían desde el extranjero, por lo que el plazo habitual es de 2 a 4 semanas. El plazo estimado aparece en cada ficha de producto.\n\nDerecho de desistimiento: dispones de 14 días naturales desde la recepción para devolver el pedido sin justificar el motivo. Los gastos de devolución corren de tu cuenta salvo que el producto llegue defectuoso.\n\nGarantía: 3 años para productos nuevos, conforme al Real Decreto Ley 7/2021.',
        ca: "PENDENT DE REVISAR PER UN ASSESSOR.\n\nTots els preus inclouen l'IVA aplicable. Tens 14 dies naturals des de la recepció per desistir de la compra.",
        en: 'PENDING REVIEW BY AN ADVISER.\n\nAll prices include applicable VAT. You have 14 calendar days from receipt to withdraw from the purchase.',
      },
    },
    {
      handle: 'envios',
      posicion: 5,
      titulos: {
        es: 'Envíos y entregas',
        ca: 'Enviaments i lliuraments',
        en: 'Shipping and delivery',
      },
      contenido: {
        es: 'Los pedidos se envían desde el proveedor, generalmente fuera de la Unión Europea.\n\nPlazo habitual: de 2 a 4 semanas desde que confirmamos el pago.\n\nSeguimiento: recibirás el número de seguimiento en cuanto el paquete salga.\n\nAduanas: para pedidos de fuera de la UE, el IVA de importación está incluido en el precio que pagas. No tendrás que abonar nada al recibir el paquete.',
        ca: "Les comandes s'envien des del proveïdor. Termini habitual: de 2 a 4 setmanes des de la confirmació del pagament.",
        en: 'Orders ship from the supplier. Usual lead time: 2 to 4 weeks from payment confirmation.',
      },
    },
    {
      handle: 'devoluciones',
      posicion: 6,
      titulos: { es: 'Devoluciones', ca: 'Devolucions', en: 'Returns' },
      contenido: {
        es: 'Tienes 14 días naturales desde que recibes el pedido para devolverlo sin dar explicaciones.\n\nCómo hacerlo: escríbenos indicando tu número de pedido y te damos instrucciones.\n\nReembolso: te devolvemos el importe en un plazo máximo de 14 días desde que recibimos el producto o desde que nos demuestras que lo has enviado.\n\nProductos defectuosos: si el producto llega dañado o no corresponde con lo pedido, los gastos de devolución corren de nuestra cuenta.',
        ca: 'Tens 14 dies naturals des que reps la comanda per tornar-la sense donar explicacions.',
        en: 'You have 14 calendar days from receiving your order to return it without giving reasons.',
      },
    },
  ];

  for (const pagina of PAGINAS) {
    const existente = await prisma.page.findUnique({ where: { handle: pagina.handle } });
    const pageId = existente?.id ?? createId();

    if (!existente) {
      await prisma.page.create({
        data: {
          id: pageId,
          handle: pagina.handle,
          status: 'DRAFT',
          isSystem: true,
          position: pagina.posicion,
        },
      });
    }

    for (const locale of ['es', 'ca', 'en'] as const) {
      await prisma.pageTranslation.upsert({
        where: { pageId_locale: { pageId, locale } },
        update: {},
        create: {
          id: createId(),
          pageId,
          locale,
          title: pagina.titulos[locale] ?? pagina.handle,
          slug: pagina.handle,
          content: pagina.contenido[locale] ?? '',
        },
      });
    }
  }
  console.info(`  ✓ ${PAGINAS.length} páginas legales (en borrador, pendientes de revisar)`);

  // ── Usuarios de desarrollo ────────────────────────────────
  //
  // Todo lo anterior —permisos, roles, ajustes, páginas legales y zonas de
  // envío— es dato de referencia que la tienda necesita también en producción:
  // sin roles no hay a quién dar permisos, y sin páginas legales la tienda no
  // puede vender en España.
  //
  // Estos dos usuarios NO. Su contraseña está escrita aquí, en un fichero del
  // repositorio, así que en producción serían dos puertas abiertas con la
  // llave puesta. El propietario real se crea aparte, con una contraseña que
  // se teclea en el momento: `prisma/crear-propietario.ts`.
  if (esProduccion) {
    console.info('  · producción: no se crean usuarios de desarrollo\n');
    await sembrarEnvios();
    return;
  }

  const password = await argon2.hash('Admin1234!', { type: argon2.argon2id });

  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'owner' } });
  const owner = await prisma.user.upsert({
    where: { email: 'admin@tienda.local' },
    update: {},
    create: {
      id: createId(),
      email: 'admin@tienda.local',
      type: 'STAFF',
      password,
      firstName: 'Admin',
      lastName: 'Local',
      locale: 'es',
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: owner.id, roleId: ownerRole.id } },
    update: {},
    create: { userId: owner.id, roleId: ownerRole.id },
  });

  const cliente = await prisma.user.upsert({
    where: { email: 'cliente@tienda.local' },
    update: {},
    create: {
      id: createId(),
      email: 'cliente@tienda.local',
      type: 'CUSTOMER',
      password,
      firstName: 'Cliente',
      lastName: 'De Prueba',
      locale: 'es',
      emailVerifiedAt: new Date(),
    },
  });

  const tieneDireccion = await prisma.address.findFirst({ where: { userId: cliente.id } });
  if (!tieneDireccion) {
    await prisma.address.create({
      data: {
        id: createId(),
        userId: cliente.id,
        type: 'SHIPPING',
        firstName: 'Cliente',
        lastName: 'De Prueba',
        line1: 'Calle Mayor 1',
        city: 'Madrid',
        province: 'Madrid',
        postalCode: '28013',
        countryCode: 'ES',
        phone: '+34600000000',
        isDefault: true,
      },
    });
  }
  console.info('  ✓ 2 usuarios de desarrollo\n');

  await sembrarEnvios();

  console.info('Listo. Credenciales locales:');
  console.info('  Admin:    admin@tienda.local    / Admin1234!');
  console.info('  Cliente:  cliente@tienda.local  / Admin1234!\n');
}

try {
  await main();
} catch (error) {
  console.error('El seed ha fallado:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
