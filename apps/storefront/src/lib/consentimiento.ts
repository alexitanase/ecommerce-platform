/**
 * Consentimiento de cookies.
 *
 * Fuente única de verdad para toda la tienda: el banner escribe aquí y
 * cualquier script que necesite permiso pregunta aquí. Tenerlo repartido es
 * como acaban las tiendas cargando analítica antes de que nadie acepte nada.
 *
 * Lo que exige la guía de la AEPD y se cumple en este fichero:
 *
 *  · Nada que no sea imprescindible se carga sin permiso explícito.
 *  · Retirar el consentimiento tiene que ser tan fácil como darlo.
 *  · El consentimiento caduca: no vale uno dado hace cuatro años.
 *  · Hay que poder demostrar cuándo y qué se aceptó.
 *  · Seguir navegando NO es consentir.
 */

export type Categoria = 'analiticas' | 'marketing';

export interface Consentimiento {
  /** Siempre true: son las que hacen funcionar la tienda. */
  necesarias: true;
  analiticas: boolean;
  marketing: boolean;
  /** Cuándo se decidió, en ISO. Es la prueba de cuándo se dio. */
  fecha: string;
  /**
   * Versión de la política aceptada.
   *
   * Si se añade un tipo de cookie nuevo hay que volver a preguntar: el
   * consentimiento de la versión anterior no cubre una finalidad que no
   * existía cuando se dio.
   */
  version: number;
}

export const CLAVE = 'consentimiento-cookies';

/** Súbela al cambiar las finalidades: obliga a volver a preguntar a todo el mundo. */
export const VERSION_POLITICA = 1;

/**
 * Caducidad del consentimiento.
 *
 * La AEPD marca 24 meses como máximo para renovarlo. Se usan 12 para tener
 * margen: un consentimiento caducado es lo mismo que no tenerlo.
 */
const MESES_VALIDEZ = 12;

const SIN_PERMISO: Consentimiento = {
  necesarias: true,
  analiticas: false,
  marketing: false,
  fecha: '',
  version: VERSION_POLITICA,
};

/** Evento que se emite en cada cambio, para que los scripts reaccionen. */
export const EVENTO = 'consentimiento-cookies';

function caducado(registro: Consentimiento): boolean {
  if (!registro.fecha) return true;

  const dado = new Date(registro.fecha).getTime();
  if (Number.isNaN(dado)) return true;

  const limite = new Date(dado);
  limite.setMonth(limite.getMonth() + MESES_VALIDEZ);

  return Date.now() > limite.getTime();
}

/**
 * Lo aceptado ahora mismo.
 *
 * Devuelve "nada aceptado" cuando no hay decisión, cuando ha caducado o cuando
 * la política ha cambiado. En el servidor devuelve siempre lo mismo: sin
 * permiso, que es la única respuesta segura antes de saber quién mira.
 */
export function leerConsentimiento(): Consentimiento {
  if (typeof window === 'undefined') return SIN_PERMISO;

  try {
    const crudo = window.localStorage.getItem(CLAVE);
    if (!crudo) return SIN_PERMISO;

    const registro = JSON.parse(crudo) as Partial<Consentimiento>;

    const normalizado: Consentimiento = {
      necesarias: true,
      analiticas: registro.analiticas === true,
      marketing: registro.marketing === true,
      fecha: typeof registro.fecha === 'string' ? registro.fecha : '',
      version: typeof registro.version === 'number' ? registro.version : 0,
    };

    if (normalizado.version !== VERSION_POLITICA) return SIN_PERMISO;
    if (caducado(normalizado)) return SIN_PERMISO;

    return normalizado;
  } catch {
    // Un valor manipulado o de un formato viejo se trata como "sin decidir":
    // preguntar de más es molesto, cargar de más es una infracción.
    return SIN_PERMISO;
  }
}

/** ¿Hay una decisión válida, sea cual sea? Si no, hay que enseñar el banner. */
export function hayDecision(): boolean {
  if (typeof window === 'undefined') return true;
  return leerConsentimiento().fecha !== '';
}

/** ¿Se puede usar esta categoría? */
export function permitido(categoria: Categoria): boolean {
  return leerConsentimiento()[categoria];
}

