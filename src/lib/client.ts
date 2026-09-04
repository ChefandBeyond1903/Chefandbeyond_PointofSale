"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Fetch JSON from our own API, throwing ApiError on non-2xx. */
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    if (body && typeof body === "object" && "error" in body) {
      msg = String((body as { error: unknown }).error);
    }
    // Session ended (signed out elsewhere, deactivated, expired) — bounce to
    // the login page instead of surfacing a raw error on every widget.
    if (
      res.status === 401 &&
      typeof window !== "undefined" &&
      window.location.pathname !== "/login" &&
      !path.startsWith("/api/auth/login")
    ) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login?next=${next}`);
    }
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}
