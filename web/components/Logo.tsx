// NP-Master mark. Two strands of a DNA helix with a highlighted
// "region" segment in brand colour, suggesting a BGC call. The mark is
// visually distinct at 16-32px (no two intersecting curves to muddle).
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Backbone (lighter, behind) */}
      <path
        d="M6 4c0 4 8 6 10 12s-8 8-10 12"
        stroke="currentColor"
        strokeOpacity="0.32"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M26 4c0 4-8 6-10 12s8 8 10 12"
        stroke="currentColor"
        strokeOpacity="0.32"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      {/* Cross rungs */}
      <line x1="9"  y1="9"  x2="23" y2="9"  stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="9"  y1="23" x2="23" y2="23" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.6" strokeLinecap="round" />
      {/* Highlighted BGC region — solid pill in brand colour */}
      <rect x="10" y="14" width="12" height="4.5" rx="2.25" fill="currentColor" />
    </svg>
  );
}
