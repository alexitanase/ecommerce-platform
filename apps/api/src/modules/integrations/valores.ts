import type { ConfiguracionIntegracion } from './integraciones.service.js';

/**
 * Lectura de los ajustes de una integración con su tipo.
 *
 * Los ajustes se guardan como JSON, así que salen como `unknown`. Sin estas
 * funciones, cada consumidor los convertiría a su manera —`String(valor)` sobre
 * algo que resultó ser un objeto da "[object Object]" y acaba de anfitrión SMTP—
 * y el fallo aparece en forma de correos que no salen.
 */

export function ajusteTexto(
  config: ConfiguracionIntegracion | null,
  clave: string,
  porDefecto = '',
): string {
  const valor = config?.ajustes[clave];
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  return porDefecto;
}

export function ajusteNumero(
  config: ConfiguracionIntegracion | null,
  clave: string,
  porDefecto: number,
): number {
  const valor = config?.ajustes[clave];
  const numero = typeof valor === 'string' ? Number(valor) : valor;

  return typeof numero === 'number' && Number.isFinite(numero) ? numero : porDefecto;
}

export function ajusteBooleano(
  config: ConfiguracionIntegracion | null,
  clave: string,
  porDefecto = false,
): boolean {
  const valor = config?.ajustes[clave];
  if (typeof valor === 'boolean') return valor;
  // El panel puede mandar "true"/"false" desde un formulario.
  if (typeof valor === 'string') return ['true', '1', 'sí', 'si'].includes(valor.toLowerCase());
  return porDefecto;
}
