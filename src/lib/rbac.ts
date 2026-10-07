import type { Role } from "./types";

/** Capability-based RBAC. Handlers ask "can this role do X?", never "is this role Y?". */
export const PERMISSIONS = {
  "order:create": ["CUSTOMER"],
  "order:read:pharmacy": ["PHARMACY_ADMIN", "PHARMACIST"],
  "order:fulfil": ["PHARMACY_ADMIN", "PHARMACIST"],
  "prescription:review": ["PHARMACIST", "PHARMACY_ADMIN"],
  "inventory:manage": ["PHARMACY_ADMIN", "PHARMACIST"],
  "pharmacy:manage": ["PHARMACY_ADMIN"],
  "pharmacy:finance": ["PHARMACY_ADMIN"],
  "delivery:execute": ["DELIVERY_PARTNER"],
  "admin:read": ["SUPER_ADMIN"],
  "admin:write": ["SUPER_ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** First path segment → roles allowed. Enforced in proxy.ts and again inside API handlers. */
export const AREA_ROLES: Record<string, readonly Role[]> = {
  pharmacy: ["PHARMACY_ADMIN", "PHARMACIST"],
  delivery: ["DELIVERY_PARTNER"],
  admin: ["SUPER_ADMIN"],
};

export function homeFor(role: Role): string {
  switch (role) {
    case "PHARMACY_ADMIN":
    case "PHARMACIST":
      return "/pharmacy";
    case "DELIVERY_PARTNER":
      return "/delivery";
    case "SUPER_ADMIN":
      return "/admin";
    default:
      return "/";
  }
}
