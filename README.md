# Plataforma de Ecommerce · Dropshipping

Tienda online con dropshipping multi-proveedor para el mercado español.
Español, catalán e inglés · NOWPayments como pasarela principal · tema claro/oscuro ·
marca configurable desde el panel de administración.

El plan completo de desarrollo y su progreso están en **[ROADMAP.html](./ROADMAP.html)** — ábrelo en el navegador.

---

## Puesta en marcha

Necesitas **Node 22+**, **pnpm 10+** y **Docker**.

```bash
cp .env.example .env      # revisa los valores si quieres cambiar puertos
pnpm install
pnpm docker:up            # levanta Postgres, Redis, Meilisearch, MinIO y Mailpit
node scripts/wait-for-services.mjs
pnpm db:migrate           # aplica el esquema
pnpm db:seed              # roles, permisos, ajustes y usuarios de prueba
```

O todo de una vez:

```bash
pnpm setup
```

Después, arranca la API:

```bash
pnpm --filter @ecom/api dev
```

### Comprobar que funciona

```bash
curl http://localhost:3001/health
curl http://localhost:3001/health/ready
```

---

## Servicios del entorno local

| Servicio          | URL                                     | Para qué sirve                              |
| ----------------- | --------------------------------------- | ------------------------------------------- |
| API               | http://localhost:3001                   | Backend NestJS                              |
| Documentación API | http://localhost:3001/docs              | Swagger UI (solo fuera de producción)       |
| OpenAPI           | http://localhost:3001/docs/openapi.json | Contrato para generar el SDK                |
| PostgreSQL        | `localhost:5432`                        | Base de datos principal                     |
| Redis             | `localhost:6379`                        | Caché, colas BullMQ y rate limiting         |
| Meilisearch       | http://localhost:7700                   | Buscador del catálogo                       |
| MinIO             | http://localhost:9000                   | Almacenamiento S3 (consola en :9001)        |
| Mailpit           | http://localhost:8025                   | Bandeja donde caen todos los emails locales |

### Credenciales de desarrollo

Creadas por el seed. **Solo válidas en local.**

| Cuenta        | Email                  | Contraseña   |
| ------------- | ---------------------- | ------------ |
| Administrador | `admin@tienda.local`   | `Admin1234!` |
| Cliente       | `cliente@tienda.local` | `Admin1234!` |

---

## Estructura

```
apps/
  api/           NestJS + Fastify · API REST y webhooks
packages/
  db/            Esquema Prisma, migraciones y cliente
  shared/        Tipos, esquemas Zod, dinero, IDs e idiomas
```

Cada área de negocio (catálogo, pedidos, pagos, proveedores, imágenes IA) entra
como módulo propio de Nest a medida que se desarrolla.

---

## Comandos

| Comando                          | Qué hace                                     |
| -------------------------------- | -------------------------------------------- |
| `pnpm dev`                       | Arranca todas las apps en modo desarrollo    |
| `pnpm build`                     | Compila todo el monorepo                     |
| `pnpm lint`                      | ESLint con reglas con tipos                  |
| `pnpm typecheck`                 | Comprobación de tipos sin emitir             |
| `pnpm test`                      | Tests unitarios (rápidos, sin Docker)        |
| `pnpm test:integracion`          | La API contra Postgres y Redis de verdad     |
| `pnpm test:cobertura`            | Todo lo anterior, midiendo y exigiendo suelo |
| `pnpm e2e`                       | Compra completa en un navegador real         |
| `pnpm e2e:navegadores`           | Descarga Chromium (una sola vez)             |
| `pnpm format`                    | Formatea con Prettier                        |
| `pnpm docker:up` / `docker:down` | Levanta o para los servicios                 |
| `pnpm docker:reset`              | Los borra y los vuelve a crear desde cero    |
| `pnpm db:migrate`                | Crea y aplica una migración                  |
| `pnpm db:seed`                   | Datos iniciales                              |
| `pnpm db:studio`                 | Explorador visual de la base de datos        |
| `pnpm db:reset`                  | Vacía la base de datos y la vuelve a sembrar |

---

## Los tres niveles de pruebas

**`pnpm test`** — unitarias. Lógica pura: cálculo de IVA, reparto de descuentos,
transiciones de estado, firma de webhooks. No tocan la red ni la base de datos,
tardan dos segundos y se ejecutan sin Docker delante.

