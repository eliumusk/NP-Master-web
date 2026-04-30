"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPhase("working");
    const supabase = createClient();

    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setPhase("error");
        toast.error(error.message);
        return;
      }
      toast.success("登录成功");
      router.push("/jobs");
      router.refresh();
      return;
    }

    if (!token) {
      setPhase("error");
      toast.error("请先完成人机校验");
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) {
      setPhase("error");
      toast.error(error.message);
    } else {
      setPhase("sent");
      toast.success("魔链已发送，检查邮箱（包括垃圾邮件箱）");
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">登录</h1>

      <div className="flex gap-1 rounded-btn border border-border p-0.5 text-sm">
        {([
          { v: "password", label: "密码" },
          { v: "magic",    label: "邮箱魔链" },
        ] as const).map((t) => (
          <button
            key={t.v}
            type="button"
            onClick={() => { setMode(t.v); setPhase("idle"); }}
            className={`flex-1 rounded-btn px-3 py-1.5 transition-colors ${
              mode === t.v
                ? "bg-fg text-bg"
                : "text-fg-muted hover:bg-elevated hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mode === "magic" && phase === "sent" ? (
        <div className="rounded-card border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          魔链已发送。检查收件箱（也可能在垃圾邮件文件夹）。
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-fg">邮箱</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full rounded-btn border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle"
              placeholder="you@example.org"
              autoComplete="email"
            />
          </label>

          {mode === "password" && (
            <label className="block">
              <span className="text-sm font-medium text-fg">密码</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-btn border border-border bg-surface px-3 py-2 text-sm text-fg"
                autoComplete="current-password"
              />
            </label>
          )}

          {mode === "magic" && <TurnstileWidget onToken={setToken} />}

          <button
            type="submit"
            disabled={phase === "working"}
            className="w-full rounded-btn bg-brand px-4 py-2 text-sm font-medium text-brand-fg shadow-sm transition-all hover:opacity-90 disabled:opacity-50"
          >
            {phase === "working" ? "处理中…" : mode === "password" ? "登录" : "发送魔链"}
          </button>
        </form>
      )}

      {mode === "password" && (
        <p className="text-xs text-fg-muted">
          没有密码？联系管理员在 Supabase 控制台 → Authentication → Users 创建账号。
        </p>
      )}
    </div>
  );
}
