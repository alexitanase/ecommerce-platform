# Despliegue

De `main` al servidor sin pasos manuales, y cómo montar el servidor la primera
vez.

**Estado a 29-07-2026:** la pila está desplegada y funcionando en producción
sobre `chispaynoche.com` (DigitalOcean, 4 vCPU / 8 GB, Ubuntu 24.04). Los nueve
contenedores arrancan sanos, las migraciones están aplicadas y los cinco
dominios responden a través de Cloudflare. Ese primer despliegue se hizo **a
mano**, pasando las imágenes por SSH, porque el repositorio todavía no está en
GitHub: el flujo automático de este documento queda escrito y validado, pero no
se habrá ejecutado de verdad hasta que exista el repositorio.

---

## Cómo funciona

```
   git push a main
        │
        ▼
   CI (lint · tipos · tests · e2e)          ← si falla, aquí se acaba
        │  al terminar bien
        ▼
   Despliegue
        ├─ construye 4 imágenes en GitHub Actions   (no en el servidor)
        ├─ las publica en ghcr.io
        ├─ por SSH: migra la base de datos          ← si falla, nada se toca
        ├─ releva api → tienda → panel, uno a uno   ← sin caída
        ├─ reinicia los workers
        └─ comprueba desde fuera que responden
              └─ si no responden: vuelve sola a la versión anterior
```

**Las imágenes se construyen en CI y no en el servidor.** Compilar Next y Nest
se lleva dos gigas de RAM; hacerlo en el VPS ralentiza la tienda justo mientras
se despliega y obliga a pagar una máquina más grande de la que hace falta para
servir.

**Las migraciones van antes que el código nuevo** y tienen que ser compatibles
hacia atrás: durante el relevo conviven un minuto la versión vieja y la nueva
contra el mismo esquema. Añadir columnas sí; renombrar o borrar, en dos
despliegues.

---

## Detrás de Cloudflare

La tienda vive detrás de Cloudflare en modo **Flexible**: el cifrado lo pone
Cloudflare de cara al cliente y hasta el servidor llega HTTP plano. De ahí tres
consecuencias que están ya resueltas en la configuración y conviene no
deshacer sin querer:

1. **El origen no redirige a HTTPS.** Si lo hiciera, Cloudflare volvería a
   pedir por HTTP y el origen a redirigir: bucle infinito. Es el fallo clásico
   del modo Flexible.
2. **La IP real del cliente se recupera en tres saltos.** Cloudflare la pone en
   `X-Forwarded-For`; Traefik solo se fía de los rangos de Cloudflare; y nginx
   los tiene declarados como fiables para no quedarse con la IP del borde.
   Comprobado de punta a punta: en los registros aparece la IP del visitante,
   no la de Cloudflare. Si no fuera así, el limitador de peticiones bloquearía
   a toda la tienda de golpe y el control de riesgo de pedidos se quedaría
   ciego.
3. **El puerto 80 debe estar abierto solo a Cloudflare**
   (`scripts/cortafuegos-cloudflare.sh`). Sin eso, cualquiera que conozca la IP
   entra sin cifrado, sin WAF y falsificando la cabecera de IP del cliente.

**Sobre el modo Flexible.** Entre Cloudflare y el servidor viaja todo en claro:
contraseñas, cookies de sesión y direcciones de clientes. Pasar a **Full
(strict)** es gratis —un certificado de origen de Cloudflare dura 15 años— y
solo pide: montar el certificado, descomentar el bloque `websecure` del
compose y cambiar los `entrypoints` de los routers de `web` a `websecure`.

---

## Primera vez

### 1 · Servidor

Un droplet de DigitalOcean **4 vCPU / 8 GB / 160 GB**, Ubuntu 24.04 LTS, en
Frankfurt o Ámsterdam (que esté en la UE ahorra documentar transferencias
internacionales de datos), creado **con tu clave SSH**, nunca con contraseña.

```bash
scp scripts/preparar-servidor.sh root@IP:/root/
ssh root@IP 'bash /root/preparar-servidor.sh'
```

