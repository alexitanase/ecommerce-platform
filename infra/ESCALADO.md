# Escalado y capacidad

Cómo crece esta plataforma cuando llega tráfico, y sobre todo **dónde se rompe
si se crece mal**. La cuenta de conexiones de la última sección es la que tira
tiendas en Black Friday, y no la hace nadie hasta que pasa.

---

## Dos procesos, no uno

La API y los workers son el mismo código pero **procesos distintos**:

| Proceso | Arranque                    | Qué hace                       |
| ------- | --------------------------- | ------------------------------ |
| API     | `node dist/main.js`         | Sirve HTTP. Encola trabajos.   |
| Workers | `node dist/main.workers.js` | Consume las colas. Sin puerto. |

En producción la API arranca con **`WORKERS_ENABLED=false`**; si no, cada
réplica de la API levantaría además su juego de workers.

El motivo no es estético. Un proceso que sirve HTTP y a la vez sincroniza mil
productos con un proveedor reparte el mismo bucle de eventos entre las dos
cosas, y quien paga la latencia es el cliente que está terminando su compra.

En **desarrollo** no hace falta separar nada: `WORKERS_ENABLED` va a `true` por
defecto y un solo `pnpm dev` levanta todo.

---

## Cada mitad escala por su señal

**La API, por peticiones por segundo o por latencia.** Lo de siempre.

**Los workers, por profundidad de cola.** Es la señal que se adelanta a todas
las demás: la cola empieza a crecer minutos antes de que nadie note nada,
mientras que la CPU solo sube cuando el retraso ya es visible para el cliente.

La política está implementada y probada en
`apps/api/src/modules/queue/escalado.ts`, y se consulta así:

```
GET /api/v1/jobs/escalado?replicas=2      (permiso jobs:manage)
→ { "replicas": 4, "pendientes": 187, "motivo": "187 trabajos esperando: hacen falta 4 réplicas" }
```

Resumen de la política:

- **Sube deprisa, baja despacio.** Quedarse corto retrasa pedidos de clientes;
  quedarse largo cuesta unos céntimos. La asimetría es deliberada.
- **Nunca baja de 1 réplica.** Con cero, el primer pedido de la mañana espera a
  que arranque un contenedor, y arrancar tarda más que procesarlo.
- **No quita réplicas con trabajo en curso.** Un worker no se apaga a mitad de
  un trabajo: reducir por debajo de lo que se está procesando solo alarga el
  apagado mientras la cola sigue creciendo.
- **Techo de 8 réplicas**, y no por ahorrar — ver la siguiente sección.

Los trabajos periódicos (outbox, limpieza, sincronización) usan un `jobId` fijo,
así que **registrarlos desde varias réplicas no los duplica**. Escalar workers
es seguro en ese sentido.

---

## La cuenta que rompe despliegues

Cada proceso abre su **propio pool** de conexiones a Postgres. El total es:

```
conexiones = (réplicas de API + réplicas de worker) × DATABASE_POOL_SIZE
```

Con el `max_connections` por defecto de Postgres (**100**) y un pool de 10:

| API | Workers | Conexiones | ¿Cabe? |
| --- | ------- | ---------- | ------ |
| 2   | 2       | 40         | Sí     |
| 4   | 4       | 80         | Justo  |
| 5   | 5       | 100        | **No** |

La número 101 no conecta, y la tienda empieza a dar errores 500 sin que haya
cambiado una línea de código. Por eso el techo de réplicas está en 8.

**Reservar siempre unas cuantas** para migraciones, copias de seguridad y para
poder entrar con `psql` a ver qué pasa. Regla práctica: no pasar del 80 % de
`max_connections`.

Se ajusta con `DATABASE_POOL_SIZE` (por defecto 10). Más conexiones **no** dan
más rendimiento: dan más contención dentro de Postgres. Antes de subirlo,
comprobar que el cuello de botella es de verdad la espera por conexión.

Cuando haga falta pasar de ahí, la respuesta no es subir `max_connections`
—cada conexión de Postgres es un proceso con su memoria— sino poner **PgBouncer**
en modo transacción delante.

---

## Réplica de lectura

Opcional. Con `DATABASE_URL_REPLICA` declarada, la ficha pública de producto
—la consulta más repetida de toda la tienda— se sirve desde la réplica.

**No se enruta todo automáticamente, y es a propósito.** Una réplica va unos
milisegundos por detrás del primario, y eso rompe el patrón «escribo y leo lo
que acabo de escribir»: crear un pedido y leerlo a continuación por la réplica
devolvería «no existe».

La regla al escribir código nuevo:

- Si lo que se lee lo acaba de escribir **esta misma petición** → `prisma.client`.
- Si lo lee un visitante que ni sabe que existes → `prisma.lectura`.

Sin réplica declarada, `prisma.lectura` apunta al primario y todo funciona
igual. Por eso se puede usar desde el primer día sin montar nada.

---

## Qué mirar cuando algo va lento

En este orden, que es el de más probable a menos:

1. **`queue_depth`** (Grafana). Si sube y no baja, faltan workers o hay un
   proveedor caído bloqueando la cola de fulfillment.
2. **Conexiones en Postgres** — `SELECT count(*) FROM pg_stat_activity`. Si
   está cerca de `max_connections`, es la cuenta de arriba.
3. **Latencia de la API**. Si la cola está tranquila y las conexiones bien,
   entonces sí es la aplicación.

Las alertas de `infra/observabilidad/alertas.yml` cubren los dos primeros.
