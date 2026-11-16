/** Todos los importes llegan en céntimos: aquí es donde se convierten. */
export function precio(centimos: number, locale = 'es'): string {
  return new Intl.NumberFormat(locale === 'ca' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES', {
    style: 'currency',
    currency: 'EUR',
  }).format(centimos / 100);
}

export function fechaHora(valor: string | Date, locale = 'es'): string {
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  return new Intl.DateTimeFormat(locale === 'ca' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function fechaRelativa(valor: string | Date, locale = 'es'): string {
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  const segundos = Math.round((d.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(
    locale === 'ca' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES',
    { numeric: 'auto' },
  );

  const unidades: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ];

  for (const [unidad, sec] of unidades) {
    if (Math.abs(segundos) >= sec || unidad === 'second') {
      return rtf.format(Math.round(segundos / sec), unidad);
    }
  }
  return '';
}

export function porcentaje(valor: number): string {
  return `${valor > 0 ? '' : ''}${String(Math.round(valor))}%`;
}
