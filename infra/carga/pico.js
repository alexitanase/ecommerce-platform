import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

/**
 * El pico: campaña, newsletter o Black Friday.
 *
 * Lo que rompe una tienda no es el tráfico sostenido —para eso se escala con
 * calma— sino la **subida de golpe**. Se manda un correo a la lista, o un
 * anuncio empieza a funcionar, y en dos minutos hay diez veces más gente. Para
 * cuando el autoescalado reacciona y arranca contenedores, la avalancha ya ha
 * pasado por encima.
 *
 * Este escenario reproduce eso: nada, subida brusca, meseta y bajada. Lo que
 * se mide no es si aguanta —seguramente sí— sino **qué se degrada primero**,
 * que es lo que hay que reforzar antes de la campaña.
 */

const API = __ENV.API_URL || 'http://localhost:3001';
const LOCALE = 'es';
const SLUGS = (__ENV.SLUGS || 'botas-de-cuero').split(',');

/** Latencia de la ficha de producto, que es a donde llega la avalancha. */
const latenciaFicha = new Trend('latencia_ficha', true);

export const options = {
  scenarios: {
    pico: {
      executor: 'ramping-arrival-rate',
      // Por peticiones por segundo y no por usuarios: en un pico real la gente
      // llega al ritmo que llega, sin esperar a que a los de delante les
      // responda el servidor. Medir por usuarios simultáneos esconde
      // justamente la degradación, porque si el servidor se ralentiza el test
      // le manda menos carga.
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 300,
      stages: [
        { duration: '20s', target: 5 },
        // La subida: de 5 a 120 por segundo en medio minuto.
        { duration: '30s', target: 120 },
        { duration: '40s', target: 120 },
        { duration: '20s', target: 5 },
      ],
    },
  },

  thresholds: {
    // Más laxo que en navegación normal, y a propósito: en un pico se acepta
    // ir más lento, lo que no se acepta es dar errores. Una tienda lenta
    // vende; una tienda que falla, no.
    'http_req_duration{tipo:ficha}': ['p(95)<1500'],
    http_req_failed: ['rate<0.02'],
  },
};

/**
 * Cada usuario virtual, desde su propia IP.
 *
 * Sin esto, mil usuarios simulados salen todos de la misma dirección y lo que
 * se mide no es la capacidad de la aplicación: es el limitador de peticiones
 * por IP rechazando el 67 % del tráfico. El tráfico real llega de miles de
 * direcciones distintas, y esto lo reproduce.
 *
 * Exige que el entorno de pruebas arranque con `TRUST_PROXY=true`. **Nunca en
 * uno accesible desde internet**: confiar en esa cabecera permite inventarse
 * una IP por petición y saltarse todos los límites. Ver infra/CARGA.md.
 */
function cabecerasDelUsuario() {
  const id = __VU;
  return {
    'X-Forwarded-For': `10.${Math.floor(id / 65536) % 256}.${Math.floor(id / 256) % 256}.${id % 256}`,
  };
}

export default function pico() {
  const slug = SLUGS[Math.floor(Math.random() * SLUGS.length)];

  const r = http.get(`${API}/api/v1/catalog/products/by-slug/${LOCALE}/${slug}`, {
    tags: { tipo: 'ficha' },
    headers: cabecerasDelUsuario(),
  });

  latenciaFicha.add(r.timings.duration);
  check(r, { 'ficha responde': (res) => res.status === 200 });

  sleep(0.5);
}
