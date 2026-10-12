import type { JSX } from "react";

/**
 * The detail pages' tab strip — the journey's and the trip's, one strip: text
 * tabs with the accent underline, the same furniture the logbook draws.
 *
 * Extracted from `pages/TripDetailPage.tsx` (which is frozen at its recorded
 * size by the file-size ratchet) when the trip page adopted the tab set
 * (spec 2026-10-12 §2/§3).
 *
 * It stays a strip with no opinion: the keys are the page's own union, the
 * labels come from the page's namespace, and a tab that must not be offered
 * (the Trips tab while the roadtrips domain is switched off) is filtered out
 * of `tabs` by the page — so a tab handed in here is a tab shown.
 */
export default function EntityTabBar<K extends string>({
  tabs,
  tab,
  onChange,
  label,
}: {
  tabs: readonly K[];
  tab: K;
  onChange: (tab: K) => void;
  label: (key: K) => string;
}): JSX.Element {
  return (
    <div
      role="tablist"
      className="flex overflow-x-auto overflow-y-hidden scrollbar-none"
      style={{ borderBottom: "1px solid var(--ts-border)" }}
    >
      {tabs.map((key) => {
        const isActive = tab === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(key)}
            className="flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-3 text-sm"
            style={{
              fontWeight: isActive ? 700 : 500,
              color: isActive ? "var(--ts-text-bright)" : "var(--ts-muted)",
              boxShadow: `inset 0 -2px 0 ${isActive ? "var(--ts-accent)" : "transparent"}`,
            }}
          >
            {label(key)}
          </button>
        );
      })}
    </div>
  );
}