export function guardarConsentimiento(eleccion: {
  analiticas: boolean;
  marketing: boolean;
}): Consentimiento {
  const registro: Consentimiento = {
    necesarias: true,
    analiticas: eleccion.analiticas,
    marketing: eleccion.marketing,
    fecha: new Date().toISOString(),
    version: VERSION_POLITICA,
  };

  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(registro));
  } catch {
    // Modo privado con almacenamiento bloqueado: se avisa igual a los scripts
    // para que respeten la elección durante esta sesión.
  }

  window.dispatchEvent(new CustomEvent<Consentimiento>(EVENTO, { detail: registro }));

  // Se deja constancia en el servidor para poder demostrarlo.
  void registrarEnServidor(registro);

  return registro;
}

/**
 * Retira el consentimiento y vuelve a mostrar el banner.
 *
 * Retirar tiene que ser tan fácil como aceptar; si no, el consentimiento no es
 * libre y no vale.
 */
export function retirarConsentimiento(): void {
  try {
    window.localStorage.removeItem(CLAVE);
  } catch {
    // Sin almacenamiento no hay nada que borrar.
  }

  borrarCookiesNoNecesarias();

  window.dispatchEvent(new CustomEvent<Consentimiento>(EVENTO, { detail: SIN_PERMISO }));
}

/**
 * Cookies que solo pueden existir con permiso.
 *
 * Al retirar el consentimiento no basta con dejar de crear cookies nuevas: las
 * que ya estaban puestas siguen ahí identificando al visitante, así que hay
 * que borrarlas de verdad.
 *
 * Las de sesión y carrito NO se tocan: son técnicas y necesarias, y borrarlas
 * cerraría la sesión y vaciaría el carrito de quien solo quería decir que no.
 */
const PREFIJOS_NO_NECESARIAS = ['_ga', '_gid', '_gcl', '_fbp', '_fbc', '_hj'];

function borrarCookiesNoNecesarias(): void {
  if (typeof document === 'undefined') return;

  const dominio = window.location.hostname;
  // Una cookie puesta en .midominio.es no se borra apuntando a midominio.es:
  // hay que repetir el intento con cada variante del dominio.
  const dominios = [dominio, `.${dominio}`, `.${dominio.split('.').slice(-2).join('.')}`];

  for (const cookie of document.cookie.split(';')) {
    const nombre = cookie.split('=')[0]?.trim();
    if (!nombre) continue;
    if (!PREFIJOS_NO_NECESARIAS.some((p) => nombre.startsWith(p))) continue;

    for (const d of dominios) {
      document.cookie = `${nombre}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${d}`;
    }
    document.cookie = `${nombre}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

/**
 * Deja constancia en el servidor de qué se aceptó y cuándo.
 *
 * El RGPD obliga a poder DEMOSTRAR el consentimiento. Con solo localStorage no
 * hay nada que enseñar en una inspección: el usuario puede haberlo borrado y
 * no queda rastro. Se manda sin bloquear nada; si falla, la elección del
 * usuario se respeta igualmente porque manda el valor local.
 */
async function registrarEnServidor(registro: Consentimiento): Promise<void> {
  const base = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

  try {
    await fetch(`${base}/api/v1/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        analiticas: registro.analiticas,
        marketing: registro.marketing,
        version: registro.version,
      }),
      keepalive: true,
    });
  } catch {
    // Sin conexión no se pierde la decisión: vive en el navegador.
  }
}

/**
 * Se suscribe a los cambios de consentimiento.
 *
 * Devuelve la función para dejar de escuchar. Escucha también `storage` para
 * que retirar el permiso en una pestaña afecte a las demás al momento.
 */
export function alCambiarConsentimiento(fn: (c: Consentimiento) => void): () => void {
  const enEvento = (e: Event) => fn((e as CustomEvent<Consentimiento>).detail);
  const enStorage = (e: StorageEvent) => {
    if (e.key === CLAVE) fn(leerConsentimiento());
  };

  window.addEventListener(EVENTO, enEvento);
  window.addEventListener('storage', enStorage);

  return () => {
    window.removeEventListener(EVENTO, enEvento);
    window.removeEventListener('storage', enStorage);
  };
}
