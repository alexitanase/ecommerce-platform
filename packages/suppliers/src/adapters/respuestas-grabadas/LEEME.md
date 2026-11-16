# Respuestas grabadas de la API del proveedor

Estas son las respuestas que devuelve la API real, guardadas tal cual llegan.
Los tests de contrato las reproducen con `fetch` interceptado, así que
comprueban de verdad el trozo que más se rompe: **cómo se interpreta lo que
manda el proveedor**.

## Por qué están grabadas y no inventadas

Un test que se escribe mirando el propio código pasa siempre: se prueba a sí
mismo. Estas respuestas conservan las rarezas de AliExpress —el precio como
cadena, los nombres de campo con guiones bajos, las listas envueltas dos
veces— que son exactamente lo que un cambio en su API rompe.

## Estado actual: PENDIENTES DE GRABAR CONTRA LA API REAL

Se han construido a partir de la documentación publicada de la Dropshipping
API, porque todavía no hay credenciales de AliExpress (ver `BLOQUEOS.md`).
Reproducen la forma documentada, no una captura real.

**En cuanto haya credenciales hay que volver a grabarlas contra la API de
verdad.** Hasta entonces protegen de romper el adaptador desde dentro —un
cambio nuestro en el mapeo— pero no de que AliExpress cambie algo que su
documentación no reflejaba.

Para regrabar: llamar al método con credenciales reales, volcar el JSON de la
respuesta tal cual en el fichero correspondiente y ejecutar los tests. Si algo
falla, el adaptador tiene que adaptarse; nunca al revés.
