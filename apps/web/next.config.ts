import type { NextConfig } from 'next';

const config: NextConfig = {
  // Los paquetes del monorepo se publican como TypeScript sin compilar.
  transpilePackages: ['@gastos/core', '@gastos/db'],
  typedRoutes: true,

  /**
   * Los dos motores de base se cargan bajo demanda segun el entorno. PGlite
   * ademas trae un binario WebAssembly, que el empaquetador no debe tocar.
   */
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],

  /**
   * El nucleo importa con extension `.js` porque asi lo exige el resolutor de
   * modulos de Node. Webpack y Turbopack necesitan que se les diga que detras
   * de cada `.js` hay en realidad un `.ts`.
   */
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'],
  },
  webpack(webpackConfig) {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return webpackConfig;
  },
};

export default config;
