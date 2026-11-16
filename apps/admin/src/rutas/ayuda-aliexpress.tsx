import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { Enlace } from '@/componentes/enlace';

/**
 * Documentación de la integración con AliExpress.
 *
 * Vive dentro del panel y no en un fichero del repositorio porque quien
 * necesita leerla es quien lleva la tienda, no quien la programa: cuando una
 * importación falle a las once de la noche, la respuesta tiene que estar a un
 * clic del botón que ha fallado.
 *
 * Todo lo que se afirma aquí está comprobado contra el servicio real, no
 * copiado de su documentación, que en varios puntos no coincide con lo que
 * devuelve la API.
 */

interface EstadoProveedor {
  id: string;
  key: string;
  name: string;
  salud: string;
  credencialesConfiguradas: boolean;
  listo: boolean;
  motivoNoListo: string | null;
}

interface EstadoAutorizacion {
  usaOauth: boolean;
  autorizado: boolean;
  urlDeRetorno: string;
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="panel mb-4 p-5">
      <h2 className="mb-3 text-base font-semibold tracking-tight">{titulo}</h2>
      <div className="space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function Codigo({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="rounded px-1.5 py-0.5 font-mono text-xs"
      style={{ background: 'var(--fondo-sutil)' }}
    >
      {children}
    </code>
  );
}

/** Una fila de la tabla de funciones de la API. */
function Endpoint({
  metodo,
  ruta,
  permiso,
  children,
}: {
  metodo: string;
  ruta: string;
  permiso: string;
  children: React.ReactNode;
}) {
  const color =
    metodo === 'GET' ? 'var(--exito)' : metodo === 'DELETE' ? 'var(--error)' : 'var(--acento)';

  return (
    <div className="border-b py-3 last:border-0" style={{ borderColor: 'var(--borde)' }}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-xs font-semibold" style={{ color }}>
          {metodo}
        </span>
        <span className="font-mono text-xs break-all">{ruta}</span>
        <span
          className="rounded px-1.5 py-0.5 font-mono text-[11px]"
          style={{ background: 'var(--fondo-sutil)', color: 'var(--texto-tenue)' }}
        >
          {permiso}
        </span>
      </div>
      <p className="mt-1 text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {children}
      </p>
    </div>
  );
}

