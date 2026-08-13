import Link from "next/link";
import { getOptionalUser } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/server";

export default async function HomePage() {
  const [user, locale] = await Promise.all([getOptionalUser(), getServerLocale()]);
  const t = getDictionary(locale);

  return (
    <div className="mx-auto max-w-6xl">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="grid items-center gap-10 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:py-20">
        <div className="animate-fade-in">
          <div className="inline-flex items-center gap-2 rounded-pill border border-white/[0.08] bg-white/[0.03] px-3 py-1 font-mono text-[11px] tracking-wide text-fg-muted">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-pill bg-brand" />
            {t.home.eyebrow}
          </div>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.12] tracking-[-0.02em] sm:text-5xl">
            {t.home.titleA}
            <span className="text-brand">BGC</span>
            {t.home.titleB}
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-7 text-fg-muted">
            {t.home.subtitle}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/submit" className="btn-primary rounded-btn px-5 py-2.5 text-sm font-semibold">
              {t.home.ctaPrimary}
            </Link>
            <Link
              href="/jobs"
              className="rounded-btn border border-white/[0.1] px-5 py-2.5 text-sm font-medium text-fg transition hover:border-white/25 hover:bg-white/[0.03]"
            >
              {t.home.ctaSecondary}
            </Link>
            <span className="text-xs text-fg-subtle">
              {user ? `${t.home.loggedInAs} ${user.email}` : t.home.anonNote}
            </span>
          </div>
        </div>

        <HeroVisual />
      </section>

      {/* ── Pipeline ─────────────────────────────────────────── */}
      <section className="border-t border-white/[0.06] py-12">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {t.home.steps.map((step, i) => (
            <Step key={step.title} n={`0${i + 1}`} title={step.title} desc={step.desc} />
          ))}
        </div>
      </section>

      {/* ── Methods ──────────────────────────────────────────── */}
      <section className="grid gap-3 pb-14 sm:grid-cols-3">
        {t.home.methods.map((method) => (
          <Method key={method.tag} tag={method.tag} title={method.title} desc={method.desc} />
        ))}
      </section>
    </div>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="panel p-4">
      <div className="font-mono text-[11px] tracking-widest text-brand">{n}</div>
      <div className="mt-2 text-sm font-semibold">{title}</div>
      <div className="mt-1 text-xs leading-5 text-fg-muted">{desc}</div>
    </div>
  );
}

function Method({ tag, title, desc }: { tag: string; title: string; desc: string }) {
  return (
    <div className="panel p-5">
      <div className="font-mono text-[10px] tracking-[0.18em] text-fg-subtle">{tag}</div>
      <div className="mt-2 text-[15px] font-semibold">{title}</div>
      <div className="mt-1.5 text-[13px] leading-6 text-fg-muted">{desc}</div>
    </div>
  );
}

// Decorative genome-browser visual: score curve, called regions, gene arrows.
function HeroVisual() {
  const scores = [
    6, 8, 7, 10, 14, 22, 38, 55, 72, 84, 90, 86, 74, 58, 40, 26, 16, 11, 8, 9,
    12, 18, 30, 47, 63, 78, 88, 92, 85, 70, 52, 35, 22, 14, 10, 8, 7, 9, 12, 11,
  ];
  const W = 560;
  const H = 210;
  const BASE = 168;
  const AMP = 120;
  const step = W / (scores.length - 1);
  const pts = scores.map((s, i) => [i * step, BASE - (s / 100) * AMP] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W},${BASE} L0,${BASE} Z`;

  return (
    <div className="bg-grid-faint panel relative overflow-hidden p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="BGC score track">
        <defs>
          <linearGradient id="hero-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(94,234,212)" />
            <stop offset="100%" stopColor="rgb(167,139,250)" />
          </linearGradient>
          <linearGradient id="hero-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(94,234,212)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="rgb(94,234,212)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <rect x={step * 7} y={34} width={step * 10} height={BASE - 30} rx="6" fill="rgb(167,139,250)" fillOpacity="0.13" stroke="rgb(167,139,250)" strokeOpacity="0.4" strokeDasharray="5 4" />
        <rect x={step * 24} y={34} width={step * 9} height={BASE - 30} rx="6" fill="rgb(94,234,212)" fillOpacity="0.12" stroke="rgb(94,234,212)" strokeOpacity="0.4" strokeDasharray="5 4" />

        <line x1="0" x2={W} y1={BASE - 0.8 * AMP} y2={BASE - 0.8 * AMP} stroke="rgb(226,232,240)" strokeOpacity="0.25" strokeDasharray="3 5" />

        <path d={area} fill="url(#hero-fill)" />
        <path d={line} fill="none" stroke="url(#hero-line)" strokeWidth="2" strokeLinejoin="round" />

        <line x1="0" x2={W} y1={BASE} y2={BASE} stroke="rgb(148,163,184)" strokeOpacity="0.4" />

        {[
          { x: step * 7.6, c: "rgb(167,139,250)" },
          { x: step * 10.2, c: "rgb(167,139,250)" },
          { x: step * 13.4, c: "rgb(167,139,250)" },
          { x: step * 24.6, c: "rgb(94,234,212)" },
          { x: step * 27.4, c: "rgb(94,234,212)" },
          { x: step * 30.2, c: "rgb(94,234,212)" },
        ].map((g, i) => (
          <polygon
            key={i}
            points={`${g.x},${BASE + 16} ${g.x + 42},${BASE + 16} ${g.x + 52},${BASE + 26} ${g.x + 42},${BASE + 36} ${g.x},${BASE + 36}`}
            fill={g.c}
            fillOpacity="0.85"
          />
        ))}
      </svg>
      <div className="flex justify-between px-1 pb-1 font-mono text-[10px] text-fg-subtle">
        <span>contig score track</span>
        <span>2 regions called</span>
      </div>
    </div>
  );
}
