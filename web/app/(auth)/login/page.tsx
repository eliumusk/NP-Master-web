"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "magic";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const supabase = createClient();

    const result = mode === "password"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${location.origin}/auth/callback` },
        });

    setBusy(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    if (mode === "magic") {
      setMessage("登录链接已发送，请检查邮箱。");
      return;
    }
    router.push("/jobs");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">登录</h1>
        <p className="mt-1 text-sm text-fg-muted">登录后可以提交批量任务，并长期保留任务记录。</p>
      </div>

      <div className="flex gap-1 rounded-btn border border-border p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setMode("password")}
          className={`flex-1 rounded-btn px-3 py-1.5 ${mode === "password" ? "bg-fg text-bg" : "text-fg-muted hover:bg-elevated"}`}
        >
          密码登录
        </button>
        <button
          type="button"
          onClick={() => setMode("magic")}
          className={`flex-1 rounded-btn px-3 py-1.5 ${mode === "magic" ? "bg-fg text-bg" : "text-fg-muted hover:bg-elevated"}`}
        >
          邮箱链接
        </button>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">邮箱</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-btn border border-border bg-surface px-3 py-2 text-sm"
            autoComplete="email"
          />
        </label>
        {mode === "password" && (
          <label className="block">
            <span className="text-sm font-medium">密码</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-btn border border-border bg-surface px-3 py-2 text-sm"
              autoComplete="current-password"
            />
          </label>
        )}
        {message && (
          <div className="rounded-card border border-border bg-elevated/40 p-3 text-sm text-fg-muted">
            {message}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-btn bg-brand px-4 py-2 text-sm font-medium text-brand-fg disabled:opacity-50"
        >
          {busy ? "处理中..." : mode === "password" ? "登录" : "发送登录链接"}
        </button>
      </form>
    </div>
  );
}
