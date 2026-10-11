// The selected Waltz mark, shared by the sidebar, launch screen, and settings.
export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg className={'brand-mark ' + className} viewBox="0 0 100 100" aria-label="Sheco" role="img">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 30C33 9 71 15 78 34C86 52 70 58 56 60" />
        <path d="M82 70C67 91 29 85 22 66C14 48 30 42 44 40" />
      </g>
    </svg>
  )
}
