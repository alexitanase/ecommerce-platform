/**
 * Tema del admin.
 *
 * Se aplica también en index.html antes de que React arranque, para que la
 * pantalla no parpadee en blanco al cargar con el tema oscuro puesto.
 */
const CLAVE = 'tema-admin';

export type Tema = 'light' | 'dark' | 'system';

export function temaGuardado(): Tema {
  return (localStorage.getItem(CLAVE) as Tema | null) ?? 'system';
}

export function esOscuro(tema: Tema = temaGuardado()): boolean {
  if (tema === 'dark') return true;
  if (tema === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function aplicarTema(tema: Tema): void {
  localStorage.setItem(CLAVE, tema);
  document.documentElement.classList.toggle('dark', esOscuro(tema));
}