Ese guion deja el servidor con: usuario `tienda` sin privilegios, Docker,
cortafuegos con solo 22/80/443, SSH sin contraseñas y sin root, fail2ban,
actualizaciones de seguridad automáticas, 2 GB de intercambio, límites de log y
la copia de seguridad diaria programada. Es idempotente: se puede repetir.

Comprueba que puedes entrar como `tienda` **antes de cerrar la sesión de root**.

### 2 · DNS

Cuatro registros `A` apuntando a la IP del droplet:

| Nombre  | Para qué                           |
| ------- | ---------------------------------- |
| `@`     | la tienda                          |
| `www`   | la tienda (Traefik lo sirve igual) |
| `api`   | la API                             |
| `admin` | el panel                           |
| `media` | las imágenes de producto           |

Con Cloudflare por delante, los certificados los emite él: aquí no se pide
ninguno. Lo que sí hace falta es que los cinco registros estén en modo proxy
(la nube naranja), porque toda la configuración de IP real depende de que el
tráfico pase por Cloudflare.

### 3 · Secretos del servidor

```bash
ssh tienda@IP
cd /opt/tienda
# La plantilla está en el repositorio: .env.produccion.example
nano .env          # genera cada valor con: openssl rand -base64 48
chmod 600 .env
```

Se generan **en el servidor**. Ni en un portátil, ni en un chat, ni en un gestor
de notas. La única que conviene guardar aparte es `ENCRYPTION_KEY`: si se
pierde, hay que volver a configurar todas las integraciones del panel.

### 4 · Secretos de GitHub

En **Settings → Secrets and variables → Actions**:

| Secreto             | Qué es                                                   |
| ------------------- | -------------------------------------------------------- |
| `SSH_HOST`          | IP del droplet                                           |
| `SSH_USUARIO`       | `tienda`                                                 |
| `SSH_CLAVE`         | clave privada **exclusiva del CI** (no la tuya personal) |
| `SSH_HOST_KEY`      | salida de `ssh-keyscan IP` — fija la huella del servidor |
| `SENTRY_AUTH_TOKEN` | opcional, para subir los mapas de código                 |

Y como **variables** (no son secretos): `DOMINIO`, `DOMINIO_API`,
`DOMINIO_ADMIN`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`.

La clave del CI se crea con `ssh-keygen -t ed25519 -f ci -N ''`, la parte
pública va al `authorized_keys` del usuario `tienda` y la privada se pega en
GitHub. Así se puede revocar el acceso del CI sin tocar el tuyo.

`SSH_HOST_KEY` no es opcional por comodidad: sin fijar la huella, el despliegue
aceptaría cualquier servidor que responda a esa IP.

### 5 · Cuenta de propietario

La base arranca **sin ningún usuario**: los del seed llevan la contraseña
escrita en el repositorio y en producción serían dos puertas con la llave
puesta. La cuenta real se crea tecleando la contraseña en el momento, que así
no queda ni en una variable de entorno ni en el historial:

```bash
ssh -t tienda@IP
cd /opt/tienda
docker compose -f docker-compose.prod.yml --env-file .env \
  run --rm -it migrador node_modules/.bin/tsx prisma/crear-propietario.ts
```

El `-t` del ssh y el `-it` del compose no son adorno: sin terminal interactiva
el guion se niega a leer la contraseña a ciegas.

Antes de eso, la referencia (permisos, roles, ajustes, páginas legales y zonas
de envío) se siembra con:

```bash
docker compose -f docker-compose.prod.yml --env-file .env \
  run --rm -e NODE_ENV=production migrador node_modules/.bin/tsx prisma/seed.ts
