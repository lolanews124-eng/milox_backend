import type { UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: {
        userId: string;
        role: UserRole;
        emailVerified: boolean;
      };
    }
  }
}

export {};
