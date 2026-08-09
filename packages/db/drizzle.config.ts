import type { Config } from 'drizzle-kit';

export default {
  schema: './src/esquema.ts',
  out: './migraciones',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
} satisfies Config;
