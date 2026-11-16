'use client';

import { ThemeProvider } from 'next-themes';

/**
 * Tema claro/oscuro.
 *
 * `disableTransitionOnChange` evita que TODOS los elementos animen su color a
 * la vez al cambiar de tema: sin eso, el cambio se ve como un barrido lento y
 * desagradable en lugar de instantáneo.
 */
export function ProveedorTema({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </ThemeProvider>
  );
}
