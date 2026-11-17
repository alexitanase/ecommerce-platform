# Qué necesita tu intervención

Todo lo demás avanza solo. Esto no: son cosas que requieren credenciales,
hardware o decisiones de negocio que no puedo tomar por ti.

El código de cada punto **está escrito y compila**; lo que falta es poder
validarlo contra el servicio real.

---

## 1 · Credenciales de pasarelas de pago

Se ponen en **Admin → Integraciones**, no en el servidor. Se guardan cifradas,
no se vuelven a mostrar y cada una tiene un botón que la prueba contra el
servicio real antes de que la use un cliente.

| Pasarela        | Estado del adaptador          | Qué hace falta                      | Dónde se obtiene                                                                                                                                                                                                                                                           |
| --------------- | ----------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NOWPayments** | Implementado                  | Clave de API y secreto IPN          | Panel de NOWPayments → Settings → API keys. Tienen **sandbox** gratuito para probar sin dinero real.                                                                                                                                                                       |
| **Revolut**     | Implementado                  | Clave de API y secreto del webhook  | Revolut Business → Merchant API. Requiere cuenta Business.                                                                                                                                                                                                                 |
| **Stripe**      | Implementado                  | Clave secreta y secreto del webhook | Dashboard de Stripe. Claves de test disponibles al instante, sin dar de alta ningún negocio.                                                                                                                                                                               |
| **Payiad**      | Implementado (sin reembolsos) | Clave secreta y secreto del webhook | Panel de Payiad. Con `sk_test_…` y la tarjeta 4242 4242 4242 4242 se prueba sin dinero real. Webhook: `/api/v1/payments/webhook/payiad`, eventos `payment.*`. **Reembolsos pendientes** de que Payiad mande su documentación: mientras tanto, se devuelven desde su panel. |
| PayPal          | Sin escribir                  | Client ID y Client Secret           | PayPal Developer → Sandbox.                                                                                                                                                                                                                                                |

**Sin esto:** el flujo de cobro está implementado y se puede probar con el
proveedor simulado, pero no se ha validado contra la pasarela real. La firma
HMAC de los callbacks de NOWPayments, en concreto, es el punto que más conviene
verificar en cuanto tengas la clave: un error ahí significa aceptar
notificaciones de pago falsas.

**Para webhooks en local** hace falta exponer el puerto 3001 a internet
(`ngrok http 3001` o `cloudflared tunnel`), porque la pasarela tiene que poder
llamarnos.

### Revolut · dos pasos, y el segundo solo se hace una vez

Cobra con tarjeta y con Revolut Pay, y el pago ocurre en la página de Revolut:
los datos de la tarjeta no pasan por nuestro servidor, que es lo que mantiene
el papeleo de PCI en el mínimo.

1. **Clave de API.** En Revolut Business → Merchant API → API keys. Ojo con el
   entorno: la clave de pruebas solo funciona con «Modo de pruebas» activado en
   Admin → Integraciones, y la de producción solo sin él. Mezclarlos da un 401
   que parece una clave mal copiada.

2. **Dar de alta el webhook**, que es el paso que se olvida. Se crea desde su
   API o su panel apuntando a
   `https://api.tudominio.es/api/v1/payments/webhook/revolut`, con los eventos
   `ORDER_COMPLETED`, `ORDER_AUTHORISED`, `ORDER_PAYMENT_DECLINED`,
   `ORDER_PAYMENT_FAILED` y `ORDER_CANCELLED`. Al crearlo devuelve un secreto
   `wsk_…` que **solo se enseña esa vez**: si se pierde, hay que borrar el
   webhook y crear otro. Ese secreto va en Admin → Integraciones.

**Sin el paso 2 la tienda cobra y no se entera.** El cliente paga, ve la
pantalla de gracias de Revolut, y el pedido se queda en «esperando pago» hasta
que el reconciliador lo recoge. Con el secreto mal puesto es peor: los avisos
llegan, se rechazan por firma inválida, y en el log aparece «webhook de revolut
con firma inválida» una y otra vez.

**Qué se ha comprobado ya, sin cuenta:** que la firma de sus avisos se verifica
bien —incluido el rechazo de un aviso reenviado horas después, que es el ataque
propio de esta pasarela— y que las llamadas llegan a su servidor de pruebas de
verdad, que responde 401 a una clave inventada. Lo que falta por validar con
cuenta real es la creación del pedido, el cobro y el reembolso.

