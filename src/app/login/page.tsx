"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import type { SessionUser } from "@/lib/types";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

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
      await api<{ user: SessionUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, remember }),
      });
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            CB
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">CB POS</h1>
            <p className="text-xs text-zinc-500">Sign in to your register</p>
          </div>
        </div>

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

        <div className="mt-4 rounded-md border border-zinc-200 bg-white p-3 text-xs text-zinc-500">
          <p className="font-medium text-zinc-600">Demo accounts</p>
          <p>admin@cbpos.local / password123</p>
          <p>manager@cbpos.local / password123</p>
          <p>cashier@cbpos.local / password123</p>
        </div>
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