**`pnpm test:integracion`** — la API entera contra Postgres y Redis. Levanta la
aplicación con sus guardas, su validación y sus servicios reales, y le manda
peticiones HTTP. Es donde se cazan los fallos que viven en la costura entre el
servicio y la base de datos, que son los que más caros salen: un número de
pedido que choca y deja al cliente sin poder comprar, un aviso de cobro
falsificado que llega hasta el `UPDATE`, un secreto que se devuelve al panel.

Necesita la pila levantada y una base propia, que se crea una vez:

```bash
pnpm docker:up
docker exec ecom-postgres createdb -U ecom ecom_test
DATABASE_URL="$DATABASE_URL_TEST" pnpm --filter @ecom/db exec prisma migrate deploy
pnpm test:integracion
```

Vacía **todas** las tablas entre casos, así que va contra `ecom_test` y contra el
índice 1 de Redis, nunca contra los de desarrollo. Si falta `DATABASE_URL_TEST`
se niega a arrancar en lugar de adivinar.

**`pnpm e2e`** — un navegador real, descrito abajo.

---

## Pruebas de extremo a extremo

Abren un navegador de verdad contra la tienda y la API en marcha y hacen lo que
haría un cliente. Necesitan la pila levantada:

```bash
pnpm e2e:navegadores      # solo la primera vez
pnpm dev                  # en otra terminal: API y tienda
pnpm e2e
```

Son pocas y solo del camino crítico —portada, ficha, carrito, checkout, pedido—
a propósito: una suite lenta que nadie mira no protege nada. Se ejecutan en
escritorio y en móvil, porque la mitad del tráfico entra desde el móvil y es
donde se rompen los formularios.

Hay un tercer proyecto, **`admin`**, para el panel: entrar, buscar en el
catálogo de un proveedor, cambiar un precio y comprobar que persiste, el
listado de pedidos, el tablero, las devoluciones y la marca. Va aparte porque
es otra aplicación en otro puerto (`E2E_ADMIN`, por defecto `localhost:5174`) y
no se prueba en móvil: quien cuadra precios lo hace desde un escritorio.

**Crean pedidos de verdad** en la base de datos de desarrollo, con correos
`e2e.<marca>@tienda.local` para poder distinguirlos y borrarlos.

### Accesibilidad, automatizada

`accesibilidad.spec.ts` pasa **axe** por las páginas del camino de compra en
**tema claro y oscuro**, contra las reglas WCAG 2.1 A y AA —que es lo exigible
por el RD 193/2023 y la EN 301 549, no una recomendación—. Los dos temas por
separado porque no son una inversión de colores: tienen paletas distintas y una
puede cumplir mientras la otra no. Ya pasó aquí.

Cubre además dos cosas que axe no mide, porque analiza el DOM y no el recorrido:
que se llegue al carrito solo con el tabulador y que el foco se vea siempre.

### Regresión visual

```bash
pnpm e2e:visual              # compara con las capturas de referencia
pnpm e2e:visual:actualizar   # las regenera tras un cambio intencionado
```

**Se ejecuta dentro del contenedor oficial de Playwright**, y no es un capricho:
la tienda usa la tipografía del sistema, así que el mismo texto se dibuja
distinto en cada máquina y una captura hecha en un portátil no coincidiría en
CI ni con la página intacta. Dentro de la imagen el resultado es idéntico en
todas partes.

Las capturas de referencia **se versionan** —son el contrato visual— y se
comparan con un 1 % de tolerancia, que absorbe el ruido del antialiasing sin
dejar pasar un bloque desplazado o un color cambiado. Las fotos de producto se
tapan: vienen del proveedor y cambian al resincronizar el catálogo.

Si un cambio de diseño es intencionado, `pnpm e2e:visual:actualizar` y se
revisan las imágenes nuevas en el pull request, que es donde se ve de un
vistazo qué ha cambiado.

---

Apuntan a `localhost` salvo que se diga otra cosa con `E2E_TIENDA` y `E2E_API`.
Es lo que hará falta el día que haya despliegues de vista previa: la misma suite
contra la URL del preview, sin tocar nada más.

---

## Qué bloquea un merge

