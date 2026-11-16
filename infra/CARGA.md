# Pruebas de carga y plan de capacidad

Cuánto aguanta la tienda, qué se rompe primero y qué hay que tener listo antes
de una campaña.

---

## Cómo se ejecutan

```bash
pnpm carga        # navegación: el 90 % del tráfico
pnpm carga:pico   # subida brusca: campaña, newsletter, Black Friday
```

Van con **k6 dentro de Docker**, así que no hay que instalar nada. Necesitan la
pila levantada (`pnpm dev`) y aceptan dos variables:

```bash
API_URL=https://api.tienda.es SLUGS=botas-de-cuero,otra-ficha pnpm carga
```

`SLUGS` importa más de lo que parece: si se apunta a fichas que no existen, la
API responde 404 en un milisegundo y el informe sale estupendo midiendo nada.

### El entorno de pruebas necesita `TRUST_PROXY=true`

Los mil usuarios simulados salen todos de la misma máquina. Sin decirle a la
API que se fíe de `X-Forwarded-For`, el limitador por IP rechaza dos tercios
del tráfico y lo que se mide es el limitador, no la aplicación —así salió la
primera ejecución: **67 % de errores** con latencias de 2 ms—.

> **Nunca en un entorno accesible desde internet.** Confiar en esa cabecera
> permite a cualquiera inventarse una IP por petición y saltarse todos los
> límites por IP: el global, el de intentos de acceso, el de creación de
> pedidos y la señal de velocidad del control de riesgo. Por defecto
> `TRUST_PROXY` va en `false`; en producción se pone la dirección del proxy que
> haya delante, y nada más.

---

## Qué se mide, y por qué esos umbrales

No interesa el número grande de peticiones por segundo: interesa **a partir de
cuántos usuarios deja de cumplirse el objetivo**. Un test de carga sin umbral
solo produce una gráfica que nadie sabe interpretar.

| Escenario  | Umbral                             | Motivo                                       |
| ---------- | ---------------------------------- | -------------------------------------------- |
| Navegación | p95 < 500 ms en portada y catálogo | Por encima, la tienda "se siente lenta"      |
| Navegación | p95 < 600 ms en la ficha           | Es la página donde se decide la compra       |
| Navegación | errores < 1 %                      | Cada error en el camino es una venta perdida |
| Pico       | p95 < 1500 ms                      | En un pico se acepta ir lento, no fallar     |
| Pico       | errores < 2 %                      | Una tienda lenta vende; una que falla, no    |

El escenario de pico mide **por peticiones por segundo**, no por usuarios
simultáneos. Con usuarios, si el servidor se ralentiza el test le manda menos
carga y la degradación se esconde justo cuando interesa verla.

---

## Resultados de referencia

Medido el 27/07/2026 en el entorno de desarrollo.

**Navegación** — rampa hasta 50 usuarios simultáneos:

| Métrica      | Valor   |
| ------------ | ------- |
| Peticiones   | 1.520   |
| Errores      | **0 %** |
| p95 portada  | 3,05 ms |
| p95 ficha    | 3,39 ms |
| p95 catálogo | 44,6 ms |

**Pico** — subida de 5 a 120 peticiones/s en 30 segundos:

| Métrica     | Valor      |
| ----------- | ---------- |
| Peticiones  | 8.012      |
| Rendimiento | 72,6 req/s |
| Errores     | **0 %**    |
| p95 ficha   | 1,94 ms    |

### Qué NO dicen estos números

Conviene ser honesto con ellos, porque es fácil sacar la conclusión equivocada:

- Están medidos en **un portátil de desarrollo**, con la base de datos, Redis y
  la API en la misma máquina. No hay red entre medias, y la red es lo que más
  latencia añade en producción.
- El catálogo tiene **dos productos**. Las consultas caben enteras en caché y
  en memoria de Postgres; con diez mil productos el catálogo se comporta de
  otra manera.
- Están medidos con **la caché caliente**. Un despliegue la vacía, y los
  primeros minutos después de publicar son los peores.

Sirven como **línea base para detectar regresiones** —si mañana el p95 de la
ficha pasa de 3 ms a 300 ms, algo se ha roto— y no como una promesa de
capacidad. La capacidad real se mide contra el servidor de producción, y eso
depende del VPS, que todavía no está contratado.

El catálogo es holgadamente lo más rápido; **el cuello de botella medido es la
búsqueda** (44 ms de p95 frente a 3 ms del resto), que es la que va contra
Meilisearch.

---

## Antes de una campaña

Por orden de lo que más veces sale mal:

1. **Calentar la caché** después de desplegar. Publicar y mandar el correo a la
   vez significa que la avalancha llega con todo frío.
2. **Subir workers ANTES**, no durante. El autoescalado reacciona en minutos y
   la avalancha de una newsletter dura dos. Ver `ESCALADO.md`.
3. **Comprobar la cuenta de conexiones** para el número de réplicas previsto.
   Es lo que tira tiendas en Black Friday: `(API + workers) × pool` contra el
   `max_connections` de Postgres.
4. **Revisar el control de riesgo.** Una campaña genera un pico de pedidos
   legítimos desde pocas IP (redes móviles, oficinas) y conviene mirar la
   pantalla de retenidos más a menudo esos días.
5. **Tener a mano cómo bajar el ritmo**: si algo va mal, `THROTTLE_LIMIT` y el
   número de réplicas son las dos palancas que actúan en segundos.

---

## Cuando haya servidor de verdad

Lo que falta por medir, y que solo se puede medir allí:

- Latencia con red real entre la API y Postgres.
- Comportamiento con un catálogo de miles de productos.
- El primer minuto después de un despliegue, con la caché vacía.
- El camino de compra completo bajo carga —crear pedido escribe en la base y
  reserva stock, así que se comporta muy distinto a leer una ficha—.

Ese último escenario está pendiente a propósito: ejecutarlo contra el entorno
de desarrollo llenaría la base de pedidos falsos, y contra producción hay que
hacerlo con una pasarela en modo de pruebas y avisando a quien esté de guardia.
