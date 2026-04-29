"use client";

import { useEffect, useRef } from "react";

type RenderFn = (
  el: HTMLElement,
  opts: { sitekey: string; callback: (token: string) => void; "error-callback"?: () => void; theme?: string },
) => string;

declare global {
  interface Window {
    turnstile?: { render: RenderFn };
    onTurnstileLoad?: () => void;
  }
}

export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    const id = "cf-turnstile-script";
    const render = () => {
      if (window.turnstile && ref.current) {
        window.turnstile.render(ref.current, { sitekey: siteKey, callback: onToken });
      }
    };
    if (window.turnstile) {
      render();
      return;
    }
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit";
      s.async = true;
      window.onTurnstileLoad = render;
      document.head.appendChild(s);
    } else {
      window.onTurnstileLoad = render;
    }
  }, [siteKey, onToken]);

  if (!siteKey) {
    return (
      <p className="text-xs text-amber-600">
        Turnstile not configured (set <code>NEXT_PUBLIC_TURNSTILE_SITE_KEY</code>); skipping in dev.
      </p>
    );
  }
  return <div ref={ref} />;
}
