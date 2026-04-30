// SVG illustration of the NP-Master pipeline. Shows up on the landing page
// hero (right column). Three stages: FASTA → Evo2 forward → BGC region calls.
//
// The diagram is intentionally schematic (not a real screenshot) so it
// works for users who haven't tried the product yet.

export function PipelineDiagram({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 480 360"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="NP-Master 流水线示意图"
    >
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="rgb(241,245,249)" />
          <stop offset="100%" stopColor="rgb(248,250,252)" />
        </linearGradient>
        <linearGradient id="bg-dark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="rgb(15,23,42)" />
          <stop offset="100%" stopColor="rgb(2,6,23)" />
        </linearGradient>

        <linearGradient id="rail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="rgb(99,102,241)" stopOpacity="0.0" />
          <stop offset="50%"  stopColor="rgb(99,102,241)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="rgb(99,102,241)" stopOpacity="0.0" />
        </linearGradient>

        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" stroke="currentColor" strokeOpacity="0.05" strokeWidth="1" fill="none" />
        </pattern>
      </defs>

      {/* Background card */}
      <rect x="0" y="0" width="480" height="360" rx="16" className="fill-elevated" />
      <rect x="0" y="0" width="480" height="360" rx="16" fill="url(#grid)" className="text-fg" />

      {/* Browser chrome */}
      <rect x="16" y="16" width="448" height="22" rx="6" className="fill-surface" />
      <circle cx="28" cy="27" r="3.5" fill="#ef4444" opacity="0.6" />
      <circle cx="40" cy="27" r="3.5" fill="#f59e0b" opacity="0.6" />
      <circle cx="52" cy="27" r="3.5" fill="#10b981" opacity="0.6" />

      {/* Stage 1: FASTA */}
      <g transform="translate(28, 60)">
        <rect width="120" height="80" rx="10" className="fill-surface stroke-border" strokeWidth="1" />
        <text x="14" y="22" fontFamily="ui-monospace" fontSize="10" fill="rgb(100,116,139)">genome.fna</text>
        <text x="14" y="38" fontFamily="ui-monospace" fontSize="9" fill="rgb(99,102,241)">{">DS999645.1"}</text>
        <text x="14" y="50" fontFamily="ui-monospace" fontSize="9" fill="rgb(148,163,184)">ATGGCATCG…</text>
        <text x="14" y="60" fontFamily="ui-monospace" fontSize="9" fill="rgb(148,163,184)">CGTAGCTAA…</text>
        <text x="14" y="70" fontFamily="ui-monospace" fontSize="9" fill="rgb(148,163,184)">TTACGGCAT…</text>
        <text x="14" y="98" fontSize="11" fontWeight="600" fill="currentColor" className="text-fg">FASTA</text>
      </g>

      {/* Arrow 1 */}
      <line x1="155" y1="100" x2="195" y2="100" stroke="url(#rail)" strokeWidth="2.5" />
      <polygon points="195,100 188,96 188,104" fill="rgb(99,102,241)" opacity="0.55" />

      {/* Stage 2: Evo2 + U-Net */}
      <g transform="translate(200, 60)">
        <rect width="120" height="80" rx="10" className="fill-surface stroke-border" strokeWidth="1" />
        <text x="60" y="22" fontSize="11" fontWeight="600" textAnchor="middle" fill="currentColor" className="text-fg">Evo2 7B</text>
        <text x="60" y="34" fontSize="9" fill="rgb(100,116,139)" textAnchor="middle">+ 1D U-Net</text>
        {/* Tiny waveform suggesting per-token sigmoid */}
        <polyline
          points="14,68 22,55 30,62 38,48 46,52 54,42 62,46 70,40 78,52 86,46 94,58 102,55"
          fill="none" stroke="rgb(99,102,241)" strokeWidth="1.6" strokeLinecap="round"
        />
        <text x="60" y="98" fontSize="11" fontWeight="600" fill="currentColor" className="text-fg" textAnchor="middle">特征 + 检测</text>
      </g>

      {/* Arrow 2 */}
      <line x1="327" y1="100" x2="367" y2="100" stroke="url(#rail)" strokeWidth="2.5" />
      <polygon points="367,100 360,96 360,104" fill="rgb(99,102,241)" opacity="0.55" />

      {/* Stage 3: Region calls */}
      <g transform="translate(372, 60)">
        <rect width="80" height="80" rx="10" className="fill-surface stroke-border" strokeWidth="1" />
        {/* Region pills */}
        <rect x="10" y="22" width="34" height="6"  rx="3" fill="#3b82f6" />
        <rect x="48" y="22" width="22" height="6"  rx="3" fill="#10b981" />
        <rect x="10" y="34" width="20" height="6"  rx="3" fill="#8b5cf6" />
        <rect x="34" y="34" width="36" height="6"  rx="3" fill="#f97316" />
        <rect x="10" y="46" width="42" height="6"  rx="3" fill="#3b82f6" />
        <rect x="56" y="46" width="14" height="6"  rx="3" fill="#ef4444" />
        <rect x="10" y="58" width="28" height="6"  rx="3" fill="#10b981" />
        <rect x="42" y="58" width="28" height="6"  rx="3" fill="#ec4899" />
        <text x="40" y="98" fontSize="11" fontWeight="600" fill="currentColor" className="text-fg" textAnchor="middle">区域 + 类型</text>
      </g>

      {/* IGV mock track at bottom */}
      <g transform="translate(28, 200)">
        <rect width="424" height="120" rx="10" className="fill-surface stroke-border" strokeWidth="1" />
        {/* Coordinate ruler */}
        <line x1="14" y1="20" x2="410" y2="20" stroke="currentColor" className="text-fg-subtle" strokeWidth="0.5" opacity="0.3" />
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <line key={i} x1={14 + i * 49.5} y1="16" x2={14 + i * 49.5} y2="24" stroke="currentColor" className="text-fg-subtle" strokeWidth="0.5" opacity="0.4" />
        ))}
        {/* Score wave (like real bedgraph) */}
        <path
          d="M14,55 Q40,48 60,52 T100,42 T150,38 T200,30 T260,28 T320,40 T370,48 T410,52"
          stroke="rgb(99,102,241)"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M14,55 Q40,48 60,52 T100,42 T150,38 T200,30 T260,28 T320,40 T370,48 T410,52 L410,75 L14,75 Z"
          fill="rgb(99,102,241)"
          fillOpacity="0.15"
        />
        {/* Region blocks (BED-like) */}
        <rect x="60"  y="85" width="80"  height="10" rx="3" fill="#3b82f6" />
        <rect x="160" y="85" width="40"  height="10" rx="3" fill="#10b981" />
        <rect x="220" y="85" width="55"  height="10" rx="3" fill="#8b5cf6" />
        <rect x="290" y="85" width="35"  height="10" rx="3" fill="#f97316" />
        <rect x="340" y="85" width="60"  height="10" rx="3" fill="#3b82f6" />
        {/* Track labels */}
        <text x="14" y="108" fontSize="8" fontFamily="ui-monospace" fill="rgb(100,116,139)">BGC score · BGC regions · IGV.js</text>
      </g>
    </svg>
  );
}
