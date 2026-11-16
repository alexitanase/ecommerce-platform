import {
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Boton } from './boton';
import { IconoChevron } from './overlays';

/**
 * Formularios del panel.
 *
 * La regla de la que cuelga todo lo demás: **cada control tiene una etiqueta
 * asociada de verdad**, con `htmlFor` e `id`, no un texto encima. Un `placeholder`
 * no es una etiqueta —desaparece al escribir y no lo lee un lector— y un `div`
 * encima del campo no dice a qué campo pertenece.
 *
 * De ahí salen las tres cosas que hace `Campo` y que a mano se olvidan siempre:
 *
 *  · Enlaza la ayuda y el error con `aria-describedby`, para que se lean junto
 *    al campo y no como texto suelto de la pantalla.
 *  · Marca `aria-invalid` cuando hay error, que es lo que hace que se anuncie
 *    como inválido y no solo se pinte de rojo.
 *  · El error va debajo del campo y lleva icono además de color: en rojo sobre
 *    gris, quien no distingue el rojo no ve que hay un error.
 */

/* ────────────────────────────── Campo base ────────────────────────────── */

export function Campo({
  etiqueta,
  ayuda,
  error,
  requerido = false,
  children,
  className = '',
}: {
  etiqueta: string;
  ayuda?: string;
  error?: string;
  requerido?: boolean;
  /** Recibe los identificadores que hay que poner en el control. */
  children: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
    required: boolean;
  }) => ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  const idError = `${id}-error`;

  const describe = [ayuda ? idAyuda : '', error ? idError : ''].filter(Boolean).join(' ');

  return (
    <div className={`campo-bloque ${className}`}>
      <label htmlFor={id} className="etiqueta-campo">
        {etiqueta}
        {requerido && (
          <>
            {' '}
            <span aria-hidden="true" style={{ color: 'var(--error)' }}>
              *
            </span>
            <span className="solo-lectores">{t('formulario.requerido')}</span>
          </>
        )}
      </label>

      {children({
        id,
        'aria-describedby': describe || undefined,
        'aria-invalid': error ? true : undefined,
        required: requerido,
      })}

      {ayuda && (
        <p id={idAyuda} className="ayuda-campo">
          {ayuda}
        </p>
      )}
      {error && (
        <p id={idError} className="texto-error" role="alert">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}
    </div>
  );
}

/* ──────────────────────── Controles elementales ──────────────────────── */

type PropsEntrada = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  etiqueta: string;
  ayuda?: string;
  error?: string;
  /** Texto o icono pegado al campo: «€», «https://», una unidad. */
  prefijo?: ReactNode;
  sufijo?: ReactNode;
};

export function Entrada({ etiqueta, ayuda, error, prefijo, sufijo, ...resto }: PropsEntrada) {
  return (
    <Campo
      etiqueta={etiqueta}
      {...(ayuda ? { ayuda } : {})}
      {...(error ? { error } : {})}
      requerido={resto.required ?? false}
    >
      {(props) =>
        prefijo || sufijo ? (
          // Grupo de campo: el adorno va dentro del borde, no al lado, para que
          // se lea como una unidad y el foco rodee el conjunto.
          <div className="grupo-campo">
            {prefijo && <span className="grupo-adorno">{prefijo}</span>}
            <input {...resto} {...props} className="campo" />
            {sufijo && <span className="grupo-adorno">{sufijo}</span>}
          </div>
        ) : (
          <input {...resto} {...props} className="campo" />
        )
      }
    </Campo>
  );
}

export function AreaTexto({
  etiqueta,
  ayuda,
  error,
  ...resto
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & {
  etiqueta: string;
  ayuda?: string;
  error?: string;
}) {
  return (
    <Campo
      etiqueta={etiqueta}
      {...(ayuda ? { ayuda } : {})}
      {...(error ? { error } : {})}
      requerido={resto.required ?? false}
    >
      {(props) => <textarea rows={4} {...resto} {...props} className="campo" />}
    </Campo>
  );
}

export function Seleccion({
  etiqueta,
  ayuda,
  error,
  opciones,
  ...resto
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'children'> & {
  etiqueta: string;
  ayuda?: string;
  error?: string;
  opciones: { valor: string; texto: string }[];
}) {
  return (
    <Campo
      etiqueta={etiqueta}
      {...(ayuda ? { ayuda } : {})}
      {...(error ? { error } : {})}
      requerido={resto.required ?? false}
    >
      {(props) => (
        <select {...resto} {...props} className="campo">
          {opciones.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.texto}
            </option>
          ))}
        </select>
      )}
    </Campo>
  );
}

/* ──────────────────────── Casillas, radios, switch ──────────────────────── */

