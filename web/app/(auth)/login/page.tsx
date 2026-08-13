"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";

type Mode = "password" | "register" | "magic";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  const modes: Array<{ key: Mode; label: string }> = [
    { key: "password", label: t.auth.tabPassword },
    { key: "register", label: t.auth.tabRegister },
    { key: "magic", label: t.auth.tabMagic },
  ];

  function note(text: string, isError = false) {
    setMessage(text);
    setMessageIsError(isError);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const supabase = createClient();

    if (mode === "register") {
      if (password.length < 6) {
        setBusy(false);
        note(t.auth.errShort, true);
        return;
      }
      if (password !== password2) {
        setBusy(false);
        note(t.auth.errMismatch, true);
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      });
      setBusy(false);
      if (error) {
        note(error.message, true);
        return;
      }
      if (data.session) {
        router.push("/jobs");
        router.refresh();
        return;
      }
      if ((data.user?.identities?.length ?? 1) === 0) {
        note(t.auth.errRegistered, true);
        return;
      }
      note(t.auth.confirmSent);
      return;
    }

    const result = mode === "password"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${location.origin}/auth/callback` },
        });

    setBusy(false);
    if (result.error) {
      note(result.error.message, true);
      return;
    }
    if (mode === "magic") {
      note(t.auth.magicSent);
      return;
    }
    router.push("/jobs");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.auth.title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t.auth.subtitle}</p>
      </div>

      <div className="flex gap-1 rounded-btn border border-white/[0.08] bg-white/[0.02] p-1 text-sm">
        {modes.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => { setMode(m.key); setMessage(""); }}
            className={`flex-1 rounded-btn px-3 py-1.5 transition ${
              mode === m.key ? "bg-elevated text-fg" : "text-fg-muted hover:text-fg"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="panel space-y-4 p-5">
        <label className="block">
          <span className="text-sm font-medium">{t.auth.email}</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full rounded-btn border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm outline-none transition focus:border-brand/60"
            autoComplete="email"
          />
        </label>
        {mode !== "magic" && (
          <label className="block">
            <span className="text-sm font-medium">
              {t.auth.password}
              {mode === "register" && <span className="ml-1 text-xs text-fg-subtle">{t.auth.passwordHint}</span>}
            </span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-btn border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm outline-none transition focus:border-brand/60"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
          </label>
        )}
        {mode === "register" && (
          <label className="block">
            <span className="text-sm font-medium">{t.auth.confirmPassword}</span>
            <input
              type="password"
              required
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              className="mt-1.5 w-full rounded-btn border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm outline-none transition focus:border-brand/60"
              autoComplete="new-password"
            />
          </label>
        )}
        {message && (
          <div className={`rounded-card border p-3 text-sm ${
            messageIsError
              ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
              : "border-brand/30 bg-brand/10 text-brand"
          }`}>
            {message}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="btn-primary w-full rounded-btn px-4 py-2.5 text-sm font-semibold"
        >
          {busy ? t.auth.busy : mode === "password" ? t.auth.btnLogin : mode === "register" ? t.auth.btnRegister : t.auth.btnMagic}
        </button>
      </form>
    </div>
  );
}
