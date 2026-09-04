"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import type { SessionUser } from "@/lib/types";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextParam = params.get("next");
  const idleReason = params.get("reason") === "idle";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      router.push(nextParam || (user.role === "ADMIN" ? "/overview" : "/"));
      router.refresh();
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
            You were signed out after 5 minutes of inactivity.
          </p>
        )}

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
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
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
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