### Stripe · dos pasos, y trae Bizum

Es la que abre el método de pago que más se usa en España. Los métodos no se
eligen en nuestro código: se activan en su panel (Configuración → Métodos de
pago) y aparecen solos en el checkout según el importe, la divisa y el país del
cliente. El pago ocurre en la página de Stripe, así que la tarjeta tampoco pasa
por nuestro servidor.

1. **Clave secreta.** Dashboard → Desarrolladores → Claves de API. La secreta
   (`sk_test_…` o `sk_live_…`), **no** la publicable `pk_…`. Aquí no hay casilla
   de «modo de pruebas» que se pueda dejar mal puesta: el modo lo dice la propia
   clave, y el botón de probar lo escribe en pantalla («clave de pruebas: no se
   mueve dinero real»).

2. **Dar de alta el webhook.** Dashboard → Desarrolladores → Webhooks → añadir
   endpoint, apuntando a
   `https://api.tudominio.es/api/v1/payments/webhook/stripe`, y suscribir **solo
   estos cuatro eventos**:

   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`

   Al crearlo da un secreto `whsec_…` que va en Admin → Integraciones. Los demás
   eventos se ignoran a propósito: lo que se guarda como identificador del cobro
   es la sesión (`cs_…`), así que un `payment_intent.succeeded` —que llega con un
   `pi_…`— no casaría con ningún cobro y solo generaría ruido en el log.

**Sin el paso 2 la tienda cobra y no se entera**, igual que con Revolut.

**Lo que hay que saber de Bizum antes de activarlo:** cierra la sesión con el
pago _pendiente_ y lo confirma después. El adaptador ya lo trata así —la sesión
«completada pero sin pagar» queda en «esperando confirmación», no en «pagada»—,
así que no se envía mercancía contra un pago que todavía puede fallar. Es el
motivo de que el webhook necesite los dos eventos `async_payment_*`.

**Y el aviso de siempre con esta pasarela:** Stripe restringe el contenido para
adultos y puede cerrar la cuenta sin previo aviso. Antes de apoyar la tienda en
ella conviene leer sus condiciones y tener otra activa (ver punto 3).

**Qué se ha comprobado ya, sin cuenta:** la verificación de firma completa
—secreto equivocado, cuerpo alterado tras firmarlo, aviso reenviado, aviso del
futuro y rotación de secreto con dos firmas conviviendo—, que el cuerpo se envía
como formulario y no como JSON, que el importe viaja en céntimos, que la sesión
completada sin pagar no cuenta como cobro y que el reembolso resuelve el
PaymentIntent a partir de la sesión. Falta validar con clave real la creación de
la sesión, el cobro y el reembolso.

---

## 2 · Credenciales de AliExpress · **RECIBIDAS** (26/07/2026)

App Key y App Secret entregados y **validados contra la API real**. Guardados
cifrados en **Admin → Proveedores**, nunca en el repositorio.

Lo que ya funciona, comprobado contra el servicio de verdad:

- La firma de las llamadas normales (endpoint `/sync`). `aliexpress.ds.category.get`
  devuelve las 549 categorías reales.
- La firma de las llamadas de autorización (rutas `/rest/…`, que se firman
  **incluyendo la ruta**). El servidor responde al código, no a la firma.
- La URL de autorización: AliExpress la acepta y muestra su pantalla de acceso.

### Lo que falta, y solo lo puedes hacer tú

1. **Dar de alta la URL de retorno** en la consola de AliExpress, en los ajustes
   de la aplicación. Tiene que coincidir carácter por carácter con la que
   muestra el panel. En local es
   `http://localhost:3001/api/v1/suppliers/oauth/aliexpress/callback`; al
   desplegar cambiará al dominio real.
2. **Pulsar «Autorizar con AliExpress»** en la ficha del proveedor e iniciar
   sesión con la cuenta que vaya a comprar. Sin ese permiso, las credenciales
   son válidas pero no se puede importar ni hacer pedidos: el panel lo marca
   como `PENDING_AUTH`.

### La aplicación está en modo de pruebas

