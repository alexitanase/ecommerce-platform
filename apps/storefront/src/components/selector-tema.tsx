'use client';

import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useEsCliente } from '@/lib/use-es-cliente';
import { Icono } from './ui/icono';

export function SelectorTema() {
  const { setTheme, resolvedTheme } = useTheme();
  const t = useTranslations('nav');

  // El tema real solo se conoce en el navegador: pintarlo antes produciría
  // una discrepancia entre el HTML del servidor y el del cliente.
  const montado = useEsCliente();

  const esOscuro = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(esOscuro ? 'light' : 'dark')}
      className="btn btn-fantasma btn-icono"
      aria-label={montado ? (esOscuro ? t('tema_claro') : t('tema_oscuro')) : t('tema')}
      title={t('tema')}
    >
      {!montado ? (
        <span className="h-4 w-4" />
      ) : esOscuro ? (
        <Icono nombre="sol" />
      ) : (
        <Icono nombre="luna" />
      )}
    </button>
  );
}
