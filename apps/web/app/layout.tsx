import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * La app que ve el usuario es HTML generado por `prototipo/construir.mjs` y
 * servido desde `public/`. Next aqui solo pone los endpoints y el portero, asi
 * que este layout existe unicamente para las paginas de error de Next.
 */
export const metadata: Metadata = {
  title: 'Gastos',
  description: 'Gastos personales, presupuesto y cuentas compartidas',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