El estado en su consola es **Test**. En ese modo, parte de los métodos responden
solo a la cuenta del propio desarrollador. Para vender de verdad hay que
solicitar el paso a producción, que revisan a mano y tarda.

### Métodos de su API: tres estaban mal

Sondeando su servicio con las credenciales reales aparecieron **tres métodos
inexistentes** en el adaptador, todos respondiendo «InvalidApiPath»:

| Se llamaba a                           | Correcto                           |
| -------------------------------------- | ---------------------------------- |
| `aliexpress.ds.order.get`              | `aliexpress.ds.trade.order.get`    |
| `aliexpress.ds.logistics.tracking.get` | `aliexpress.ds.order.tracking.get` |
| `aliexpress.ds.order.cancel`           | **no existe ninguno**              |

Eran nombres plausibles escritos a partir de su documentación, y las pruebas no
los delataban porque respondían con lo que el propio adaptador pedía. Ahora hay
una prueba que fija los nombres verificados.

**AliExpress no permite cancelar pedidos por API**: se probaron todas las
variantes y ninguna existe. La capacidad estaba declarada como disponible, así
que el motor lo habría intentado y habría fallado justo cuando un cliente pide
anular. Ahora se declara que no y el panel explica que hay que cancelar a mano
desde la cuenta de AliExpress.

### Lo que sigue sin poder validarse

`ds.product.get`, `ds.order.create`, `ds.order.get` y el seguimiento necesitan
el token de autorización. Sus respuestas grabadas
(`packages/suppliers/src/adapters/respuestas-grabadas/`) siguen construidas a
partir de su documentación; la de categorías ya es real. **Cuando autorices, hay
que volver a grabar las demás**: la primera llamada real ya destapó que el
resultado viene envuelto en `resp_result`, cosa que su documentación no dice y
que dejaba toda importación devolviendo vacío.

---

## 3 · GPU para el estudio de imágenes (Fase 4)

El pipeline de IA necesita una GPU con al menos 12 GB de VRAM. Opciones:

- **RunPod Serverless** — se paga por segundo, ideal para importaciones masivas.
  Es lo recomendado para empezar.
- GPU dedicada en el VPS — sale a cuenta solo con volumen constante.
- Vast.ai — más barato, menos fiable.

**Sin esto:** el código de orquestación se puede escribir y probar contra un
ComfyUI local, pero sin GPU no hay forma de generar una imagen real.

**Decisión tomada (2026-07-25): sí habrá categorías +18.** Consecuencias que ya
están incorporadas a la planificación:

- **Verificación de edad obligatoria.** Pasa a ruta crítica antes del
  lanzamiento: vender productos para adultos sin control de edad es sanción
  directa, no una mejora opcional.
- **La IA de imágenes necesita GPU propia.** Los servicios gestionados
  (OpenAI, Midjourney, Ideogram) rechazan ese contenido por política, así que
  queda descartado el camino barato: hace falta ComfyUI con modelos sin filtro
  sobre GPU propia o alquilada.
- **Cuidado con las pasarelas.** Stripe y PayPal restringen contenido adulto y
  pueden cerrar la cuenta sin previo aviso. Que NOWPayments sea la pasarela
  principal juega a favor aquí, pero conviene leer sus condiciones antes de
  contratar y no depender de una sola.
- **Marketing limitado.** Google Shopping y Meta Ads bloquean estos productos.
  El SEO orgánico y el email pasan a ser el canal principal, no un complemento
  — hay que tenerlo en cuenta al planificar la fase 11.

---

## 4 · IVA transfronterizo · dos datos y dos altas

El cálculo está hecho y probado, pero depende de tres cosas que solo tú puedes
poner:

**1. De dónde envía cada proveedor.** En Admin → Proveedores, campo «Envía
desde». Es lo que decide si una venta es interior o una importación, y viene
con «ES» por defecto: un proveedor chino marcado como español factura IVA
español a una importación y el cliente acaba pagando el IVA dos veces —una a
nosotros y otra en la aduana.

**2. Alta en IOSS**, si quieres cobrar el IVA en el checkout en los envíos de
hasta 150 € que entran de fuera de la UE. Sin ella, el paquete se para en
aduana y el cliente paga allí el IVA más los gastos de gestión del
transportista (entre 10 y 20 € en la mayoría de los casos, por un pedido de
30 €). Es la primera causa de paquetes rechazados en la entrega. Se solicita en
la Agencia Tributaria y da un número que va en Ajustes → IVA transfronterizo.

