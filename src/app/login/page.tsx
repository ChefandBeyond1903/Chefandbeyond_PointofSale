"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import type { SessionUser } from "@/lib/types";

function LoginForm() {
  const params = useSearchParams();
  const nextParam = params.get("next");
  const idleReason = params.get("reason") === "idle";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: SessionUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, remember }),
      });
      // An admin with no explicit destination lands on their Overview.
      // A full page load (not a client-side route change) lets the browser
      // notice a successful sign-in and offer to save / update the password.
      window.location.assign(nextParam || (user.role === "ADMIN" ? "/overview" : "/"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-header.webp"
            alt="Chef and Beyond"
            className="mx-auto h-20 w-auto"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
          <h1 className="sr-only">Chef and Beyond POS</h1>
          <p className="mt-2 text-sm text-zinc-500">Sign in to your register</p>
        </div>

        {idleReason && (
          <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
            You were signed out after 10 minutes of inactivity.
          </p>
        )}

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className="input pr-16"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-indigo-600"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Keep me signed in for 30 days
          </label>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
