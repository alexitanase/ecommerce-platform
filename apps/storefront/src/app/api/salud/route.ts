/**
 * Señal de vida de la tienda.
 *
 * La usan el `HEALTHCHECK` del contenedor y el despliegue sin caída: hasta que
 * esto responde 200, Traefik no manda tráfico al contenedor nuevo y el viejo
 * no se apaga. Sin un endpoint así, «desplegado» solo significa «el proceso ha
 * arrancado», que no es lo mismo que «puede servir una página».
 *
 * Deliberadamente NO comprueba la API ni la base de datos. Esta ruta contesta
 * si este proceso de Next puede responder; si mezclara el estado de sus
 * dependencias, una caída de la API haría que el orquestador reiniciara en
 * bucle una tienda que en realidad está bien —y que todavía puede servir las
 * páginas cacheadas—.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { estado: 'ok', servicio: 'storefront' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
