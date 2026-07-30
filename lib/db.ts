import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@/lib/generated/prisma';

/**
 * Resolves the database URL, and on a serverless host makes the file writable
 * first.
 *
 * A Vercel function's filesystem is read-only apart from `/tmp`, and SQLite
 * cannot open a database for writing without also writing a journal beside it —
 * so pointing Prisma straight at the bundled file fails on the first INSERT
 * rather than at startup, which is the worst place to find out.
 *
 * So at cold start we copy the seeded file that `outputFileTracingIncludes` put
 * in the bundle (see next.config.ts) into `/tmp`, and use that. The demo then
 * reads and writes exactly like a local install. The copy is per-instance, so
 * writes live as long as that instance does and are gone when it recycles — an
 * honest trade for a prototype with no provisioned database, and explicitly NOT
 * something to put in front of real users.
 *
 * Set DATABASE_URL to a real Postgres and this branch stops running entirely —
 * see the note above `datasource db` in prisma/schema.prisma for the two other
 * lines that change.
 */
function resolveDatabaseUrl(): string | undefined {
  const configured = process.env.DATABASE_URL;

  // Not serverless, or a real database is configured: use it as-is.
  if (!process.env.VERCEL) return configured;
  if (configured && !configured.startsWith('file:')) return configured;

  const bundled = path.join(process.cwd(), 'prisma', 'demo.db');
  const writable = '/tmp/1buy-demo.db';

  if (!existsSync(writable)) {
    if (!existsSync(bundled)) {
      // Fail loudly and specifically. The alternative is Prisma reporting a
      // missing table, which sends you reading the schema instead of looking at
      // the build that dropped the file.
      throw new Error(
        `The bundled demo database is missing from this deployment. Expected it at ${bundled}. ` +
          `Check outputFileTracingIncludes in next.config.ts, and that prisma/demo.db is committed.`,
      );
    }
    copyFileSync(bundled, writable);
  }

  return `file:${writable}`;
}

/**
 * Single Prisma client across hot reloads in development, so the dev server
 * doesn't exhaust SQLite connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: resolveDatabaseUrl() } },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
