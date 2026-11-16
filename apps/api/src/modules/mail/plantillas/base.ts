import { LOCALES, type Locale } from '@ecom/shared';

/**
 * Plantillas de email.
 *
 * Se escriben con tablas y estilos en línea, no con CSS moderno. No es
 * nostalgia: Outlook renderiza con el motor de Word, Gmail elimina las
 * etiquetas `<style>` en algunos clientes, y `flex` o `grid` sencillamente no
 * existen en la mitad de los lectores. Una plantilla bonita que se ve rota en
 * Outlook es una plantilla rota.
 *
 * Se envían siempre en HTML y texto plano a la vez: algunos clientes muestran
 * solo el texto, y los filtros de spam penalizan los correos sin versión
 * alternativa.
 */

export interface Marca {
  nombre: string;
  colorPrimario: string;
  logoUrl?: string | null;
  urlTienda: string;
}

export interface ContenidoEmail {
  asunto: string;
  html: string;
  texto: string;
}

/** Escapa el texto que se inserta en HTML: los nombres de cliente vienen de fuera. */
export function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function precio(centimos: number, locale: Locale = 'es'): string {
  return new Intl.NumberFormat(locale === 'ca' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES', {
    style: 'currency',
    currency: 'EUR',
  }).format(centimos / 100);
}

export function esLocaleValido(valor: string): valor is Locale {
  return (LOCALES as readonly string[]).includes(valor);
}

/**
 * Envoltorio común: cabecera con la marca, cuerpo y pie.
 *
 * El ancho máximo de 600 px es el estándar de facto: por encima, los clientes
 * de escritorio recortan y en móvil obliga a desplazamiento horizontal.
 */
export function envolver(marca: Marca, cuerpo: string, textoPie?: string): string {
  const cabecera = marca.logoUrl
    ? `<img src="${escapar(marca.logoUrl)}" alt="${escapar(marca.nombre)}" width="140" style="display:block;border:0;max-width:140px;height:auto">`
    : `<span style="font:600 20px -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${escapar(marca.colorPrimario)}">${escapar(marca.nombre)}</span>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapar(marca.nombre)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;-webkit-font-smoothing:antialiased">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f7">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%">

          <tr>
            <td style="padding:0 0 24px">${cabecera}</td>
          </tr>

          <tr>
            <td style="background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
              ${cuerpo}
            </td>
          </tr>

          <tr>
            <td style="padding:24px 8px;font:400 12px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#9ca3af">
              ${textoPie ? `${escapar(textoPie)}<br><br>` : ''}
              <a href="${escapar(marca.urlTienda)}" style="color:#9ca3af">${escapar(marca.nombre)}</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Párrafo con el estilo del cuerpo. */
export function p(texto: string): string {
  return `<p style="margin:0 0 16px;font:400 15px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#374151">${texto}</p>`;
}

export function h1(texto: string): string {
  return `<h1 style="margin:0 0 16px;font:600 22px/1.3 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#111827">${escapar(texto)}</h1>`;
}

/**
 * Botón de acción.
 *
 * Se construye con una tabla y no con un `<a>` estilado porque Outlook ignora
 * el `padding` en los enlaces y el botón queda como texto suelto.
 */
export function boton(texto: string, url: string, color: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
    <tr>
      <td style="background:${escapar(color)};border-radius:8px">
        <a href="${escapar(url)}" style="display:inline-block;padding:12px 24px;font:500 15px -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#ffffff;text-decoration:none">${escapar(texto)}</a>
      </td>
    </tr>
  </table>`;
}

/** Enlace en texto plano, por si el botón no se pinta. */
export function enlaceAlternativo(url: string): string {
  return `<p style="margin:0 0 16px;font:400 13px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#9ca3af;word-break:break-all">
    Si el botón no funciona, copia este enlace en tu navegador:<br>${escapar(url)}
  </p>`;
}

export function separador(): string {
  return `<hr style="margin:24px 0;border:0;border-top:1px solid #e5e7eb">`;
}
