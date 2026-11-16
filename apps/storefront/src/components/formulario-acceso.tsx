'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { ErrorApi } from '@/lib/api';
import { Necesita2FA, useSesion } from '@/lib/sesion';
import { AccesosSociales } from '@/components/accesos-sociales';
import type { MotivoOauth } from '@/lib/accesos';
import { Pagina, TituloPagina } from '@/components/ui/pagina';

/**
 * Entrar y registrarse.
 *
 * Los dos formularios comparten componente porque comparten casi todo —los
 * campos, el manejo de errores, a dónde se vuelve al terminar— y tenerlos
 * separados garantizaba que uno se quedara atrás. Lo que cambia es poco y va
 * en `modo`.
 *
 * Dos decisiones que no se ven pero deciden si esto funciona:
 *
 *  · **Se vuelve a donde se estaba.** Quien pulsa "entrar" desde el carrito
 *    quiere volver al carrito, no a la portada. El destino viaja en `?volver=`
 *    y se comprueba que sea una ruta de la propia tienda: aceptarla tal cual
 *    convertiría el enlace en un salto abierto a cualquier dominio, que es un
 *    clásico para montar una página de phishing con nuestra URL delante.
 *
 *  · **El código de dos pasos no se pide de entrada.** Solo aparece cuando la
 *    API dice que hace falta. Enseñarlo siempre confunde a la inmensa mayoría,
 *    que no lo tiene activado.
 */