```

Con `NODE_ENV=production` el seed omite los usuarios de ejemplo a propósito.

**Y hay que volver a sembrar cada vez que una versión trae permisos nuevos.**
Los permisos son filas, no esquema, así que las migraciones no los crean: sin
sembrar, el permiso no existe en la base, no lo tiene nadie —tampoco el
propietario, que los recibe todos— y la pantalla nueva devuelve 403 sin decir
por qué. Le pasó al Studio: las tablas estaban y la sección no se veía.

Para eso está la opción, que lo hace después de migrar y antes de relevar:

```bash
./scripts/desplegar-desde-local.sh --sembrar
```

No va por defecto porque el seed reconstruye los permisos de cada rol de
sistema: si alguno se ha ajustado a mano desde Equipo, sembrar lo devuelve a lo
declarado en el código. Lo demás —ajustes de marca, textos legales, zonas de
envío— solo se crea si falta, nunca se pisa.

### 6 · Correo saliente

**Sin esto la tienda no manda ni un correo, y no falla nada por fuera.** Ni la
confirmación del pedido, ni el aviso de envío, ni recuperar contraseña: el
pedido se cobra y se sirve igual, el cliente simplemente no recibe nada. Es la
única pieza cuya ausencia no se nota hasta que alguien la echa de menos, y en
esta tienda pasó exactamente eso.

Hace falta un servicio de envío —Resend, Brevo, Postmark— porque un SMTP casero
acaba en spam. Con las credenciales que te dé, rellena en el `.env` del
servidor:

```
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=...
SMTP_SECURE=false
MAIL_FROM=Chispa&Noche <no-reply@tudominio.es>
```

O lo mismo desde el panel: **Ajustes → Integraciones → Correo saliente**, y ahí
mismo «Probar conexión», que lo verifica contra el servidor de verdad.

Si en vez de un servicio de envío se usa un buzón normal —Arsys, Ionos, OVH—, el
puerto es el **465**, no el 587:

```
SMTP_HOST=smtp.tuproveedor.com
SMTP_PORT=465
SMTP_USER=administrador@tudominio.es
SMTP_PASSWORD=...
```

El cifrado no hay que tocarlo: lo decide el puerto. El 465 va cifrado desde el
primer byte y el 587 empieza en claro y se cifra a mitad, y **mezclarlo no da un
error: deja la conexión colgada** hasta que salta el tiempo de espera. Ese
plantón parece un cortafuegos o un servidor caído —el mismo buzón sigue
funcionando desde el móvil— y es la causa más habitual de un «timeout» al
configurar el correo.

Dos cosas que se olvidan y hacen que los correos salgan pero no lleguen:

- **El remitente tiene que ser del dominio verificado** en el servicio. Con un
  `@gmail.com` se rechazan de entrada.
- **SPF, DKIM y DMARC en el DNS.** Sin ellos, Gmail y Outlook los mandan a spam
  aunque el envío sea correcto. El servicio te da los registros que hay que
  añadir en Cloudflare.

Si algo va mal, el panel lo dice solo: cualquier correo que no salga deja el
motivo en Ajustes → Integraciones, sin tener que ir a mirar los registros del
servidor.

### 7 · Primer despliegue

Desde la pestaña Actions, «Despliegue» → _Run workflow_. El primer arranque
tarda más porque descarga las imágenes enteras; a partir del segundo solo baja
las capas que han cambiado.

---

## Variables nuevas: se aplican solas

`generar-env.sh` solo se ejecuta la primera vez, así que cuando un cambio
necesita una variable nueva el `.env` del servidor se queda corto. El
contenedor arranca igual y la funcionalidad simplemente no va: sin error, sin
aviso y sin nada que mirar en los logs.

De eso se encarga **`asegurar-env.sh`**, que corre en cada despliegue antes de
las migraciones. Solo **añade lo que falta**; nunca toca lo que ya está, tenga
el valor que tenga y aunque esté vacío. Deja una copia del `.env` antes de
escribir y dice por pantalla qué ha añadido.

**Por qué no se reejecuta `generar-env.sh`**, que sería lo evidente: porque
acuña diez secretos. Volver a lanzarlo cambiaría `POSTGRES_PASSWORD` —y la base
dejaría de aceptar la conexión—, los secretos de sesión —y se cerrarían todas
las sesiones abiertas— y, lo irreparable, `ENCRYPTION_KEY`: las credenciales de
AliExpress y de las pasarelas quedarían cifradas con una clave que ya no
existe. Eso no se recupera; hay que volver a configurarlo todo a mano.

Si falta un secreto crítico (`ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, los de
sesión), el despliegue **para** en vez de inventar uno nuevo. Un `.env` sin
`ENCRYPTION_KEY` no está desactualizado: está roto, y generar otra clave dejaría
la API arrancando tan tranquila con todas las credenciales ilegibles.

