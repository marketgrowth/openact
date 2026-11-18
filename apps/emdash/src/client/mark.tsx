/** The EmDash rail mark: a long dash. Drawn with currentColor at 16 by 16, like the Lucide icons. */
export function EmdashMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true" className={className}>
      <rect x="1.5" y="7" width="13" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}