CI ejecuta tres trabajos —calidad, compra de extremo a extremo y auditoría de
dependencias— y un cuarto, **«Todo en verde»**, que solo pasa si los tres han
terminado bien. Ese cuarto es el único que hay que marcar como obligatorio en
la protección de rama de GitHub:

> Settings → Branches → Add rule → `main` → _Require status checks to pass_ →
> **Todo en verde**

Se hace así, y no marcando los tres, porque una comprobación que se salta o se
cancela cuenta como aprobada en GitHub. «Todo en verde» mira el resultado de
cada uno y falla si alguno no es `success`; además, añadir un job nuevo no
obliga a acordarse de registrarlo en los ajustes.

### El umbral de cobertura

`pnpm test:cobertura` mide todo el código fuente —no solo los ficheros que
algún test importa— y falla si un paquete baja de su suelo. Los suelos están
en cada `vitest.config.ts` y hoy son bajos: en la API, el 35 %.

Son **un suelo, no un objetivo**. No dicen que el código esté bien probado:
dicen «no bajes de donde estábamos», que es lo único que un porcentaje puede
garantizar. Se suben al añadir pruebas; no se bajan para que pase el pipeline.
Si un cambio los hace fallar, la respuesta es escribir la prueba que falta.

En la API el umbral se comprueba sobre las unitarias **y** las de integración
juntas: por separado, las unitarias cubren un 14 % porque casi todo lo demás
son servicios que necesitan base de datos. `test:cobertura` guarda el informe
en bruto de cada suite y los fusiona antes de mirar el porcentaje.

---

## Decisiones de diseño

Estas elecciones tienen motivo; conviene conocerlo antes de cambiarlas.

**Importes en céntimos, siempre enteros.** Ningún precio se guarda ni se opera
como `float`. En coma flotante `0.1 + 0.2 !== 0.3`, y en una plataforma que
factura eso acaba en un descuadre de un céntimo en la factura de un cliente.
Las utilidades están en `packages/shared/src/money.ts`.

**IDs cuid2, no autoincrementales.** No filtran el volumen de negocio (nadie
puede contar nuestras ventas mirando el número de su pedido) y se generan en la
aplicación antes de tocar la base de datos, que es lo que necesita el patrón
outbox para crear entidad y evento en la misma transacción.

**TypeScript fijado en 5.9.3.** TypeScript 7 ya está publicado, pero
`typescript-eslint` solo admite `<6.1.0`: subir ahora deja el proyecto sin lint.
Se actualizará cuando el ecosistema acompañe.

**Validación solo con Zod.** Los mismos esquemas validan la entrada y generan la
documentación OpenAPI (vía `nestjs-zod`), así que no pueden desincronizarse.
Por eso no usamos `class-validator`.

**El IVA lo decide el envío, no el pedido.** Un pedido puede salir de tres
sitios a la vez, y el régimen es de cada envío: el límite de 150 € del IOSS se
mide por paquete, así que dos de 100 € que llegan por separado caben los dos
aunque el pedido sume 200 €. El régimen que se aplicó se congela en el pedido
(`taxRegime`, `taxCountry`, `taxThresholdCents`) porque depende del umbral
acumulado en ese momento: recalcularlo en el trimestre daría otro número y la
declaración no cuadraría con las facturas ya entregadas.

**El precio anunciado no cambia con el país.** Vendiendo a Dinamarca al 25 % en
vez de al 21 % español, el cliente paga lo mismo y lo que cambia es el reparto
entre base y cuota —el margen, por tanto—. La alternativa, mantener la base y
subir el precio por país, obligaría a enseñar precios distintos antes de saber
a dónde se envía, que es justo lo que la transparencia de precios prohíbe.

**La paleta se decide midiendo el contraste.** Los tonos de texto están
elegidos por su relación de contraste sobre el fondo más desfavorable en el que
aparecen, no por cómo quedan: `--texto-tenue` era un gris de 2,5:1 —la mitad de
lo que exige el nivel AA— y se usaba en toda la letra pequeña de la tienda y del
panel. `apps/storefront/src/lib/contraste.spec.ts` comprueba la paleta entera en
cada ejecución de las pruebas, así que bajar un tono vuelve a fallar en rojo.

