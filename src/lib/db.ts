import { PrismaClient } from '@prisma/client';

// Next's dev server hot-reloads modules, which would otherwise open a new
// connection pool on every edit until SQLite refuses them. Stash the client on
// globalThis so reloads reuse it.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
