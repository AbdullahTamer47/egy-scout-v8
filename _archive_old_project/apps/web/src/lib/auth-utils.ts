import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth";
import { Session } from "next-auth";

export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  return session?.user;
}

export function requireRole(session: Session | null, roles: string[]) {
  if (!session?.user?.role || !roles.includes(session.user.role)) {
    throw new Error("Unauthorized");
  }
}

export function isHeadCoach(session: Session | null) {
  return session?.user?.role === 'head_coach';
}

export function isScout(session: Session | null) {
  return session?.user?.role === 'scout';
}

export function canViewSensitiveData(session: Session | null) {
  return isHeadCoach(session) || isScout(session);
}