**3. Alta en OSS**, antes de cruzar los 10.000 € de ventas a otros países de la
UE. El panel de Informes avisa al llegar al 80 %. Ojo con el orden: pasado el
umbral la venta tributa en el país del cliente **estés dado de alta o no**, así
que si el alta llega tarde el IVA se ha cobrado igual pero no hay dónde
declararlo. Se pide en la sede de la AEAT (modelo 035) y se declara cada
trimestre con el 369, que sale ya montado en Informes → Ventanilla única.

**Mientras vendas solo en España** —que es el plan de arranque— nada de esto
hace falta: la única zona de envío configurada es España y el 21 % de siempre
es lo correcto. Se vuelve obligatorio el día que actives una zona de la UE.

---

## 5 · Traductor automático · decisión pendiente

Las fichas del proveedor vienen en inglés (o en un inglés raro traducido del
chino). El sistema ya las traduce e **deja la propuesta en una cola de revisión**
—Admin → Traducciones— sin publicar nada hasta que la apruebas. Lo único que
falta es decidir con qué motor:

| Motor                   | Coste                                                 | Calidad ES/CA/EN                             | Qué hace falta                                     |
| ----------------------- | ----------------------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| **DeepL** (recomendado) | 500.000 caracteres/mes gratis, luego desde 5,49 $/mes | La mejor con diferencia                      | Una clave en `TRANSLATION_API_KEY`                 |
| LibreTranslate          | Gratis si lo alojas tú                                | Aceptable en descripciones, floja en títulos | Un contenedor propio y su URL                      |
| Ninguno (actual)        | —                                                     | —                                            | Nada: la ficha se queda en el idioma del proveedor |

Con 500.000 caracteres al mes entran unas **mil fichas**, que para empezar
sobra. DeepL no tiene catalán: esas traducciones se piden en español y quedan
en la cola para repasarlas, que es más rápido que escribirlas de cero.

**Mientras no decidas nada** la tienda funciona: las fichas se quedan en su
idioma original y la tienda cae a ese idioma cuando falta una traducción. Es
peor para el SEO en catalán e inglés, pero no rompe nada.

**Se activa desde Admin → Integraciones**: pegas la clave, pulsas activar y
listo. Sin tocar el servidor ni reiniciar nada.

---

## 6 · Datos fiscales de la empresa

Para la facturación conforme (Fase 12) hacen falta: razón social, NIF,
domicilio fiscal y serie de facturación. Van en los ajustes del admin, pero
sin ellos no se puede emitir una factura válida.

**Verifactu:** conviene confirmar con tu asesor la fecha exacta en que te
aplica la obligación, porque condiciona el formato de la factura.

---

## 7 · Correo saliente · Resend (decidido)

**Decisión tomada (2026-07-26): Resend.**

Sin un servicio de envío, las confirmaciones de pedido salen desde el propio
servidor y acaban en spam. Un cliente que paga y no recibe confirmación escribe
a soporte o pide la devolución: es de lo que más ruido genera al arrancar.

**Qué necesito de ti cuando llegue el despliegue:**

