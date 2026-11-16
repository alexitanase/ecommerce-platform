# Plan de recuperación

Qué hacer cuando algo se ha perdido. Escrito para leerse con prisa y nervios,
así que va en orden de ejecución y sin rodeos.

## Objetivos

| Concepto                               | Objetivo | Cómo se consigue                        |
| -------------------------------------- | -------- | --------------------------------------- |
| **RPO** — datos que se pueden perder   | ≤ 5 min  | WAL archivado de forma continua (PITR)  |
| **RTO** — tiempo hasta volver a vender | ≤ 1 h    | Copia diaria + restauración en paralelo |
| Retención de copias                    | 30 días  | `BACKUP_RETENTION_DAYS`                 |
| Prueba de restauración                 | Semanal  | `--verificar` los domingos              |

El RPO de 5 minutos es lo que separa "hemos perdido los pedidos de la última
hora" de "no hemos perdido ninguno". En una tienda, un pedido perdido es un
cliente al que se le ha cobrado y no va a recibir nada.

## Qué se copia y qué no

| Dato                       | Cómo se recupera                                                        |
| -------------------------- | ----------------------------------------------------------------------- |
| Base de datos (PostgreSQL) | Copia diaria + WAL. **Es lo único insustituible.**                      |
| Imágenes de producto (S3)  | Versionado del bucket + réplica                                         |
| Índice de búsqueda (Meili) | No se copia: se regenera con `POST /api/v1/search/reindex`              |
| Redis (colas y caché)      | No se copia. La caché se rehace sola; las colas se recuperan del outbox |
| Ficheros de configuración  | En el repositorio, salvo `.env`                                         |

Redis no se copia a propósito, y esto es lo que lo hace seguro: **los eventos de
dominio se escriben en la tabla `outbox_events` dentro de la misma transacción
que el cambio de datos**. Si Redis se pierde entero, el outbox vuelve a publicar
lo que quedara pendiente. Un pedido pagado no depende de que Redis sobreviva.

Lo que sí desaparece con Redis son las sesiones: todos los usuarios tendrán que
volver a entrar. Es molesto, no es una pérdida de datos.

## `.env` — el punto de no retorno

`ENCRYPTION_KEY` cifra las credenciales de proveedores y pasarelas guardadas en
la base. **Sin esa clave, la copia de la base es ilegible en esa parte aunque
esté perfecta.** Restaurar la base sin la clave deja la tienda sin poder hablar
con AliExpress ni con NOWPayments, y no hay forma de recuperarlo.

Guarda `.env` en un gestor de contraseñas, fuera del servidor y fuera del
repositorio. Es la única parte de este documento que no se puede arreglar
después.

## Copias

```bash
# Copia normal (la del cron diario)
./scripts/copia-seguridad.sh

# Copia + restauración real en una base temporal, comparando filas
./scripts/copia-seguridad.sh --verificar
```

La opción `--verificar` es la que convierte una copia en una copia de verdad:
restaura sobre una base nueva y compara el número de filas de `orders`,
`products`, `users` e `invoices` contra el original. Una copia que nunca se ha
restaurado es una suposición, no un respaldo.

### Automatizarlo

```cron
# Diaria a las 04:15, cuando no hay tráfico
15 4 * * * cd /srv/ecom && ./scripts/copia-seguridad.sh >> /var/log/copia-ecom.log 2>&1

# Los domingos, con restauración de prueba
15 3 * * 0 cd /srv/ecom && ./scripts/copia-seguridad.sh --verificar >> /var/log/copia-ecom.log 2>&1
```

### Fuera del servidor

Una copia que vive en el mismo disco que la base no protege del fallo que más
probabilidades tiene de ocurrir: que se pierda el servidor entero.

```bash
# A un bucket con versionado y bloqueo de borrado
rclone sync ./copias remoto:copias-ecom --immutable
```

El bloqueo de borrado importa por una razón concreta: si alguien entra en el
servidor, lo primero que hará es borrar las copias. Un bucket del que no se
puede borrar es lo que hace que un ransomware sea un mal día en vez del final
del negocio.

## Restaurar

### Caso 1 · La base entera se ha perdido

```bash
# 1. Parar todo lo que escriba, o la restauración competirá con tráfico vivo
docker compose stop api worker

# 2. Comprobar que el fichero está íntegro ANTES de borrar nada
sha256sum -c copias/ecom-20260725-041500.dump.sha256

# 3. Base limpia
docker compose exec -T postgres psql -U ecom -d postgres \
  -c 'DROP DATABASE ecom;' -c 'CREATE DATABASE ecom;'

# 4. Restaurar. --jobs=4 en un fichero real: mucho más rápido que en serie
docker compose cp copias/ecom-20260725-041500.dump postgres:/tmp/copia.dump
docker compose exec -T postgres pg_restore \
  --dbname=postgresql://ecom:CLAVE@localhost:5432/ecom \
  --no-owner --no-acl --jobs=4 /tmp/copia.dump

# 5. Rehacer lo que no se copia
docker compose start api worker

# Reindexar el buscador: no se copia porque se regenera entero desde la base
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/v1/search/reindex
```

### Caso 2 · Un borrado por error, hace veinte minutos

Aquí **no** se restaura la copia diaria: se perdería todo lo ocurrido desde las
04:15. Se usa PITR hasta el instante justo anterior al fallo.

```bash
# Restaurar la copia base y aplicar WAL hasta ese momento
restore_command = 'cp /copias/wal/%f %p'
recovery_target_time = '2026-07-25 14:32:00+02'
```

Requiere tener el archivado de WAL activo. Sin él, la recuperación más fina
posible es "hasta la última copia diaria".

### Caso 3 · Solo se ha estropeado una tabla

```bash
# El formato custom permite sacar una tabla suelta
docker compose exec -T postgres pg_restore \
  --dbname=postgresql://ecom:CLAVE@localhost:5432/ecom \
  --table=products --data-only /tmp/copia.dump
```

## Después de restaurar, comprobar

Sin esto no se sabe si la restauración ha ido bien, solo que ha terminado.

```bash
# 1. La API arranca y responde
curl -f http://localhost:3001/health/ready

# 2. La numeración de facturas no tiene huecos: si los tiene, hay un problema
#    fiscal que hay que resolver antes de volver a emitir
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/v1/invoices/check

# 3. Ningún pedido pagado se ha quedado sin llegar al proveedor
docker compose exec -T postgres psql -U ecom -d ecom -c \
  "SELECT count(*) FROM orders o WHERE o.status='PAID'
     AND NOT EXISTS (SELECT 1 FROM supplier_orders s WHERE s.\"orderId\" = o.id);"

# 4. El outbox se está drenando (debe bajar, no crecer)
curl -H "Authorization: Bearer $METRICS_TOKEN" \
  http://localhost:3001/metrics | grep outbox_pending
```

La comprobación 3 es la que más importa tras una restauración: un pedido cobrado
que no llegó al proveedor no se arregla solo y el cliente no lo sabe todavía.

## Simulacro

Restaurar por primera vez el día de la caída es cuando se descubre que faltaba
la clave de cifrado, que el fichero estaba corrupto o que nadie sabe la
contraseña de Postgres. Toca hacerlo una vez al trimestre, en un servidor
aparte, cronometrando:

1. Levantar un servidor limpio
2. Restaurar la última copia
3. Arrancar la plataforma con el `.env` guardado en el gestor de contraseñas
4. Hacer una compra de prueba de punta a punta
5. Anotar cuánto se ha tardado y qué ha faltado

Si el tiempo total supera la hora, el RTO declarado arriba es ficción y hay que
cambiar el plan o el objetivo.
