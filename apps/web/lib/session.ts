import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

/**
 * Stateless session cookie.
 *
 * Sessions are a signed JWT rather than a database row because the web app
 * cannot reach Postgres — Vercel sits outside Railway's private network. The
 * trade-off is that a session cannot be revoked server-side before it expires,
 * so the lifetime is deliberately short-ish and the cookie is locked down.
 */
const COOKIE = "defenex_session";
const MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

export interface Session {
  userId: string;
  email: string;
  isAdmin: boolean;
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET must be set to at least 32 characters");
  }
  return new TextEncoder().encode(value);
}

export async function createSession(session: Session): Promise<void> {
  const token = await new SignJWT({ email: session.email, isAdmin: session.isAdmin })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return {
      userId: payload.sub,
      email: String(payload.email ?? ""),
      isAdmin: payload.isAdmin === true,
    };
  } catch {
    // Expired or tampered — treated as signed out, never as an error.
    return null;
  }
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
