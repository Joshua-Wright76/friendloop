import { copy } from "@/lib/copy";

/**
 * The one close control for every dialog and sheet: a 44px round icon button in the
 * top-right corner, always labelled "Close". The dialog (or sheet) must be positioned.
 */
export function DialogClose({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="dialog-close" aria-label={copy.common.close} onClick={onClick}>
      <svg viewBox="0 0 20 20" aria-hidden="true" width="18" height="18">
        <path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}
