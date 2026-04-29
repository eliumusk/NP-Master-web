"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TurnstileWidget } from "@/components/TurnstileWidget";

type Mode = "password" | "magic";
type Phase = "idle" | "working" | "sent" | "error";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPhase("working");
    const supabase = createClient();

    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setPhase("error");
        return;
      }
      router.push("/jobs");
      router.refresh();
      return;
    }

    // magic link
    if (!token) {
      setError("Please complete the Turnstile challenge.");
      setPhase("error");
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setPhase("error");
    } else {
      setPhase("sent");
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>

      <div className="flex gap-1 rounded-md border border-slate-200 p-1 text-sm dark:border-slate-800">
        <button
          type="button"
          onClick={() => { setMode("password"); setPhase("idle"); setError(null); }}
          className={`flex-1 rounded-md px-3 py-1.5 ${mode === "password" ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : ""}`}
        >
          Password
        </button>
        <button
          type="button"
          onClick={() => { setMode("magic"); setPhase("idle"); setError(null); }}
          className={`flex-1 rounded-md px-3 py-1.5 ${mode === "magic" ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : ""}`}
        >
          Magic link
        </button>
      </div>

      {mode === "magic" && phase === "sent" ? (
        <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          Magic link sent. Check your inbox (and spam folder).
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              placeholder="you@example.org"
              autoComplete="email"
            />
          </label>

          {mode === "password" && (
            <label className="block">
              <span className="text-sm font-medium">Password</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                autoComplete="current-password"
              />
            </label>
          )}

          {mode === "magic" && <TurnstileWidget onToken={setToken} />}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={phase === "working"}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {phase === "working" ? "Working…" : mode === "password" ? "Sign in" : "Send magic link"}
          </button>
        </form>
      )}

      {mode === "password" && (
        <p className="text-xs text-slate-500">
          No password? Ask the project admin to create one for you in Supabase → Authentication → Users.
        </p>
      )}
    </div>
  );
}