Para ver qué falta sin escribir nada:

```bash
ssh tienda@TU_SERVIDOR 'RAIZ_TIENDA=/opt/tienda bash /opt/tienda/asegurar-env.sh --revisar'
```

### Añadir una variable nueva

Se toca en **dos sitios**, y los dos hacen falta:

1. `scripts/generar-env.sh` — para las instalaciones nuevas.
2. `scripts/asegurar-env.sh`, en `NUEVAS` y en `ORDEN` — para las que ya existen.

## Subir el catálogo de un proveedor sin API

Dreamlove no tiene API: manda un XML con su catálogo entero y se sube desde
**Proveedores → su ficha → Subir catálogo**.

**Sube el ZIP tal cual te lo manden.** No hay que descomprimir nada: la
importación lee el XML de dentro del ZIP sobre la marcha. Y no es solo comodidad
—es la única vía que funciona en producción—: Cloudflare corta las subidas de
más de 100 MB en el plan gratuito y el XML de julio de 2026 pesa 342 MB, así que
sin comprimir la subida muere en el borde con un 413 antes de llegar al
servidor. En ZIP son 61 MB y pasa sin problema.

También se aceptan el `.xml.gz` y el `.xml` suelto, por si llega ya
descomprimido. Cuál es cuál se decide leyendo los primeros bytes del fichero y
no por su extensión, así que renombrarlo no engaña a nadie ni rompe nada.

```bash
# Solo si te lo mandaran sin comprimir y quisieras subirlo desde el navegador
gzip -k dreamlove.xml     # deja dreamlove.xml.gz junto al original
```

Dos detalles del funcionamiento:

- **La subida termina antes que el procesado.** La respuesta llega en cuanto el
  fichero está en disco; escribir los 12.913 artículos lleva unos segundos más
  y la pantalla lo va contando sola. Si se recarga a mitad, sigue enseñando el
  estado real: vive en la base de datos, no en el navegador.
- **Si el ZIP trae varios ficheros**, se coge el `.xml` más grande y se anota
  cuál en el historial (`dreamlove.zip › dreamlove.xml`). La carpeta `__MACOSX`
  que añaden los Mac al comprimir se ignora. Si no hay ningún XML dentro, la
  importación falla diciendo qué llevaba el ZIP y **no toca el catálogo
  anterior**.

Al terminar se sincroniza solo lo que ya vendemos de ese proveedor, así que los
precios y el stock nuevos llegan a la tienda sin tocar nada más. Lo que el
proveedor haya dejado de mandar queda marcado como retirado y deja de ofrecerse
para importar.

## El buscador se reconstruye solo cuando hace falta

Los listados de la tienda —la búsqueda, las páginas de categoría y todo lo que
lleve filtros— salen de Meilisearch, y ahí el orden lo decide un campo que se
guarda **con cada producto**, no un ajuste del índice. Cuando ese campo cambia
(por ejemplo, el que pone lo agotado al final), los documentos ya indexados se
quedan con la forma vieja: cambiar los ajustes no los reescribe.

No hay que hacer nada. Al arrancar, la API **le pide al índice unos documentos y
mira si llevan los campos de hoy**; si no, lo reconstruye por detrás y lo deja
anotado en el log:

```
[SearchService] El índice viene de una versión anterior: reconstruyéndolo por detrás.
[SearchService] Reindexados 947 productos
```

Mira los documentos y no los ajustes del índice a propósito, y esto importa: los
ajustes se escriben **antes** de reconstruir, así que quedan al día aunque la
reconstrucción se caiga a mitad. Comparándolos, un intento fallido no se volvía a
intentar nunca y el catálogo se quedaba medio migrado en silencio. Mirando los
documentos, el arranque siguiente lo ve y lo reintenta.

