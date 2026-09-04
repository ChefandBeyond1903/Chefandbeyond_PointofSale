/**
 * Single active session per user. Login writes a fresh random token to both
 * `User.sessionToken` and this cookie; every request checks that they still
 * match (see `getCurrentUser`). A login on another device rotates the token,
 * so the previous device's cookie no longer matches and it's signed out.
 */
export const SESSION_COOKIE = "cb_session";

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30, // 30 days
};
