/** Marca do FaceGate: rosto dentro de uma moldura de enquadramento. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 20V8h12M44 8h12v12M56 44v12H44M20 56H8V44" />
      <circle cx="32" cy="27" r="9" />
      <path d="M29 26h.01M35 26h.01" strokeWidth="3" />
      <path d="M21 46c2.4-5.4 6.4-8 11-8s8.6 2.6 11 8" />
    </svg>
  )
}