Mientras dura, la tienda sigue respondiendo con el orden de antes. También se
puede lanzar a mano contra `POST /api/v1/search/reindex` con un token con permiso
`products:write`.

### Si cambias la configuración de Postgres, Redis, Meilisearch o MinIO

El despliegue solo releva `api`, `storefront`, `admin` y `workers`: los servicios
de datos se quedan como están, a propósito, para que un despliegue no reinicie la
base de datos. Así que **un cambio en su bloque de `docker-compose.prod.yml` no
llega solo**. Después de desplegar, en el servidor:

```bash
cd /opt/tienda
docker compose -f docker-compose.prod.yml up -d meilisearch   # el que hayas tocado
```

Compose no hace nada si la configuración no ha cambiado, y lo recrea si sí.
Cuenta con unos segundos sin ese servicio.

## Día a día

| Qué                 | Cómo                                                    |
| ------------------- | ------------------------------------------------------- |
| Desplegar (con CI)  | `git push` a `main` (si CI pasa, se despliega solo)     |
| Desplegar (sin CI)  | `./scripts/desplegar-desde-local.sh`                    |
| Ver qué versión hay | `./scripts/desplegar-desde-local.sh --estado`           |
| Volver atrás        | `./scripts/desplegar-desde-local.sh --rollback`         |
| Logs de la API      | `docker compose -f docker-compose.prod.yml logs -f api` |
| Métricas y paneles  | túnel SSH (abajo)                                       |

### Desplegar desde tu portátil

Mientras no exista el repositorio en GitHub —y por tanto no haya CI/CD— el
despliegue se hace desde local. El guion construye las cuatro imágenes, las
manda por SSH y lanza en el servidor el `desplegar.sh` de siempre, que es quien
migra la base de datos y releva los contenedores de uno en uno.

```bash
# Lo normal: comprueba, construye, envía y despliega
./scripts/desplegar-desde-local.sh

# Una versión ya construida, sin volver a construirla
./scripts/desplegar-desde-local.sh --sin-construir v2026.07.30-10
```

Tres cosas que hace y conviene saber:

- **No despliega con las pruebas en rojo.** Ejecuta `lint`, `typecheck` y `test`
  antes de construir nada. Se salta con `--sin-pruebas`, y saltárselas es
  exactamente cómo llega a producción algo que no compila.
- **Manda ~600 MB** por SSH y tarda varios minutos. Si tienes `pv` instalado
  (`apt install pv`) verás la barra de progreso; si no, funciona igual pero
  parece que no avanza. **No cierres la terminal a mitad**: una transferencia
  cortada deja el servidor sin las imágenes y el despliegue no llega a empezar,
  que es lo de menos malo que puede pasar.
- **Comprueba desde fuera**, con Cloudflare y Traefik por medio, que los cuatro
  dominios responden y que el servidor dice estar sirviendo la versión que se
  acaba de mandar. Si algo falla, te recuerda el `--rollback`.

El servidor y el dominio salen de dos variables, por si algún día cambian:

```bash
SERVIDOR_TIENDA=tienda@1.2.3.4 DOMINIO=otrodominio.es ./scripts/desplegar-desde-local.sh
```

### Grafana y Prometheus

No se publican. Un Grafana abierto es el mapa completo de la operativa del
negocio, así que se llega por túnel:

```bash
ssh -L 3030:localhost:3030 -L 9090:localhost:9090 tienda@IP
docker compose -f /opt/tienda/docker-compose.prod.yml --profile observabilidad up -d
# y en tu navegador: http://localhost:3030
```

Van en un perfil aparte porque son ~700 MB de RAM que en un servidor de 8 GB
compiten con Postgres. Se levantan cuando hacen falta.

### Entrar a la base de datos

Postgres no publica ningún puerto: vive en una red interna de Docker. Un 5432
abierto a internet recibe intentos de acceso a las pocas horas, y no hay
contraseña que aguante eso indefinidamente. Para mirarlo hay tres caminos.

**Una consulta suelta**, sin instalar nada:

```bash
ssh -t tienda@IP 'cd /opt/tienda && docker compose -f docker-compose.prod.yml \
  --env-file .env exec postgres psql -U ecom -d ecom'
```

