// Prisma client singleton for Express.js
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default prisma;