**Los colores de marca se filtran antes de inyectarlos.** Van dentro de un
`<style>` del layout, así que solo se admite `#rgb` o `#rrggbb`, tanto al
guardarlos en la API como al pintarlos. Un valor libre ahí no es un fallo de
formato: permitiría cerrar la etiqueta y ejecutar JavaScript en el navegador de
todos los visitantes a quien solo tuviera permiso para cambiar el logo.

**El service worker no cachea nada que pueda mentir.** Las páginas van siempre
a la red primero y solo se sirve la copia guardada si no hay conexión; la API
—precios, stock, carrito, sesión— no se cachea nunca. Y el checkout, la cuenta,
el pedido y las preferencias no se guardan en absoluto: la caché sobrevive al
cierre de sesión, así que en un ordenador compartido el siguiente que lo use
podría abrirlas sin conexión. Las reglas se comprueban en
`apps/storefront/src/lib/sw-reglas.spec.ts` leyendo el fichero real.

**Los servicios externos se configuran en el panel, no en el servidor.**
Pasarelas de pago, correo saliente, almacenamiento de imágenes, buscador,
traductor, acceso con Google o Apple y el estudio de imágenes con IA viven en
Ajustes → Integraciones, con las credenciales cifradas (AES-256-GCM) y sin
volver a mostrarse. Cada una tiene un botón que la prueba contra el servicio
real: unas credenciales mal copiadas no fallan al guardarlas, fallan con el
primer cliente.

En el `.env` solo queda lo que hace falta para arrancar —base de datos, Redis,
secretos de sesión, la clave de cifrado y las URL de las tres aplicaciones—,
porque se lee antes de poder consultar la base de datos. La excepción son
Sentry y las trazas: se inician antes que la aplicación, precisamente para
capturar un fallo de arranque.

El criterio: cambiar de pasarela o poner la clave del traductor es una decisión
de quien lleva la tienda, y no puede depender de que alguien edite un fichero en
el servidor y reinicie. **Lo que no está configurado y activo no se carga ni se
ofrece**: la pasarela no aparece en el checkout, el botón de "entrar con Google"
no se pinta, los correos se registran en el log en vez de fallar y el buscador
devuelve vacío mientras el catálogo se sigue navegando por categorías. La
excepción es el almacenamiento: sin él no se pueden guardar las fotos, así que
falla con un mensaje que dice qué configurar en vez de degradarse. En el primer
arranque, lo que hubiera en el entorno se importa al panel para no dejar una
tienda en marcha sin cobros.

**Un proveedor sin API cabe detrás del mismo contrato.** Dreamlove no tiene
endpoints: manda un XML de unos 340 MB con sus 12.913 artículos y los pedidos se
hacen a mano en su web. En vez de abrirle un camino aparte, se implementa
`SupplierAdapter` como cualquier otro y se declara lo que NO sabe hacer en
`capacidades`. El importador, el motor de precios y la sincronización funcionan
sin enterarse; el motor de pedidos consulta `capacidades.crearPedido` y, al
verlo en falso, deja la compra en la cola del panel con los códigos listos para
copiar en lugar de intentarlo y marcar el pedido como fallido —que con este
proveedor sería _todos_ los pedidos—. El catálogo se sube desde la ficha del
proveedor —en el ZIP en que lo mandan, sin descomprimir nada a mano—, se procesa
en streaming (los 342 MB del XML en unos cinco segundos, leyéndolo de dentro del
ZIP sin dejarlo en disco) y se guarda en `supplier_catalog_items`, que es contra
lo que busca el importador. Dos detalles suyos que están en el código y no en la
intuición: cada color es un producto independiente unido por `item_group_id`
—se reagrupan en uno con variantes— y los portes que trae cada ficha son del
PEDIDO, no del artículo, así que repercutirlos por línea subiría todos los PVP
en el importe entero del envío.

**Sondas de salud separadas.** `/health/live` dice si el proceso está vivo y
`/health/ready` si puede atender tráfico. Si Postgres cae, la API debe salir del
balanceador pero **no** reiniciarse: reiniciarla cada diez segundos no arregla la
base de datos y solo añade ruido. Ambas sondas tienen tiempo límite, porque el
cliente de Redis se configura con `maxRetriesPerRequest: null` (lo exige BullMQ)
y sin ese límite un Redis caído dejaría la sonda colgada para siempre en vez de
responder «no disponible».