export function AyudaAliExpress() {
  const proveedores = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => get<EstadoProveedor[]>('/suppliers'),
  });

  const aliexpress = (proveedores.data ?? []).find((p) => p.key === 'aliexpress');

  const autorizacion = useQuery({
    queryKey: ['proveedores', aliexpress?.id, 'oauth'],
    queryFn: () => get<EstadoAutorizacion>(`/suppliers/${aliexpress?.id}/oauth/status`),
    enabled: Boolean(aliexpress),
  });

  return (
    <div className="medida-lectura">
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">AliExpress · cómo funciona</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--texto-tenue)' }}>
          De dónde sale la mercancía, qué hace falta para conectarlo y qué se puede pedir a través
          de la API.
        </p>
      </div>

      {/* Estado real, arriba del todo: es lo primero que se quiere saber al
          abrir esta página después de que algo falle. */}
      <section className="panel mb-4 p-5">
        <h2 className="mb-3 text-base font-semibold tracking-tight">Estado ahora mismo</h2>

        {!aliexpress ? (
          <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
            Todavía no hay ningún proveedor de AliExpress dado de alta.{' '}
            <Enlace a="/proveedores" className="underline">
              Darlo de alta
            </Enlace>
            .
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            <li>
              Credenciales:{' '}
              <strong>{aliexpress.credencialesConfiguradas ? 'puestas' : 'sin poner'}</strong>
            </li>
            <li>
              Autorización:{' '}
              <strong>{autorizacion.data?.autorizado ? 'concedida' : 'pendiente'}</strong>
            </li>
            <li>
              ¿Se puede importar ya?{' '}
              <strong style={{ color: aliexpress.listo ? 'var(--exito)' : 'var(--aviso)' }}>
                {aliexpress.listo ? 'sí' : `no — ${aliexpress.motivoNoListo ?? ''}`}
              </strong>
            </li>
          </ul>
        )}
      </section>

      <Seccion titulo="1 · Las dos cosas que hacen falta (y no son la misma)">
        <p>
          Conectar AliExpress tiene <strong>dos pasos independientes</strong>, y confundirlos es la
          causa de casi todos los problemas iniciales.
        </p>
        <p>
          El <strong>App Key</strong> y el <strong>App Secret</strong> identifican a la aplicación
          —a esta tienda— frente a AliExpress. Se copian de la consola de AliExpress Open Platform y
          se pegan en la ficha del proveedor. Con ellos se firma cada llamada.
        </p>
        <p>
          La <strong>autorización</strong> es otra cosa: es el permiso del titular de la cuenta de
          AliExpress para que esta tienda actúe en su nombre. Ese permiso no se copia de ningún
          sitio: se concede entrando en una página de AliExpress y pulsando aceptar.
        </p>
        <p style={{ color: 'var(--texto-tenue)' }}>
          Por eso el botón «Verificar» puede salir en verde y aun así no poder importar nada: las
          credenciales son correctas, pero nadie ha dado permiso todavía. El panel lo distingue con
          el estado <Codigo>PENDING_AUTH</Codigo>.
        </p>
      </Seccion>

      <Seccion titulo="2 · Puesta en marcha, paso a paso">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            En{' '}
            <Enlace a="/proveedores" className="underline">
              Proveedores
            </Enlace>
            , añade uno de tipo AliExpress. Pon <strong>Envía desde: CN</strong> — decide el IVA, y
            dejarlo en ES haría facturar una importación como venta interior.
          </li>
          <li>
            Abre «Configurar» y pega el App Key y el App Secret. Los campos de token no aparecen: se
            consiguen solos en el paso siguiente.
          </li>
          <li>
            Copia la <strong>URL de retorno</strong> que muestra la ficha y date de alta esa misma
            dirección en la consola de AliExpress, en los ajustes de la aplicación. Tiene que
            coincidir <em>carácter por carácter</em>, barra final incluida.
            {autorizacion.data?.urlDeRetorno && (
              <div className="mt-1">
                <Codigo>{autorizacion.data.urlDeRetorno}</Codigo>
              </div>
            )}
          </li>
          <li>
            Pulsa <strong>«Autorizar con AliExpress»</strong>, en la ficha del proveedor. Te lleva a
            su web, inicias sesión con la cuenta que va a comprar y aceptas. Vuelves al panel con el
            resultado.
          </li>
          <li>
            Pulsa «Verificar». Si sale «Autorizado», ya se puede buscar en su catálogo, importar
            productos y enviar pedidos.
          </li>
        </ol>
      </Seccion>

      <Seccion titulo="2 bis · Tres ajustes de su consola que se confunden">
        <p>
          La consola de AliExpress tiene varias cosas que suenan parecido y hacen cosas distintas.
          Faltar cualquiera de las dos primeras impide autorizar.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>URL de retorno (callback)</strong> — a dónde te devuelve AliExpress después de
            aceptar. <em>Sin esto no se puede autorizar.</em> Es la que muestra la ficha del
            proveedor, y tiene que coincidir carácter por carácter.
          </li>
          <li>
            <strong>Lista blanca de IP</strong> — desde qué servidores se permite llamar a su API.
            Es necesaria para que las llamadas funcionen, pero{' '}
            <em>no concede ningún permiso sobre la cuenta</em> y no sustituye a lo anterior. Tener
            la IP dada de alta y no la URL de retorno deja la autorización igual de bloqueada.
          </li>
          <li>
            <strong>Estado de la aplicación</strong> — «Test» o producción. Afecta a qué métodos
            responden, no a la autorización.
          </li>
        </ul>
        <p style={{ color: 'var(--aviso)' }}>
          <strong>
            Si su consola no acepta una URL de <Codigo>localhost</Codigo>
          </strong>{' '}
          —es frecuente: muchas plataformas exigen HTTPS y un dominio público— hace falta exponer la
          API con un túnel (<Codigo>cloudflared tunnel</Codigo> o <Codigo>ngrok http 3001</Codigo>),
          poner esa dirección pública en <Codigo>API_URL</Codigo> y dar de alta la URL resultante.
          Al desplegar en el servidor definitivo esto deja de hacer falta.
        </p>
      </Seccion>

      <Seccion titulo="3 · Los tokens se renuevan solos">
        <p>
          Al autorizar, AliExpress entrega dos tokens: uno de acceso, que caduca en unas horas, y
          uno de refresco, que dura mucho más. Los dos se guardan cifrados y no se muestran nunca,
          ni siquiera al administrador.
        </p>
        <p>
          Antes de cada uso del proveedor se comprueba si al token de acceso le quedan menos de
          cinco minutos y, si es así, se renueva sin que nadie intervenga. Se hace en ese momento y
          no con una tarea nocturna a propósito: una tarea que falle de madrugada dejaría la tienda
          sin poder enviar pedidos hasta que alguien lo mirara.
        </p>
        <p>
          Solo hay que <strong>volver a autorizar</strong> si caduca también el token de refresco o
          si el titular revoca el permiso desde AliExpress. El panel lo indica.
        </p>
      </Seccion>

      <Seccion titulo="4 · Qué se puede hacer a través de la API">
        <p className="mb-2">
          Todas las rutas cuelgan de <Codigo>/api/v1</Codigo> y necesitan un token de sesión del
          panel. Entre corchetes, el permiso que exige cada una.
        </p>

        <h3 className="pt-2 text-sm font-semibold">Alta y configuración</h3>
        <Endpoint metodo="GET" ruta="/suppliers/available" permiso="suppliers:read">
          Proveedores soportados y qué credenciales pide cada uno. Marca cuáles llegan por
          autorización en lugar de escribirse.
        </Endpoint>
        <Endpoint metodo="GET" ruta="/suppliers" permiso="suppliers:read">
          Los que hay dados de alta, con su salud, márgenes y última sincronización. Nunca devuelve
          credenciales.
        </Endpoint>
        <Endpoint metodo="POST" ruta="/suppliers" permiso="suppliers:write">
          Dar de alta un proveedor. Acepta las credenciales en el mismo alta.
        </Endpoint>
        <Endpoint metodo="PATCH" ruta="/suppliers/:id" permiso="suppliers:write">
          Margen por defecto y mínimo, prioridad, país de origen, intervalo de sincronización y si
          está activo.
        </Endpoint>
        <Endpoint metodo="PATCH" ruta="/suppliers/:id/credentials" permiso="suppliers:write">
          Sustituir credenciales. Se guardan cifradas con AES-256-GCM y se verifica al momento.
        </Endpoint>
        <Endpoint metodo="POST" ruta="/suppliers/:id/verify" permiso="suppliers:read">
          Llama de verdad a AliExpress. Devuelve si las credenciales valen <Codigo>ok</Codigo> y,
          aparte, si hay autorización <Codigo>autorizado</Codigo>.
        </Endpoint>
        <Endpoint metodo="DELETE" ruta="/suppliers/:id" permiso="suppliers:write">
          Solo si no tiene pedidos: borrarlo dejaría facturas apuntando a un proveedor inexistente.
        </Endpoint>

        <h3 className="pt-4 text-sm font-semibold">Autorización</h3>
        <Endpoint metodo="GET" ruta="/suppliers/:id/oauth/status" permiso="suppliers:read">
          Si usa OAuth, si está autorizado, cuándo caduca el acceso, qué cuenta lo concedió y la URL
          de retorno que hay que dar de alta.
        </Endpoint>
        <Endpoint metodo="POST" ruta="/suppliers/:id/oauth/start" permiso="suppliers:write">
          Devuelve la URL a la que hay que mandar al titular. No autoriza nada por sí sola.
        </Endpoint>
        <Endpoint metodo="GET" ruta="/suppliers/oauth/aliexpress/callback" permiso="público">
          A donde vuelve el navegador desde AliExpress. Cambia el código por los tokens y redirige
          al panel. Es público porque quien lo abre viene de otro dominio y no trae sesión; lo que
          lo autentica es el código, de un solo uso y de vida corta.
        </Endpoint>

        <h3 className="pt-4 text-sm font-semibold">Catálogo y pedidos</h3>
        <Endpoint metodo="GET" ruta="/suppliers/:id/catalog?q=…" permiso="products:import">
          Busca en el catálogo del proveedor y calcula el PVP que saldría con los márgenes
          configurados, antes de importar nada.
        </Endpoint>
        <Endpoint metodo="POST" ruta="/suppliers/:id/import" permiso="products:import">
          Importa un producto. <strong>Queda en borrador</strong>: nada llega a la tienda sin que
          alguien lo revise y lo publique.
        </Endpoint>
        <Endpoint metodo="POST" ruta="/suppliers/:id/sync" permiso="suppliers:write">
          Actualiza precio y stock de lo ya importado. Es lo que detecta que el proveedor ha subido
          el precio y estamos vendiendo por debajo de coste.
        </Endpoint>
        <Endpoint metodo="GET" ruta="/suppliers/:id/sync/history" permiso="suppliers:read">
          Qué cambió en cada sincronización: precios, stock y productos descatalogados.
        </Endpoint>
        <Endpoint metodo="GET" ruta="/suppliers/sync/pending" permiso="suppliers:read">
          A quién le toca sincronizar según su intervalo.
        </Endpoint>

        <p className="pt-3" style={{ color: 'var(--texto-tenue)' }}>
          La referencia completa, con los cuerpos de cada petición, está en{' '}
          <Codigo>/api/docs</Codigo> (OpenAPI).
        </p>
      </Seccion>

      <Seccion titulo="5 · Todo lo que se puede hacer con AliExpress">
        <p>
          Esta lista no sale de su documentación: sale de <strong>preguntarle a su servicio</strong>
          con las credenciales de esta tienda, método por método. Su documentación describe cosas
          que no existen y omite otras que sí.
        </p>

        <h3 className="pt-2 text-sm font-semibold" style={{ color: 'var(--exito)' }}>
          Funciona ya, sin autorizar
        </h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Árbol de categorías completo</strong> (<Codigo>ds.category.get</Codigo>) — 549
            categorías. Es lo que usa el botón «Verificar» para comprobar las credenciales.
          </li>
          <li>
            <strong>Listado de feeds de productos</strong> (<Codigo>ds.feedname.get</Codigo>) — los
            catálogos temáticos que AliExpress prepara para dropshippers.
          </li>
        </ul>

        <h3 className="pt-3 text-sm font-semibold" style={{ color: 'var(--exito)' }}>
          Funciona en cuanto autorices
        </h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Ficha completa de un producto</strong> (<Codigo>ds.product.get</Codigo>) —
            título, descripción, fotos, variantes, precios y stock. Es la vía de importación que usa
            el panel: pegas el identificador o la URL.
          </li>
          <li>
            <strong>Productos de un feed</strong> (<Codigo>ds.recommend.feed.get</Codigo>) — navegar
            catálogos temáticos sin buscar por texto. Es la alternativa natural mientras la búsqueda
            siga bloqueada.
          </li>
          <li>
            <strong>Búsqueda por imagen</strong> (<Codigo>ds.image.search</Codigo>) — encontrar un
            producto a partir de una foto.
          </li>
          <li>
            <strong>Coste de envío</strong> (<Codigo>ds.freight.query</Codigo>) — el porte real a un
            destino concreto, antes de fijar el PVP.
          </li>
          <li>
            <strong>Crear el pedido</strong> (<Codigo>ds.order.create</Codigo>) con envío sin marca
            del proveedor.
          </li>
          <li>
            <strong>Estado del pedido</strong> (<Codigo>ds.trade.order.get</Codigo>) y{' '}
            <strong>seguimiento del envío</strong> (<Codigo>ds.order.tracking.get</Codigo>).
          </li>
          <li>
            <strong>Direcciones de la cuenta</strong> (<Codigo>ds.address.get</Codigo>) y{' '}
            <strong>pedidos con comisión</strong> (<Codigo>ds.commissionorder.listbyindex</Codigo>).
          </li>
        </ul>
        <p style={{ color: 'var(--texto-tenue)' }}>
          De estos, el panel usa hoy la ficha de producto, la creación de pedidos, el estado y el
          seguimiento. Los feeds, la búsqueda por imagen y el cálculo de portes están disponibles y
          sin integrar todavía.
        </p>

        <h3 className="pt-3 text-sm font-semibold" style={{ color: 'var(--aviso)' }}>
          Necesita que la aplicación pase a producción
        </h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Búsqueda por texto</strong> (<Codigo>ds.text.search</Codigo>) — responde
            «EXCEPTION_TEXT_SEARCH_FOR_DS» mientras la aplicación esté en modo de pruebas. Por eso
            el buscador del importador no devuelve nada con AliExpress, y por eso está la
            importación por identificador o URL.
          </li>
        </ul>

        <h3 className="pt-3 text-sm font-semibold" style={{ color: 'var(--error)' }}>
          No existe
        </h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Cancelar un pedido.</strong> No hay ningún método: se probaron todas las
            variantes plausibles y todas responden «InvalidApiPath». Hay que cancelar entrando en la
            cuenta de AliExpress, y solo mientras el vendedor no haya enviado. El panel lo dice
            cuando se intenta, en lugar de fallar.
          </li>
          <li>
            <strong>Devoluciones.</strong> Van por su plataforma de disputas, no por API.
          </li>
        </ul>
        <p style={{ color: 'var(--texto-tenue)' }}>
          Los nombres que parecían correctos leyendo su documentación —<Codigo>ds.order.get</Codigo>
          , <Codigo>ds.order.cancel</Codigo>, <Codigo>ds.logistics.tracking.get</Codigo>— tampoco
          existen. Hay una prueba que fija los verificados para que no vuelvan a colarse.
        </p>

        <p className="pt-2">
          Las llamadas van limitadas a <strong>5 por segundo</strong>, con reintentos escalonados y
          cortacircuitos. Pasarse de su cuota suele acabar en bloqueo temporal de la cuenta, que son
          horas sin poder enviar pedidos.
        </p>
      </Seccion>

      <Seccion titulo="6 · Cómo se importa un producto">
        <p>
          El importador está en{' '}
          <Enlace a="/importar" className="underline">
            Importar productos
          </Enlace>
          . Ofrece dos caminos, y hoy solo uno funciona con AliExpress.
        </p>

        <h3 className="pt-2 text-sm font-semibold">Por identificador o URL — el que funciona</h3>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Encuentra el producto navegando por la web de AliExpress.</li>
          <li>Copia el enlace de la barra del navegador, entero.</li>
          <li>
            Pégalo en «Importar por identificador o URL». Se acepta la URL completa con toda su cola
            de parámetros, o solo el número.
          </li>
          <li>
            Verás <strong>coste, porte, PVP propuesto, margen y número de variantes</strong> antes
            de decidir. Si el margen no llega al mínimo del proveedor, sale un aviso.
          </li>
          <li>Pulsa Importar.</li>
        </ol>

        <h3 className="pt-3 text-sm font-semibold">Por texto — bloqueado</h3>
        <p style={{ color: 'var(--texto-tenue)' }}>
          El buscador funciona con otros proveedores, pero con AliExpress no devolverá nada hasta
          que la aplicación pase a producción. Cuando eso ocurra funcionará sin tocar nada.
        </p>

        <h3 className="pt-3 text-sm font-semibold">Qué pasa después de importar</h3>
        <p>
          El producto entra <strong>como borrador</strong>, nunca publicado: nada llega a la tienda
          sin que alguien lo revise. Se le crean sus variantes y un enlace con el proveedor que es
          lo que permite sincronizarlo después.
        </p>
        <p>
          La <strong>sincronización</strong> revisa precio y stock cada cierto tiempo. No machaca
          tus cambios: solo ajusta el precio si el margen cae por debajo del mínimo —para no vender
          a pérdida cuando el proveedor sube el suyo— y nunca toca título, descripción ni fotos.
        </p>
        <p style={{ color: 'var(--texto-tenue)' }}>
          Si el desplegable de proveedores sale vacío, la pantalla dice de cada uno por qué no está
          listo: desactivado, sin credenciales o sin autorizar.
        </p>
      </Seccion>

      <Seccion titulo="7 · Cuando algo falla">
        <p>
          <strong>«Invalid authorization code»</strong> — el código de autorización dura minutos y
          sirve una sola vez. Vuelve a pulsar «Autorizar».
        </p>
        <p>
          <strong>«IncompleteSignature» o «InvalidSignature»</strong> — el App Secret no coincide.
          Vuelve a copiarlo de la consola; se pega entero y sin espacios.
        </p>
        <p>
          <strong>«access_token is not supplied»</strong> — falta autorizar. Es el estado{' '}
          <Codigo>PENDING_AUTH</Codigo>.
        </p>
        <p>
          <strong>Vuelves de AliExpress a una página de error</strong> — la URL de retorno dada de
          alta allí no coincide exactamente con la de aquí.
        </p>
        <p>
          <strong>La aplicación está en modo de pruebas</strong> — mientras el estado de la
          aplicación en la consola de AliExpress sea «Test», algunos métodos responden solo a la
          cuenta del propio desarrollador. Para vender de verdad hay que solicitar el paso a
          producción.
        </p>
        <p style={{ color: 'var(--texto-tenue)' }}>
          Todo lo que ocurre aquí queda en{' '}
          <Enlace a="/auditoria" className="underline">
            Auditoría
          </Enlace>
          : quién autorizó, con qué cuenta y hasta cuándo. Los tokens no se registran nunca.
        </p>
      </Seccion>

      <Seccion titulo="8 · Lo que decide el IVA">
        <p>
          El campo <strong>«Envía desde»</strong> del proveedor no es informativo: determina cómo se
          factura. Un envío desde China a Madrid es una <strong>importación</strong> por mucho que
          quien compre sea español, y eso cambia el IVA que se cobra y el que se declara.
        </p>
        <p>
          Con AliExpress lo normal es <Codigo>CN</Codigo>. Dejarlo en <Codigo>ES</Codigo> haría
          facturar todo como venta interior, y el error no se ve hasta el cierre del trimestre.
        </p>
      </Seccion>
    </div>
  );
}