export function Casilla({
  etiqueta,
  ayuda,
  ...resto
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  etiqueta: string;
  ayuda?: string;
}) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;

  return (
    <div>
      <label htmlFor={id} className="control-linea">
        <input
          id={id}
          type="checkbox"
          {...resto}
          {...(ayuda ? { 'aria-describedby': idAyuda } : {})}
        />
        <span>{etiqueta}</span>
      </label>
      {ayuda && (
        <p id={idAyuda} className="ayuda-campo" style={{ marginLeft: 'var(--e6)' }}>
          {ayuda}
        </p>
      )}
    </div>
  );
}

/**
 * Grupo de opciones excluyentes.
 *
 * Va en un `fieldset` con `legend` porque la pregunta —«¿cómo se envía?»— tiene
 * que leerse junto a cada opción; sin el grupo, un lector anuncia «Estándar,
 * botón de radio» sin decir de qué.
 */
export function Radios({
  etiqueta,
  nombre,
  opciones,
  valor,
  alCambiar,
  ayuda,
}: {
  etiqueta: string;
  nombre: string;
  opciones: { valor: string; texto: string; ayuda?: string; desactivada?: boolean }[];
  valor: string;
  alCambiar: (valor: string) => void;
  ayuda?: string;
}) {
  return (
    <fieldset className="campo-bloque">
      <legend className="etiqueta-campo">{etiqueta}</legend>
      {ayuda && <p className="ayuda-campo mb-2">{ayuda}</p>}
      <div className="space-y-1">
        {opciones.map((o) => (
          <label key={o.valor} className="control-linea">
            <input
              type="radio"
              name={nombre}
              value={o.valor}
              checked={valor === o.valor}
              disabled={o.desactivada ?? false}
              onChange={() => alCambiar(o.valor)}
            />
            <span>
              {o.texto}
              {o.ayuda && (
                <span className="block text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  {o.ayuda}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Interruptor.
 *
 * Es un `checkbox` con aspecto de switch, no un `div` con `role="switch"`: así
 * funciona con el teclado, con los formularios y con el autorrelleno sin
 * reimplementar nada. Se usa solo cuando el cambio se aplica al momento; si hay
 * que pulsar «Guardar», va una casilla.
 */
export function Interruptor({
  etiqueta,
  ayuda,
  activo,
  alCambiar,
  desactivado = false,
}: {
  etiqueta: string;
  ayuda?: string;
  activo: boolean;
  alCambiar: (activo: boolean) => void;
  desactivado?: boolean;
}) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;

  return (
    <div className="interruptor-bloque">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {etiqueta}
        </label>
        {ayuda && (
          <p id={idAyuda} className="ayuda-campo">
            {ayuda}
          </p>
        )}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="interruptor"
        checked={activo}
        disabled={desactivado}
        {...(ayuda ? { 'aria-describedby': idAyuda } : {})}
        onChange={(e) => alCambiar(e.target.checked)}
      />
    </div>
  );
}

/** Deslizador con su valor a la vista: sin él hay que adivinar dónde se ha soltado. */
export function Rango({
  etiqueta,
  valor,
  alCambiar,
  min = 0,
  max = 100,
  paso = 1,
  formato,
  ayuda,
}: {
  etiqueta: string;
  valor: number;
  alCambiar: (valor: number) => void;
  min?: number;
  max?: number;
  paso?: number;
  formato?: (valor: number) => string;
  ayuda?: string;
}) {
  return (
    <Campo etiqueta={etiqueta} {...(ayuda ? { ayuda } : {})}>
      {(props) => (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={min}
            max={max}
            step={paso}
            value={valor}
            onChange={(e) => alCambiar(Number(e.target.value))}
            {...props}
            className="rango"
          />
          <output htmlFor={props.id} className="rango-valor">
            {formato ? formato(valor) : valor}
          </output>
        </div>
      )}
    </Campo>
  );
}

/* ─────────────────────── Selector con búsqueda ─────────────────────── */

export interface OpcionSelector {
  valor: string;
  texto: string;
  descripcion?: string;
}

/**
 * Selector con búsqueda (combobox).
 *
 * Para listas largas —países, categorías, proveedores— donde un `select` nativo
 * obliga a recorrer doscientas opciones. Implementa el patrón de ARIA completo:
 * `combobox` + `listbox`, `aria-activedescendant` para que el foco no salga del
 * campo mientras se navega con flechas, y Escape para cerrar sin elegir.
 */
export function SelectorBuscable({
  etiqueta,
  opciones,
  valor,
  alElegir,
  ayuda,
  error,
  marcador,
}: {
  etiqueta: string;
  opciones: OpcionSelector[];
  valor: string | null;
  alElegir: (valor: string) => void;
  ayuda?: string;
  error?: string;
  marcador?: string;
}) {
  const { t } = useTranslation();
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState('');
  const [indice, setIndice] = useState(0);
  const caja = useRef<HTMLDivElement>(null);
  const base = useId();

  const elegida = opciones.find((o) => o.valor === valor);
  const filtradas = useMemo(() => {
    const q = consulta.trim().toLowerCase();
    if (!q) return opciones;
    return opciones.filter(
      (o) => o.texto.toLowerCase().includes(q) || o.descripcion?.toLowerCase().includes(q),
    );
  }, [consulta, opciones]);

  const cerrar = () => {
    setAbierto(false);
    setConsulta('');
  };

  return (
    <Campo etiqueta={etiqueta} {...(ayuda ? { ayuda } : {})} {...(error ? { error } : {})}>
      {(props) => (
        <div
          ref={caja}
          className="relative"
          onBlur={(e) => {
            if (!caja.current?.contains(e.relatedTarget)) cerrar();
          }}
        >
          <input
            {...props}
            type="text"
            role="combobox"
            className="campo"
            aria-expanded={abierto}
            aria-controls={`${base}-lista`}
            aria-autocomplete="list"
            aria-activedescendant={
              abierto && filtradas.length > 0 ? `${base}-${indice}` : undefined
            }
            placeholder={marcador ?? t('formulario.buscar_opcion')}
            value={abierto ? consulta : (elegida?.texto ?? '')}
            onChange={(e) => {
              setConsulta(e.target.value);
              setIndice(0);
              setAbierto(true);
            }}
            onFocus={() => setAbierto(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setAbierto(true);
                setIndice((i) => Math.min(i + 1, filtradas.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndice((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && abierto) {
                e.preventDefault();
                const opcion = filtradas[indice];
                if (opcion) {
                  alElegir(opcion.valor);
                  cerrar();
                }
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                cerrar();
              }
            }}
          />
          <span className="selector-flecha" aria-hidden="true">
            <IconoChevron />
          </span>

          {abierto && (
            <ul
              id={`${base}-lista`}
              role="listbox"
              aria-label={etiqueta}
              className="selector-lista"
            >
              {filtradas.length === 0 && (
                <li className="selector-vacio">{t('app.sin_resultados')}</li>
              )}
              {filtradas.map((o, i) => (
                <li
                  key={o.valor}
                  id={`${base}-${i}`}
                  role="option"
                  aria-selected={o.valor === valor}
                  className={`selector-opcion ${i === indice ? 'selector-opcion-activa' : ''}`}
                  onMouseEnter={() => setIndice(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    alElegir(o.valor);
                    cerrar();
                  }}
                >
                  <span>{o.texto}</span>
                  {o.descripcion && (
                    <span className="block text-xs" style={{ color: 'var(--texto-tenue)' }}>
                      {o.descripcion}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Campo>
  );
}

/**
 * Selección múltiple.
 *
 * Lo elegido se ve como etiquetas quitables encima de la lista, no como «3
 * seleccionados»: saber cuántos no sirve de nada si hay que abrir el
 * desplegable para recordar cuáles.
 */
export function MultiSeleccion({
  etiqueta,
  opciones,
  valores,
  alCambiar,
  ayuda,
}: {
  etiqueta: string;
  opciones: OpcionSelector[];
  valores: string[];
  alCambiar: (valores: string[]) => void;
  ayuda?: string;
}) {
  const { t } = useTranslation();
  const [consulta, setConsulta] = useState('');

  const filtradas = useMemo(() => {
    const q = consulta.trim().toLowerCase();
    return q ? opciones.filter((o) => o.texto.toLowerCase().includes(q)) : opciones;
  }, [consulta, opciones]);

  const alternar = (valor: string) =>
    alCambiar(valores.includes(valor) ? valores.filter((v) => v !== valor) : [...valores, valor]);

  return (
    <fieldset className="campo-bloque">
      <legend className="etiqueta-campo">{etiqueta}</legend>
      {ayuda && <p className="ayuda-campo mb-2">{ayuda}</p>}

      {valores.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {valores.map((v) => (
            <span key={v} className="tag">
              {opciones.find((o) => o.valor === v)?.texto ?? v}
              <button
                type="button"
                className="tag-quitar objetivo"
                aria-label={t('ui.quitar', {
                  que: opciones.find((o) => o.valor === v)?.texto ?? v,
                })}
                onClick={() => alternar(v)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        type="search"
        className="campo"
        placeholder={t('formulario.buscar_opcion')}
        value={consulta}
        onChange={(e) => setConsulta(e.target.value)}
        aria-label={t('app.buscar')}
      />

      <div className="multi-lista">
        {filtradas.map((o) => (
          <label key={o.valor} className="control-linea">
            <input
              type="checkbox"
              checked={valores.includes(o.valor)}
              onChange={() => alternar(o.valor)}
            />
            <span>{o.texto}</span>
          </label>
        ))}
        {filtradas.length === 0 && <p className="selector-vacio">{t('app.sin_resultados')}</p>}
      </div>
    </fieldset>
  );
}

/* ─────────────────────────── Subida de ficheros ─────────────────────────── */

/**
 * Subida por arrastrar y soltar.
 *
 * La zona de arrastre es un extra, no el único camino: dentro hay un `input`
 * de tipo fichero real, así que se puede usar con teclado y con el diálogo del
 * sistema. Una zona que solo acepta arrastrar deja fuera a quien no puede
 * hacerlo.
 */
export function SubirArchivo({
  etiqueta,
  ayuda,
  acepta,
  multiple = false,
  alElegir,
  error,
}: {
  etiqueta: string;
  ayuda?: string;
  acepta?: string;
  multiple?: boolean;
  alElegir: (ficheros: File[]) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const [encima, setEncima] = useState(false);

  return (
    <Campo etiqueta={etiqueta} {...(ayuda ? { ayuda } : {})} {...(error ? { error } : {})}>
      {(props) => (
        <div
          className={`soltar ${encima ? 'soltar-activo' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setEncima(true);
          }}
          onDragLeave={() => setEncima(false)}
          onDrop={(e) => {
            e.preventDefault();
            setEncima(false);
            alElegir([...e.dataTransfer.files]);
          }}
        >
          <input
            {...props}
            type="file"
            {...(acepta ? { accept: acepta } : {})}
            multiple={multiple}
            className="soltar-input"
            onChange={(e) => alElegir([...(e.target.files ?? [])])}
          />
          <p className="text-sm font-medium">{t('formulario.arrastra')}</p>
          <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {t('formulario.o_elige')}
          </p>
        </div>
      )}
    </Campo>
  );
}

/* ──────────────────────────── Asistente ──────────────────────────── */

export interface PasoAsistente {
  id: string;
  titulo: string;
  contenido: ReactNode;
  /** Se puede avanzar desde este paso. */
  valido?: boolean;
}

/**
 * Asistente multi-paso.
 *
 * Para procesos largos que no caben en una pantalla —importar del proveedor,
 * configurar una pasarela— donde enseñar los treinta campos a la vez hace que
 * se abandone. Cada paso valida lo suyo antes de dejar avanzar, y siempre se
 * puede volver atrás sin perder lo escrito.
 *
 * El indicador de progreso es una lista ordenada con el paso actual marcado con
 * `aria-current`, no una fila de bolitas de adorno.
 */
export function Asistente({
  pasos,
  alTerminar,
  textoFinal,
  trabajando = false,
}: {
  pasos: PasoAsistente[];
  alTerminar: () => void;
  textoFinal?: string;
  trabajando?: boolean;
}) {
  const { t } = useTranslation();
  const [indice, setIndice] = useState(0);
  const paso = pasos[indice];
  if (!paso) return null;

  const ultimo = indice === pasos.length - 1;
  const puedeAvanzar = paso.valido !== false;

  return (
    <div>
      <ol className="pasos">
        {pasos.map((p, i) => (
          <li
            key={p.id}
            className={i === indice ? 'paso-actual' : i < indice ? 'paso-hecho' : ''}
            {...(i === indice ? { 'aria-current': 'step' as const } : {})}
          >
            <span className="paso-numero" aria-hidden="true">
              {i < indice ? '✓' : i + 1}
            </span>
            <span className="paso-titulo">{p.titulo}</span>
          </li>
        ))}
      </ol>

      <div className="pasos-contenido">{paso.contenido}</div>

      <div className="pasos-pie">
        <Boton
          variante="secundario"
          disabled={indice === 0}
          onClick={() => setIndice((i) => i - 1)}
        >
          {t('formulario.atras')}
        </Boton>
        {ultimo ? (
          <Boton
            variante="primario"
            disabled={!puedeAvanzar}
            cargando={trabajando}
            onClick={alTerminar}
          >
            {textoFinal ?? t('app.guardar')}
          </Boton>
        ) : (
          <Boton
            variante="primario"
            disabled={!puedeAvanzar}
            onClick={() => setIndice((i) => i + 1)}
          >
            {t('formulario.siguiente')}
          </Boton>
        )}
      </div>
    </div>
  );
}