1. Cuenta en [resend.com](https://resend.com) — 3.000 correos/mes gratis, luego
   desde 20 $/mes.
2. Verificar el dominio en su panel, que da tres registros DNS que hay que
   añadir: **SPF**, **DKIM** y **DMARC**. Sin los tres, la entregabilidad es
   mala aunque el envío funcione.
3. La clave de API (`re_...`).

Se configura en **Admin → Integraciones → Correo saliente**, con estos valores:

| Campo      | Valor                              |
| ---------- | ---------------------------------- |
| Servidor   | `smtp.resend.com`                  |
| Puerto     | `465`                              |
| Usuario    | `resend`                           |
| Contraseña | la clave `re_…`                    |
| TLS        | activado                           |
| Remitente  | `Tu Tienda <pedidos@tudominio.es>` |

**Cuidado con el remitente:** tiene que ser del dominio verificado. Con un
`@gmail.com` los correos se rechazan directamente. El botón «Probar conexión»
confirma que el servidor responde antes de que salga el primer pedido.

---

## 8 · VPS y dominio

Decidido el 2026-07-29: **DigitalOcean**, un droplet de 4 vCPU / 8 GB / 160 GB
con Ubuntu 24.04 LTS en un centro de datos de la UE (Frankfurt o Ámsterdam).
Solo producción de momento; el dominio ya está contratado y con acceso al DNS.

### Lo que ya está escrito y probado

Todo el despliegue está hecho y verificado hasta donde se puede sin la máquina:

- `apps/*/Dockerfile` — las tres imágenes se construyen y arrancan de verdad
  (panel 96 MB, tienda 395 MB, API 1,09 GB). La API levanta en modo producción,
  conecta con Postgres y Redis y responde en `/health`.
- `docker-compose.prod.yml` — Traefik con SSL automático, red interna sin
  salida para los datos, límites de memoria y de logs. `docker compose config`
  valida.
- `.github/workflows/deploy.yml` — construye, publica en GHCR, migra, releva
  sin caída y revierte solo si la comprobación posterior falla.
- `scripts/preparar-servidor.sh` — endurecimiento completo del servidor.
- `scripts/desplegar.sh` — relevo sin caída y `--rollback`.
- `DESPLIEGUE.md` — el manual de operación.

### Qué falta y depende de ti

1. Crear el droplet **con tu clave SSH** (nunca con contraseña de root).
2. Apuntar los registros DNS `@`, `www`, `api`, `admin` y `media` a su IP.
3. Añadir el acceso en `~/.ssh/config` de la máquina de trabajo.
4. Generar el `.env` de producción **en el servidor** con `openssl rand`.
5. Poner los secretos del CI en GitHub (los pega el usuario en la web, no
   viajan por ningún otro sitio).

**Antes de pagar:** comprobar la política de contenido adulto de DigitalOcean.
El catálogo es +18 y las condiciones varían por proveedor; enterarse después
del lanzamiento significa cuenta suspendida con la tienda vendiendo.

**Lo que queda a medias por no tener servidor todavía:** los despliegues de
vista previa. Las pruebas de extremo a extremo ya se ejecutan en cada pull
request, pero contra la pila que CI levanta en el propio runner, no contra un
entorno desplegado. Apuntarlas a un preview es poner `E2E_TIENDA` y `E2E_API`;
lo que falta es el sitio al que apuntar.

---

## 9 · Cuenta de anunciante en ExoClick (Studio, fase D)

El Studio ya fabrica los banners y los exporta validados contra el catálogo de
formatos, así que **se puede trabajar sin esto**: se exporta y se sube a mano al
panel de la red, como haría cualquiera.

Lo que hace falta para cerrar el círculo es una cuenta de anunciante con
presupuesto:

| Qué                  | Para qué                                                      |
| -------------------- | ------------------------------------------------------------- |
| Cuenta de anunciante | Subir creatividades y comprar tráfico                         |
| Clave de su API      | Publicar desde el Studio y traerse impresiones, clics y gasto |
| Presupuesto          | Sin campañas corriendo no hay nada que medir                  |

**Sin esto:** el `utm_content` por creatividad ya viaja hasta el pedido, así que
en cuanto haya una venta desde un banner se sabrá cuál lo trajo aunque la
campaña se haya montado a mano en su panel. Lo que falta es el gasto —habría que
teclearlo— y la publicación automática.

**Un aviso sobre los formatos:** las cifras de peso y tamaño del catálogo se
comprobaron el 09-08-2026 contra la documentación de ExoClick, y las de las
otras redes salen de guías de terceros que no coinciden entre sí. Antes de la
primera campaña grande conviene confirmarlas en el panel de la red: una tanda
entera rechazada por un peso que cambió es un día perdido en su cola de
revisión. El propio Studio marca los formatos sin revisar desde hace más de seis
meses y los que vienen de fuente no oficial.

---

## Qué SÍ se puede hacer sin nada de lo anterior

Todo el backend (catálogo, pedidos, usuarios, proveedores vía adaptador
simulado), las dos aplicaciones de frontend completas, el diseño, los idiomas,
el tema claro/oscuro, la marca configurable y los tests. Es la mayor parte del
trabajo.

---
