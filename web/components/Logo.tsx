// Inline SVG wordmark + double-helix-with-region mark.
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M5 4c0 4 14 4 14 8s-14 4-14 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M5 20c0-4 14-4 14-8S5 8 5 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.55"
      />
      <rect x="9" y="10.5" width="6" height="3" rx="1" fill="currentColor" />
    </svg>
  );
}