**Con cliente gráfico** (DBeaver, TablePlus, pgAdmin) o con Prisma Studio:

```bash
./scripts/tunel-bd.sh          # deja localhost:5433 apuntando a producción
```

El guion pregunta al servidor por la IP del contenedor y monta el reenvío hasta
ella. No hace falta publicar ningún puerto ni tocar la configuración de la
pila: SSH resuelve el destino en el servidor, y desde allí sí se llega. Con el
túnel abierto:

|            |                                             |
| ---------- | ------------------------------------------- |
| Servidor   | `localhost`                                 |
| Puerto     | `5433`                                      |
| Base       | `ecom`                                      |
| Usuario    | `ecom`                                      |
| Contraseña | `POSTGRES_PASSWORD` del `.env` del servidor |

```bash
# leer la contraseña, sin sacarla del servidor más de lo necesario
ssh tienda@IP "grep '^POSTGRES_PASSWORD=' /opt/tienda/.env | cut -d= -f2-"

# y con Prisma Studio, que enseña el esquema con sus relaciones
DATABASE_URL='postgresql://ecom:LA_CONTRASEÑA@localhost:5433/ecom' pnpm db:studio
```

**Sobre una copia, para trastear sin riesgo.** Es lo que conviene para explorar
o para probar una consulta que modifica datos:

```bash
ssh tienda@IP 'cd /opt/tienda && bash copia-seguridad.sh'
scp tienda@IP:/opt/tienda/copias/<fichero>.dump .
pg_restore -d postgresql://ecom:ecom_dev_password@localhost:5432/ecom_pruebas <fichero>.dump
```

Un `UPDATE` sin `WHERE` en producción no se deshace: lo único que hay es la
copia de las 4:15, que además todavía vive en el mismo disco.

### Copias de seguridad

El guion diario deja el volcado en `/opt/tienda/copias` a las 4:15. **Eso no es
una copia de seguridad todavía**: está en el mismo disco que la base, así que
no protege del caso más probable, que es perder el disco. Falta sacarlo fuera
(DigitalOcean Spaces, Backblaze B2 o un Storage Box) y **probar una
restauración de verdad** —`scripts/copia-seguridad.sh --verificar`—, porque una
copia que nunca se ha restaurado no se sabe si sirve.

---

## Cuando algo va mal

**El certificado no llega.** Mira `docker compose logs traefik`. Casi siempre es
DNS: el registro `A` todavía no ha propagado o apunta a otra IP. Let's Encrypt
limita a 5 fallos por hora y dominio, así que conviene comprobar el DNS con
`dig +short api.tudominio.es` antes de reintentar.

**El despliegue revierte solo.** Es lo que tiene que pasar si la comprobación
posterior falla. Los logs del paso «Comprobar que la tienda responde» dicen qué
URL devolvió qué; el fallo real suele estar en los logs del contenedor nuevo.

**La migración falla.** El despliegue se aborta sin tocar los contenedores en
servicio: la tienda sigue con la versión anterior. Se arregla la migración y se
vuelve a desplegar.

**No arranca la API y en los logs pone que una variable sigue con el valor de
ejemplo.** Es deliberado: la API se niega a levantar en producción con secretos
de ejemplo. Genera el valor de verdad en el `.env` del servidor.

**Sin espacio en disco.** `docker system df`. Cada despliegue deja imágenes
viejas; el guion limpia las de más de una semana, pero un catálogo grande en
MinIO también crece. `ncdu /var/lib/docker` lo enseña rápido.

---

## Lo que todavía no está

- **Copias fuera del servidor.** Hay volcado diario y guion de restauración;
  falta el destino remoto y una restauración probada de principio a fin.
- **Staging.** El workflow está preparado para dos entornos pero solo se ha
  activado producción, por decisión de prioridad: primero vender.
- **Despliegues de vista previa por rama.** Las pruebas de extremo a extremo ya
  corren en cada pull request contra la pila que CI levanta; apuntarlas a un
  entorno desplegado es cambiar dos variables cuando exista ese entorno.