export function FormularioAcceso({
  modo,
  proveedores = [],
  fallo = null,
}: {
  modo: 'entrar' | 'registro';
  /**
   * Accesos sociales configurados, según el servidor.
   *
   * Llegan como propiedad y no se consultan aquí a propósito: pintar el botón de
   * Google después de hidratar lo haría aparecer de golpe sobre el formulario y
   * movería lo que hay debajo justo cuando alguien va a escribir su email.
   */
  proveedores?: string[];
  /**
   * Por qué ha fallado el acceso social, si venimos de uno.
   *
   * Lo valida el servidor a partir del `?error=` de la URL y lo pasa ya
   * comprobado, así que aquí no hay nada que sanear ni ningún efecto que lea
   * `location`: el primer pintado ya trae el aviso.
   */
  fallo?: MotivoOauth | null;
}) {
  const t = useTranslations('auth');
  const tc = useTranslations('comun');
  const router = useRouter();

  const { usuario, cargando, entrar, registrar, recuperar } = useSesion();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [ofertas, setOfertas] = useState(false);
  const [totp, setTotp] = useState('');
  const [pide2FA, setPide2FA] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string[]>>({});

  useEffect(() => {
    void recuperar();
  }, [recuperar]);

  // Quien ya tiene sesión no pinta nada aquí.
  useEffect(() => {
    if (!cargando && usuario) router.replace(destinoSeguro());
  }, [cargando, usuario, router]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    setErrores({});

    try {
      if (modo === 'entrar') {
        await entrar({ email, password, ...(totp ? { totpCode: totp } : {}) });
      } else {
        await registrar({
          email,
          password,
          ...(nombre.trim() ? { firstName: nombre.trim() } : {}),
          ...(apellidos.trim() ? { lastName: apellidos.trim() } : {}),
          marketingConsent: ofertas,
        });
      }
      router.replace(destinoSeguro());
    } catch (fallo) {
      if (fallo instanceof Necesita2FA) {
        setPide2FA(true);
        setError(null);
      } else if (fallo instanceof ErrorApi) {
        if (fallo.campos) setErrores(fallo.campos);
        // El límite de peticiones responde `ThrottlerException: Too Many
        // Requests`: en inglés, con el nombre de una clase de Java delante y
        // sin decir qué hacer. Es un mensaje escrito para un log, y acababa
        // pintado en la pantalla de alguien intentando crear su cuenta.
        else if (fallo.status === 429) setError(t('demasiados_intentos'));
        else setError(fallo.message);
      } else {
        setError(tc('error'));
      }
      setEnviando(false);
    }
  };

  /**
   * Un campo con su etiqueta, su ayuda y su error.
   *
   * La etiqueta va con `htmlFor`, y la ayuda y el error FUERA de ella,
   * enlazados con `aria-describedby`. Metiéndolos dentro —que es lo cómodo—
   * pasan a formar parte del nombre accesible del campo: un lector de pantalla
   * anunciaba «Contraseña Al menos 10 caracteres, con mayúsculas, minúsculas y
   * algún número» cada vez que el foco entraba ahí. Además incumple el
   * criterio 2.5.3 de WCAG, que exige que el nombre empiece por lo que se ve
   * escrito, y rompe el control por voz: «pulsa Contraseña» deja de encontrar
   * el campo.
   */
  const campo = (
    nombreCampo: string,
    etiqueta: string,
    valor: string,
    alCambiar: (v: string) => void,
    opciones: {
      tipo?: string;
      autoComplete?: string;
      ayuda?: string;
      /**
       * Obligatorio de verdad.
       *
       * Por defecto NO. Estuvo por defecto a sí y el resultado fue que no se
       * podía crear una cuenta: nombre y apellidos son opcionales en la API,
       * el `required` los bloqueaba, y el navegador respondía con su globo
       * nativo —en inglés y sin pasar por nuestro manejo de errores—. Pedir
       * datos que no hacen falta es además la forma más barata de perder
       * registros.
       */
      obligatorio?: boolean;
    } = {},
  ) => {
    const fallos = errores[nombreCampo];
    const idAyuda = opciones.ayuda ? `${nombreCampo}-ayuda` : undefined;
    const idError = fallos ? `${nombreCampo}-error` : undefined;
    const describe = [idError, idAyuda].filter(Boolean).join(' ') || undefined;

    return (
      <div>
        <label htmlFor={nombreCampo} className="mb-1 block text-sm font-medium">
          {etiqueta}
        </label>
        <input
          id={nombreCampo}
          name={nombreCampo}
          className="campo"
          type={opciones.tipo ?? 'text'}
          value={valor}
          onChange={(ev) => alCambiar(ev.target.value)}
          autoComplete={opciones.autoComplete}
          aria-invalid={fallos ? true : undefined}
          aria-describedby={describe}
          required={opciones.obligatorio ?? false}
        />
        {opciones.ayuda && !fallos && (
          <span id={idAyuda} className="mt-1 block text-xs text-[var(--texto-tenue)]">
            {opciones.ayuda}
          </span>
        )}
        {fallos && (
          <span
            id={idError}
            role="alert"
            className="mt-1 block text-xs"
            style={{ color: 'var(--error)' }}
          >
            {fallos.join('. ')}
          </span>
        )}
      </div>
    );
  };

  return (
    <Pagina ancho="tarjeta" className="sm:py-16">
      {/* Con una frase debajo: sin ella, el escritorio quedaba con un título
          de dos palabras flotando sobre un cuadro pequeño. */}
      <TituloPagina
        centrado
        titulo={modo === 'entrar' ? t('entrar') : t('crear_cuenta')}
        descripcion={modo === 'entrar' ? t('entrar_ayuda') : t('registro_ayuda')}
      />

      {/*
       * El fallo de un acceso social se cuenta aquí y no en una página aparte.
       *
       * Quien vuelve de Google sin haber podido entrar necesita el formulario de
       * siempre delante para probar de otra manera. La API solo manda un código
       * corto en la URL —nunca su mensaje—, así que el texto lo pone la tienda.
       */}
      {fallo && (
        <p role="alert" className="mb-4 text-sm" style={{ color: 'var(--error)' }}>
          {t(`oauth_${fallo}`)}
        </p>
      )}

      <form onSubmit={(e) => void enviar(e)} className="card space-y-4 p-5">
        <AccesosSociales proveedores={proveedores} />

        {modo === 'registro' && (
          <div className="grid gap-4 sm:grid-cols-2">
            {campo('firstName', t('nombre_opcional'), nombre, setNombre, {
              autoComplete: 'given-name',
            })}
            {campo('lastName', t('apellidos_opcional'), apellidos, setApellidos, {
              autoComplete: 'family-name',
            })}
          </div>
        )}

        {campo('email', t('email'), email, setEmail, {
          tipo: 'email',
          autoComplete: 'email',
          obligatorio: true,
        })}

        {campo('password', t('password'), password, setPassword, {
          tipo: 'password',
          autoComplete: modo === 'entrar' ? 'current-password' : 'new-password',
          obligatorio: true,
          ...(modo === 'registro' ? { ayuda: t('password_requisitos') } : {}),
        })}

        {/* Solo cuando la API lo pide: la mayoría no tiene 2FA y enseñarlo
            siempre haría dudar de si hace falta. */}
        {pide2FA &&
          campo('totpCode', t('codigo_2fa'), totp, setTotp, {
            autoComplete: 'one-time-code',
            obligatorio: true,
            ayuda: t('codigo_2fa_ayuda'),
          })}

        {modo === 'registro' && (
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={ofertas}
              onChange={(e) => setOfertas(e.target.checked)}
              className="mt-0.5"
            />
            {/* Marcado por defecto sería consentimiento inválido: el RGPD
                exige un acto afirmativo, y una casilla premarcada no lo es. */}
            <span>{t('acepto_ofertas')}</span>
          </label>
        )}

        {error && (
          <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primario btn-grande w-full" disabled={enviando}>
          {enviando ? tc('cargando') : modo === 'entrar' ? t('entrar') : t('crear_cuenta')}
        </button>

        <div className="flex flex-wrap justify-between gap-2 text-sm">
          {modo === 'entrar' ? (
            <>
              <Link href="/recuperar" className="text-[var(--marca-texto)] hover:underline">
                {t('olvidada')}
              </Link>
              <Link href="/registro" className="text-[var(--marca-texto)] hover:underline">
                {t('sin_cuenta')}
              </Link>
            </>
          ) : (
            <Link href="/entrar" className="text-[var(--marca-texto)] hover:underline">
              {t('ya_tengo_cuenta')}
            </Link>
          )}
        </div>
      </form>
    </Pagina>
  );
}

/**
 * A dónde volver después de entrar.
 *
 * Solo se aceptan rutas internas: una ruta que empiece por `/` y no por `//`.
 * Con `//evil.com` el navegador entiende un dominio externo, así que dejarla
 * pasar convertiría el enlace de acceso de la tienda en un salto a cualquier
 * sitio — la forma habitual de montar un phishing con una URL de confianza
 * delante.
 */
function destinoSeguro(): '/cuenta' {
  if (typeof window === 'undefined') return '/cuenta';

  const pedido = new URLSearchParams(window.location.search).get('volver');
  if (!pedido) return '/cuenta';
  if (!pedido.startsWith('/') || pedido.startsWith('//')) return '/cuenta';

  return pedido as '/cuenta';
}
