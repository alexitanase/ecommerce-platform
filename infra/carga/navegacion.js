import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate } from 'k6/metrics';

/**
 * Navegación: el 90 % del tráfico de una tienda.
 *
 * Nadie entra a comprar directamente. Se mira la portada, se busca, se abren
 * tres fichas y se compra una vez de cada veinte visitas. Este escenario
 * reproduce eso, y es el que dice cuántas visitas aguanta la tienda antes de
 * ponerse lenta.
 *
 * Lo importante son los **umbrales**: no interesa el número bonito de
 * peticiones por segundo, interesa a partir de cuántos usuarios deja de
 * cumplirse el objetivo de latencia. Un test de carga sin umbral solo produce
 * una gráfica que nadie sabe interpretar.
 */

const API = __ENV.API_URL || 'http://localhost:3001';
const LOCALE = 'es';

/**
 * Fichas que se visitan.
 *
 * Se pasan por variable de entorno para que el test sirva contra cualquier
 * catálogo: fijar aquí los slugs del entorno de desarrollo haría que en
 * producción midiera 404, que responden rapidísimo y darían un resultado
 * estupendo y falso.
 */
const SLUGS = (__ENV.SLUGS || 'botas-de-cuero').split(',');

/** Peticiones que devuelven algo que no es 2xx. */
const errores = new Rate('errores_navegacion');

export const options = {
  scenarios: {
    /*
     * Rampa hasta 50 usuarios simultáneos.
     *
     * 50 concurrentes no son 50 visitas: con una sesión de un minuto son del
     * orden de 3.000 visitas a la hora, que para una tienda que arranca es un
     * día bueno. Se sube en escalones para ver DÓNDE se degrada, no solo si
     * aguanta el pico.
     */
    navegacion: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 10 },
        { duration: '30s', target: 30 },
        { duration: '30s', target: 50 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },

  /*
   * Objetivos de servicio.
   *
   * 500 ms en el p95 del catálogo es lo que separa una tienda que se siente
   * instantánea de una que "va lenta". Por encima de 1 s la gente se va: está
   * medido en todos los estudios de conversión y se nota en las ventas antes
   * que en ningún panel.
   */
  thresholds: {
    'http_req_duration{tipo:portada}': ['p(95)<500'],
    'http_req_duration{tipo:catalogo}': ['p(95)<500'],
    'http_req_duration{tipo:ficha}': ['p(95)<600'],
    errores_navegacion: ['rate<0.01'],
    // Un solo fallo en el camino de compra ya es una venta perdida.
    http_req_failed: ['rate<0.01'],
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

function pedir(url, tipo) {
  const r = http.get(url, { tags: { tipo }, headers: cabecerasDelUsuario() });
  const ok = check(r, { [`${tipo}: 2xx`]: (res) => res.status >= 200 && res.status < 300 });
  errores.add(!ok);
  return r;
}

export default function navegar() {
  group('portada', () => {
    pedir(`${API}/api/v1/content/home/${LOCALE}`, 'portada');
    pedir(`${API}/api/v1/catalog/categories/tree?locale=${LOCALE}`, 'menu');
  });

  // Una persona tarda en leer y decidir. Sin esta pausa el test mide la
  // capacidad de encajar una ametralladora de peticiones, que no es lo que
  // hace nadie.
  sleep(Math.random() * 2 + 1);

  group('catalogo', () => {
    pedir(`${API}/api/v1/search?q=&locale=${LOCALE}&limite=24`, 'catalogo');
  });

  sleep(Math.random() * 3 + 1);

  group('ficha', () => {
    // Dos fichas por visita: es lo que se mira antes de decidir.
    for (const slug of SLUGS) {
      pedir(`${API}/api/v1/catalog/products/by-slug/${LOCALE}/${slug}`, 'ficha');
      sleep(Math.random() * 2 + 1);
    }
  });
}
