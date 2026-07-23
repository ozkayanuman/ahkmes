import type { Role } from "@ahkmes/shared-types";

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
}

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
}
