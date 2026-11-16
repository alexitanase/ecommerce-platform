import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { Ico, ICONOS, useNavegacion } from '@/lib/navegacion';

/**
 * Paleta de comandos (⌘K / Ctrl+K).
 *
 * El panel tiene veintitantas pantallas repartidas en nueve grupos. Llegar a
 * «Trabajos» desde «Productos» son tres decisiones y un recorrido con el ratón;
 * aquí son cuatro letras. Para quien pasa el día dentro del panel, es la
 * diferencia entre navegar y trabajar.
 *
 * Busca por nombre, por grupo y por sinónimos (`alias` en la navegación): quien
 * escribe «stock» no está buscando la palabra «Productos», está buscando dónde
 * se mira el stock.
 *
 * Solo aparece lo que quien mira puede abrir: la paleta lee la misma navegación
 * ya filtrada por permisos que la barra lateral, así que no puede ofrecer un
 * atajo a una pantalla que devolvería 403.
 */

export interface AccionPaleta {
  id: string;
  etiqueta: string;
  grupo: string;
  icono?: React.ReactNode;
  alias?: string[];
  ejecutar: () => void;
}

/** Normaliza para que «reseñas» se encuentre escribiendo «resenas». */
const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

export function PaletaComandos({
  abierta,
  alCerrar,
  acciones = [],
}: {
  abierta: boolean;
  alCerrar: () => void;
  /** Acciones extra que aporta el armazón (tema, idioma, salir). */
  acciones?: AccionPaleta[];
}) {
  const { t } = useTranslation();
  const navegar = useNavigate();
  const { planas } = useNavegacion();
  const dialogo = useRef<HTMLDialogElement>(null);
  const activador = useRef<HTMLElement | null>(null);
  const [consulta, setConsulta] = useState('');
  const [indice, setIndice] = useState(0);

  const opciones: AccionPaleta[] = useMemo(
    () => [
      ...planas.map((e) => ({
        id: `ir-${e.ruta}`,
        etiqueta: e.etiqueta,
        grupo: e.grupo || t('ui.paleta.ir_a'),
        icono: e.icono,
        alias: e.alias,
        ejecutar: () => void navegar({ to: e.ruta as never }),
      })),
      ...acciones,
    ],
    [planas, acciones, navegar, t],
  );

  const filtradas = useMemo(() => {
    const q = normalizar(consulta.trim());
    if (!q) return opciones.slice(0, 12);

    return opciones
      .map((o) => {
        const etiqueta = normalizar(o.etiqueta);
        const enAlias = (o.alias ?? []).some((a) => normalizar(a).includes(q));
        // Empezar por lo escrito pesa más que contenerlo, y el nombre pesa más
        // que un sinónimo: buscar «pe» tiene que ofrecer «Pedidos» antes que
        // «Proveedores».
        const puntos = etiqueta.startsWith(q)
          ? 0
          : etiqueta.includes(q)
            ? 1
            : normalizar(o.grupo).includes(q)
              ? 2
              : enAlias
                ? 3
                : -1;
        return { o, puntos };
      })
      .filter((x) => x.puntos >= 0)
      .sort((a, b) => a.puntos - b.puntos)
      .map((x) => x.o)
      .slice(0, 20);
  }, [consulta, opciones]);

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (abierta && !d.open) {
      activador.current = document.activeElement as HTMLElement | null;
      setConsulta('');
      setIndice(0);
      d.showModal();
    } else if (!abierta && d.open) {
      d.close();
    }
  }, [abierta]);

  /*
   * El resaltado vuelve arriba en cuanto cambia la búsqueda —si no, Enter
   * abriría el tercer resultado de la lista anterior— y además se recorta a la
   * lista actual. Se calcula al vuelo en vez de corregirlo en un efecto: un
   * `setState` dentro de un efecto pinta una vez con el índice malo y otra con
   * el bueno, y en una lista que se filtra al teclear eso se ve parpadear.
   */
  const activo = Math.min(indice, Math.max(filtradas.length - 1, 0));

  const cerrar = () => {
    alCerrar();
    queueMicrotask(() => activador.current?.focus());
  };

  const elegir = (o: AccionPaleta | undefined) => {
    if (!o) return;
    cerrar();
    o.ejecutar();
  };

  const idOpcion = (i: number) => `paleta-opcion-${i}`;

  /*
   * Dónde empieza cada grupo.
   *
   * Se calcula antes de pintar y no llevando una variable «grupo anterior»
   * dentro del `map`: una variable que se reasigna mientras React renderiza
   * conserva el valor de la pasada anterior si el render se interrumpe, y los
   * títulos de grupo salen donde no toca.
   */
  const abreGrupo = filtradas.map((o, i) => o.grupo !== filtradas[i - 1]?.grupo);

  return (
    <dialog
      ref={dialogo}
      className="paleta"
      aria-label={t('ui.paleta.titulo')}
      onCancel={(e) => {
        e.preventDefault();
        cerrar();
      }}
      onMouseDown={(e) => {
        if (e.target === dialogo.current) cerrar();
      }}
    >
      <div className="paleta-caja">
        <div className="paleta-buscador">
          <span aria-hidden="true" style={{ color: 'var(--texto-tenue)' }}>
            <Ico d={ICONOS.buscar} />
          </span>
          <input
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="paleta-lista"
            aria-activedescendant={filtradas.length > 0 ? idOpcion(activo) : undefined}
            aria-label={t('ui.paleta.buscar')}
            placeholder={t('ui.paleta.buscar')}
            value={consulta}
            autoComplete="off"
            onChange={(e) => {
              setConsulta(e.target.value);
              setIndice(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndice((activo + 1) % Math.max(filtradas.length, 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndice((activo - 1 + filtradas.length) % Math.max(filtradas.length, 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                elegir(filtradas[activo]);
              } else if (e.key === 'Home') {
                setIndice(0);
              } else if (e.key === 'End') {
                setIndice(Math.max(filtradas.length - 1, 0));
              }
            }}
          />
          <kbd className="tecla">esc</kbd>
        </div>

        <ul
          id="paleta-lista"
          role="listbox"
          aria-label={t('ui.paleta.resultados')}
          className="paleta-lista"
        >
          {filtradas.length === 0 && (
            <li className="paleta-vacio" role="presentation">
              {t('app.sin_resultados')}
            </li>
          )}
          {filtradas.map((o, i) => {
            const nuevoGrupo = abreGrupo[i] ?? false;
            return (
              <li key={o.id} role="presentation">
                {nuevoGrupo && o.grupo && <p className="paleta-grupo">{o.grupo}</p>}
                <div
                  id={idOpcion(i)}
                  role="option"
                  aria-selected={i === activo}
                  className={`paleta-opcion ${i === activo ? 'paleta-opcion-activa' : ''}`}
                  onMouseEnter={() => setIndice(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    elegir(o);
                  }}
                >
                  {o.icono}
                  <span className="truncate">{o.etiqueta}</span>
                </div>
              </li>
            );
          })}
        </ul>

        <footer className="paleta-pie">
          <span>
            <kbd className="tecla">↑</kbd> <kbd className="tecla">↓</kbd> {t('ui.paleta.moverse')}
          </span>
          <span>
            <kbd className="tecla">↵</kbd> {t('ui.paleta.abrir')}
          </span>
        </footer>
      </div>
    </dialog>
  );
}

/**
 * Atajo global de la paleta.
 *
 * Se registra en el armazón y no en la propia paleta para que exista aunque el
 * diálogo no esté montado. Se ignora si el foco está dentro de un campo de
 * texto salvo que se pulse con la tecla modificadora: escribir "k" en un
 * buscador no puede abrir un diálogo encima.
 */
export function useAtajoPaleta(alAbrir: () => void) {
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        alAbrir();
      }
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [alAbrir]);
}
