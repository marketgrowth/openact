/** The Orbytt mark for the app rail: a planet with an orbit and a moon. It uses currentColor, so it follows the theme. */
export function OrbyttMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
      <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-30 12 12)" />
      <circle cx="19.4" cy="6" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
