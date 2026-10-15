# Trip Action Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the flight-trip, journey and road-trip screens (detail and edit), Edit and Save are amber, Delete is red, everything else is the black outline — all 46 px — and every action sits on the right: page actions beside the title, section actions on the section's title line, row actions as icons at the row's end.

**Architecture:** Three small primitives carry the rule (`ActionLink variant`, `ui/SectionHeader`, `ui/MenuButton`) plus an extended `RowActionButton`. Each screen then draws those instead of its own markup. The flight-trip edit page is `TripEditPage` rendered with a `context="flightTrip"` prop at a new route; no form code is copied.

**Tech Stack:** React 19 + TypeScript, react-router 7, Vitest + Testing Library, react-i18next (DE/EN), the `--ts-*` design tokens.

**Spec:** `docs/superpowers/specs/2026-10-15-trip-action-layout-design.md`

## Global Constraints

- Branch `fix/trip-action-layout`. Never commit to `main`; the merge is the owner's release decision.
- Colours: Edit and every Save/Done → amber (`variant="primary"`); Delete / Remove cover → red (`variant="danger"`); everything else → black (`variant="secondary"`). All `size="toolbar"` (46 px); no 52 px primary on these screens.
- Placement order in a header: black, then amber, then red, at the right.
- New code reads `--ts-*` tokens only. A NEW file with any legacy-palette token (`--text-muted`, `--color-border`, `--accent`, `--bg-surface`, `--danger` …), a `.btn-*` class, a raw Tailwind colour or a hex literal fails `npm run check:actions`. In existing files the count may only shrink.
- No source file over 800 lines (`npm run check:size`); `pages/TripDetailPage.tsx` is frozen at 969 and must not grow — do not edit it.
- DE and EN locale files change together (`localeKeyParity.test.ts`).
- `useTranslation` is imported from the project wrapper (`hooks/useTranslation`), never from `react-i18next`.
- Code and comments in English. Comments justify, they do not describe.
- Tests use the identity `t` mock (`t: (k) => k`), so queries match i18n keys.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Gates per task: `cd frontend && npx vitest --run <touched tests>`; at the end the full list in Task 12.

## Review Focus

1. **Keyboard on the recordings menu** — a keyboard user must open it with Enter/Space, move with ↑/↓, pick with Enter, close with Esc and land back on the trigger. Pinned in Task 2.
2. **A disabled source must still say why** — Dawarich unconfigured: the item is visible, not clickable, and its reason is readable without hovering. Pinned in Task 2 and Task 8.
3. **Upload must actually open the file picker** — today the `<input type=file>` sits inside a `<button>`; after the change, choosing "Upload file…" must call the hidden input's `click()`, and picking the same file twice must still upload. Pinned in Task 8.
4. **Leaving the flight-trip edit page goes back to the flight trip** — Cancel, Save and the back link all target `/flights/journeys/:id`; delete lands on `/flights`; a failed load lands on `/flights`, never on the journeys list. Pinned in Task 4.
5. **Row delete icons turn red app-wide** — `RowActionButton` is shared by every logbook list; the red-at-rest change must not break their tests or click-through (handlers still stop propagation). Pinned in Task 1.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `frontend/src/components/ui/ActionLink.tsx` | gains `variant`, `title` | 1 |
| `frontend/src/components/ui/SectionHeader.tsx` (new) | section title left, actions right | 1 |
| `frontend/src/components/table/RowActionButton.tsx` | new icons, `disabled`, red delete | 1 |
| `frontend/src/components/ui/MenuButton.tsx` (new) | black button + ▾ menu | 2 |
| `frontend/src/components/Entity/EntityHeader.tsx`, `pages/FlightTripDetailPage.tsx` | amber Edit | 3 |
| `pages/TripEditPage.tsx`, `pages/FlightTripEditPage.tsx` (new), `App.tsx`, `components/FlightPanel.tsx`, `components/Dashboard/tabs/FlightsTab.tsx` | edit header, flight-trip edit page | 4 |
| `components/Roadtrips/RoadtripEditActions.tsx` (renamed from `RoadtripEditSections.tsx`), `pages/TripRouteEditorPage.tsx`, `components/Roadtrips/RoadtripDatesSection.tsx` | roadtrip edit header, section headers | 5 |
| `components/Trips/TourPointEditor.tsx` | points section | 6 |
| `components/Trips/TourLegList.tsx` | route section | 7 |
| `components/Trips/TourTrackList.tsx` | recordings section | 8 |
| `components/Trips/TimelineActions.tsx`, `TripGallery.tsx`, `ImmichAlbumSection.tsx`, `SummaryCard.tsx`, `TimelineJournalCard.tsx`, `TimelineNoteCard.tsx` | journey detail tabs | 9 |
| `components/Roadtrips/StationTimeline.tsx` | roadtrip detail rows | 10 |
| `pages/ToursPage.tsx` | tours list | 11 |
| `design/DESIGN_SYSTEM.md`, `__tests__/actionCohesion.test.ts`, `__tests__/designDocClaims.test.ts`, `components/ui/DangerSection.tsx` (delete), baseline | rule, guards, cleanup | 12 |

---

### Task 1: Primitives — `ActionLink` variant, `SectionHeader`, `RowActionButton`

**Files:**
- Modify: `frontend/src/components/ui/ActionLink.tsx`
- Create: `frontend/src/components/ui/SectionHeader.tsx`
- Modify: `frontend/src/components/ui/index.ts`
- Modify: `frontend/src/components/table/RowActionButton.tsx`
- Test: `frontend/src/components/ui/__tests__/ActionLink.test.tsx` (new), `frontend/src/components/ui/__tests__/SectionHeader.test.tsx` (new), `frontend/src/components/table/__tests__/RowActionButton.test.tsx` (new or extend if present)

**Interfaces:**
- Produces:
  - `ActionLink({ to, children, variant?: "primary" | "secondary", title?: string })` — default `"secondary"`.
  - `SectionHeader({ title: string; actions?: ReactNode; id?: string })` — default export, re-exported from `ui/index.ts`. Renders `<h2 class="t-label-mono" id={id}>`.
  - `RowActionIcon = "edit" | "duplicate" | "delete" | "checkIn" | "view" | "download" | "moveUp" | "moveDown" | "clear"`; `RowActionButton` gains `disabled?: boolean`. `delete` is `var(--ts-bad)` at rest.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/ui/__tests__/ActionLink.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ActionLink from "../ActionLink";

describe("ActionLink", () => {
  it("is the black outline by default", () => {
    render(
      <MemoryRouter>
        <ActionLink to="/x">Open</ActionLink>
      </MemoryRouter>
    );
    const link = screen.getByRole("link", { name: "Open" });
    expect(link).toHaveAttribute("data-variant", "secondary");
    expect(link.style.background).toBe("transparent");
  });

  it("is amber as primary — Edit is the amber action (owner, 2026-10-15)", () => {
    render(
      <MemoryRouter>
        <ActionLink to="/x/edit" variant="primary" title="why">
          Edit
        </ActionLink>
      </MemoryRouter>
    );
    const link = screen.getByRole("link", { name: "Edit" });
    expect(link).toHaveAttribute("data-variant", "primary");
    expect(link.style.background).toBe("var(--ts-accent)");
    expect(link.style.color).toBe("var(--ts-accent-text)");
    // Same row height as every other control: never the 52px lone CTA.
    expect(link.style.height).toBe("var(--ts-size-button-secondary)");
    expect(link).toHaveAttribute("title", "why");
  });
});
```

`frontend/src/components/ui/__tests__/SectionHeader.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import SectionHeader from "../SectionHeader";

describe("SectionHeader", () => {
  it("puts the title left and the actions on the same line at the right", () => {
    render(<SectionHeader title="Recordings" actions={<button type="button">Add</button>} />);
    const heading = screen.getByRole("heading", { level: 2, name: "Recordings" });
    const row = heading.parentElement as HTMLElement;
    expect(row.className).toContain("justify-between");
    const actions = screen.getByRole("button", { name: "Add" }).parentElement as HTMLElement;
    expect(actions.className).toContain("ml-auto");
  });

  it("draws no empty action slot", () => {
    const { container } = render(<SectionHeader title="Dates" />);
    // The row holds the heading only.
    expect(container.firstElementChild!.children).toHaveLength(1);
  });
});
```

`frontend/src/components/table/__tests__/RowActionButton.test.tsx` (create; if the file exists, append the `describe`):
```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { RowActionButton } from "../RowActionButton";

describe("RowActionButton", () => {
  it("draws delete red at rest, not only on hover — delete is red everywhere", () => {
    render(<RowActionButton icon="delete" label="Delete" onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Delete" }).style.color).toBe("var(--ts-bad)");
  });

  it("keeps every other icon muted at rest", () => {
    render(<RowActionButton icon="download" label="As GPX" onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "As GPX" }).style.color).toBe("var(--ts-muted)");
  });

  it.each(["view", "download", "moveUp", "moveDown", "clear"] as const)(
    "draws the %s icon",
    (icon) => {
      const { container } = render(<RowActionButton icon={icon} label={icon} onClick={vi.fn()} />);
      expect(container.querySelector("svg")?.childElementCount).toBeGreaterThan(0);
    }
  );

  it("does not fire when disabled", () => {
    const onClick = vi.fn();
    render(<RowActionButton icon="moveUp" label="Up" onClick={onClick} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "Up" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("still stops the click reaching the row it sits in", () => {
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <RowActionButton icon="delete" label="Delete" onClick={vi.fn()} />
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(rowClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest --run src/components/ui/__tests__/ActionLink.test.tsx src/components/ui/__tests__/SectionHeader.test.tsx src/components/table/__tests__/RowActionButton.test.tsx`
Expected: FAIL — `SectionHeader` cannot be resolved; `data-variant` is `secondary` for the primary case; delete colour is `var(--ts-muted)`; unknown icons render an empty `<svg>`.

- [ ] **Step 3: Implement**

`frontend/src/components/ui/ActionLink.tsx` — replace the component (keep the file's doc comment, append the paragraph below to it):
```tsx
/*
 * …(existing comment)…
 *
 * `primary` exists because Edit is amber (owner, 2026-10-15: "all the edit
 * buttons should be yellow"). Edit is still a destination, so it stays a link
 * — a middle click opens the edit page in a new tab — and takes the amber skin
 * `Button variant="primary"` draws, at the row's 46, never the lone-CTA 52.
 */
export default function ActionLink({
  to,
  children,
  variant = "secondary",
  title,
}: {
  to: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  /** What the destination does, for a link whose label cannot say it all. */
  title?: string;
}): JSX.Element {
  const skin =
    variant === "primary"
      ? {
          background: "var(--ts-accent)",
          color: "var(--ts-accent-text)",
          border: "1px solid var(--ts-accent)",
        }
      : {
          background: "transparent",
          color: "var(--ts-text)",
          border: "1px solid var(--ts-border-button)",
        };
  return (
    <Link
      to={to}
      title={title}
      className="ts-button inline-flex items-center"
      data-variant={variant}
      style={{
        ...TOOLBAR_CONTROL_STYLE,
        ...skin,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Link>
  );
}
```

`frontend/src/components/ui/SectionHeader.tsx`:
```tsx
import type { JSX, ReactNode } from "react";

/**
 * A section's title line: the label left, that section's own actions at the
 * right edge of the same line.
 *
 * The second of the three placement levels (page · section · row) the owner
 * asked for on 2026-10-15 — "they are randomly placed sometimes next to each
 * other, they should have a beautiful structure". Before it, "Route the whole
 * tour" sat in a row of its own above the legs, the recording sources in a row
 * of their own above the tracks, and "Add point" in the points' Save row: three
 * sections, three places for the same kind of control. The label is the
 * `t-label-mono` every detail section already uses (`DetailSection`), so an
 * edit screen reads like the page it edits.
 *
 * `ml-auto` on the action group, not only `justify-between`: when a long title
 * wraps the actions onto their own line they still end at the right edge.
 */
export default function SectionHeader({
  title,
  actions,
  id,
}: {
  title: string;
  actions?: ReactNode;
  /** For an `aria-labelledby` on the section it heads. */
  id?: string;
}): JSX.Element {
  return (
    <div
      className="flex flex-wrap items-center justify-between"
      style={{ gap: "var(--ts-space-md)", marginBottom: "var(--ts-space-md)" }}
    >
      <h2 id={id} className="t-label-mono">
        {title}
      </h2>
      {actions ? (
        <div
          className="ml-auto flex flex-wrap items-center justify-end"
          style={{ gap: "var(--ts-space-sm)" }}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
```

`frontend/src/components/ui/index.ts` — add after the `FormFooter` line:
```ts
export { default as SectionHeader } from "./SectionHeader";
export { default as ActionLink } from "./ActionLink";
```
(Only add `ActionLink` if `grep -n ActionLink frontend/src/components/ui/index.ts` finds nothing.)

`frontend/src/components/table/RowActionButton.tsx`:
1. Widen the type:
```ts
export type RowActionIcon =
  | "edit"
  | "duplicate"
  | "delete"
  | "checkIn"
  | "view"
  | "download"
  | "moveUp"
  | "moveDown"
  | "clear";
```
2. Add to `PATHS`:
```tsx
  view: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  moveUp: <path d="m6 15 6-6 6 6" />,
  moveDown: <path d="m6 9 6 6 6-6" />,
  clear: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
```
3. Add to `HOVER_CLASS`:
```ts
  view: "hover:bg-(--ts-surface2) hover:text-(--ts-text)",
  download: "hover:bg-(--ts-surface2) hover:text-(--ts-text)",
  moveUp: "hover:bg-(--ts-surface2) hover:text-(--ts-text)",
  moveDown: "hover:bg-(--ts-surface2) hover:text-(--ts-text)",
  clear: "hover:bg-(--ts-surface2) hover:text-(--ts-bad)",
```
4. Props gain `disabled?: boolean;`, the signature destructures it, and the `<button>` gets:
```tsx
      disabled={disabled}
      className={`relative inline-flex h-7 w-7 items-center justify-center rounded-sm disabled:opacity-30 ${TOUCH_HIT_AREA} ${HOVER_CLASS[icon]}`}
      // Delete is red at rest, not only under a hover a finger never makes
      // (owner, 2026-10-15: "delete red"). Every other icon stays muted.
      style={{ color: icon === "delete" ? "var(--ts-bad)" : "var(--ts-muted)" }}
```

- [ ] **Step 4: Run the tests, plus every existing user of `RowActionButton`**

Run: `cd frontend && npx vitest --run src/components/ui/__tests__ src/components/table src/components/__tests__/FlightRowActions.test.tsx src/components/Cruise/CruiseRowActions.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/ActionLink.tsx frontend/src/components/ui/SectionHeader.tsx frontend/src/components/ui/index.ts frontend/src/components/table/RowActionButton.tsx frontend/src/components/ui/__tests__/ActionLink.test.tsx frontend/src/components/ui/__tests__/SectionHeader.test.tsx frontend/src/components/table/__tests__/RowActionButton.test.tsx
git commit -m "feat(design): an amber ActionLink, a section header, and a red row delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `ui/MenuButton`

**Files:**
- Create: `frontend/src/components/ui/MenuButton.tsx`
- Modify: `frontend/src/components/ui/index.ts`
- Test: `frontend/src/components/ui/__tests__/MenuButton.test.tsx`

**Interfaces:**
- Consumes: `TOOLBAR_CONTROL_STYLE` from `ui/Button`.
- Produces:
```ts
export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Shown under a disabled item's label — why it cannot be chosen. */
  reason?: string;
}
export default function MenuButton(props: {
  label: string;
  items: readonly MenuItem[];
  disabled?: boolean;
}): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import MenuButton, { type MenuItem } from "../MenuButton";

const items = (over: Partial<Record<string, Partial<MenuItem>>> = {}): MenuItem[] => [
  { id: "upload", label: "Upload file…", onSelect: vi.fn(), ...over.upload },
  { id: "dawarich", label: "From Dawarich", onSelect: vi.fn(), ...over.dawarich },
  { id: "strava", label: "From Strava", onSelect: vi.fn(), ...over.strava },
];

describe("MenuButton", () => {
  it("is a black toolbar control that announces its menu", () => {
    render(<MenuButton label="Add recording" items={items()} />);
    const trigger = screen.getByRole("button", { name: /Add recording/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("data-variant", "secondary");
    expect(trigger.style.height).toBe("var(--ts-size-button-secondary)");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens, focuses the first item and selects with a click", () => {
    const list = items();
    render(<MenuButton label="Add recording" items={list} />);
    fireEvent.click(screen.getByRole("button", { name: /Add recording/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Upload file…" })).toHaveFocus();
    fireEvent.click(screen.getByRole("menuitem", { name: "From Strava" }));
    expect(list[2].onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("moves with the arrow keys, skips nothing, wraps, and closes on Escape back to the trigger", () => {
    render(<MenuButton label="Add recording" items={items()} />);
    const trigger = screen.getByRole("button", { name: /Add recording/ });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "From Dawarich" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "From Strava" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("shows a disabled item with its reason and does not select it", () => {
    const list = items({ dawarich: { disabled: true, reason: "No Dawarich connection." } });
    render(<MenuButton label="Add recording" items={list} />);
    fireEvent.click(screen.getByRole("button", { name: /Add recording/ }));
    const item = screen.getByRole("menuitem", { name: /From Dawarich/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("No Dawarich connection.")).toBeVisible();
    fireEvent.click(item);
    expect(list[1].onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes on a click outside", () => {
    render(
      <div>
        <MenuButton label="Add recording" items={items()} />
        <p>outside</p>
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: /Add recording/ }));
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does not open while disabled", () => {
    render(<MenuButton label="Uploading…" items={items()} disabled />);
    fireEvent.click(screen.getByRole("button", { name: /Uploading/ }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest --run src/components/ui/__tests__/MenuButton.test.tsx`
Expected: FAIL — cannot resolve `../MenuButton`.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from "react";

import { TOOLBAR_CONTROL_STYLE } from "./Button";

export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Shown under a disabled item's label — why it cannot be chosen. */
  reason?: string;
}

/**
 * One black control that opens a short list of ways to do the same thing.
 *
 * Built for the recordings section (owner, 2026-10-15, choosing between one
 * menu and three buttons: "one menu button"): upload a file, pull from
 * Dawarich and import from Strava are three SOURCES for one action, and three
 * equal buttons beside "Route the whole tour" read as three actions. The
 * trigger is the secondary skin at the row's 46, so it lines up with every
 * other control in a section header.
 *
 * A source that cannot be used stays in the list, disabled, with its reason
 * printed under it — a hidden option is a question ("does this app do
 * Dawarich?") and a tooltip is invisible on a tablet, which is the web build's
 * target device.
 */
export default function MenuButton({
  label,
  items,
  disabled = false,
}: {
  label: string;
  items: readonly MenuItem[];
  disabled?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const last = items.length - 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      itemRefs.current[current >= last ? 0 : current + 1]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      itemRefs.current[current <= 0 ? last : current - 1]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close(true);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-variant="secondary"
        className="ts-button"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...TOOLBAR_CONTROL_STYLE,
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--ts-space-sm)",
          whiteSpace: "nowrap",
          background: "transparent",
          color: "var(--ts-text)",
          border: "1px solid var(--ts-border-button)",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {label}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-40 flex flex-col"
          style={{
            marginTop: "var(--ts-space-xs)",
            minWidth: 240,
            padding: "var(--ts-space-xs)",
            background: "var(--ts-surface2)",
            border: "1px solid var(--ts-border)",
            borderRadius: "var(--ts-radius-card)",
          }}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              aria-disabled={item.disabled || undefined}
              className="flex flex-col items-start text-left hover:bg-(--ts-row-hover)"
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onSelect();
              }}
              style={{
                padding: "var(--ts-space-sm) var(--ts-space-md)",
                borderRadius: "var(--ts-radius-button)",
                background: "transparent",
                border: "none",
                color: item.disabled ? "var(--ts-muted)" : "var(--ts-text)",
                cursor: item.disabled ? "not-allowed" : "pointer",
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              {item.label}
              {item.disabled && item.reason ? (
                <span className="t-caption" style={{ fontWeight: 400 }}>
                  {item.reason}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

Add to `ui/index.ts`: `export { default as MenuButton, type MenuItem } from "./MenuButton";`

- [ ] **Step 4: Run the test and the overlay warden**

Run: `cd frontend && npx vitest --run src/components/ui/__tests__/MenuButton.test.tsx src/__tests__/designWardens.test.ts && cd .. && npm run check:actions`
Expected: PASS (the menu is `absolute`, not `fixed inset-0`, so the overlay rule does not apply).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/MenuButton.tsx frontend/src/components/ui/index.ts frontend/src/components/ui/__tests__/MenuButton.test.tsx
git commit -m "feat(design): a menu button for one action with several sources

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Edit is amber on the three detail heads

**Files:**
- Modify: `frontend/src/components/Entity/EntityHeader.tsx:112` (the `actions` prop)
- Modify: `frontend/src/pages/FlightTripDetailPage.tsx:247-265`
- Test: `frontend/src/components/Entity/__tests__/EntityHeader.test.tsx`, `frontend/src/pages/__tests__/FlightTripDetailPage.test.tsx`, `frontend/src/__tests__/actionCohesion.test.ts`

**Interfaces:**
- Consumes: `ActionLink variant="primary"` (Task 1).
- Produces: the flight-trip head links Edit at `/flights/journeys/${trip.id}/edit` — Task 4 registers that route.

- [ ] **Step 1: Write the failing tests**

In `EntityHeader.test.tsx`, inside the journey test at line 35, after the `href` assertion add:
```tsx
    // Edit is the amber action on every head (owner, 2026-10-15).
    expect(screen.getByRole("link", { name: "common:buttons.edit" })).toHaveAttribute(
      "data-variant",
      "primary"
    );
```
Add the same three lines inside the trip test at line 72.

In `FlightTripDetailPage.test.tsx`, add a test (reuse the file's existing render helper and loaded-trip setup — find it with `grep -n "it(" frontend/src/pages/__tests__/FlightTripDetailPage.test.tsx` and copy the arrangement of the first test that awaits the header):
```tsx
  it("offers Edit in amber, to the flight trip's own edit page", async () => {
    // arrange exactly as the first loaded-trip test in this file does
    const edit = await screen.findByRole("link", { name: "common:buttons.edit" });
    expect(edit).toHaveAttribute("data-variant", "primary");
    expect(edit.getAttribute("href")).toMatch(/^\/flights\/journeys\/[^/]+\/edit$/);
    // Open trip stays the black outline beside it.
    expect(screen.getByRole("link", { name: "flights:detail.openTrip" })).toHaveAttribute(
      "data-variant",
      "secondary"
    );
  });
```

In `actionCohesion.test.ts`, replace the whole `describe("edit navigation is always the outline link", …)` block and the whole `describe("a journey is edited on a page, not in a popup", …)` block with:
```ts
describe("Edit is the amber link on every detail head", () => {
  /**
   * Owner, 2026-10-15 (third round): "all the edit buttons should be yellow …
   * edit, save buttons should be yellow, delete red and others black". The
   * previous round made Edit the black outline on the rule "amber belongs to
   * the one control that commits"; the owner reversed it. Edit stays a LINK —
   * a destination, so a middle click opens it in a new tab — in the amber skin.
   */
  const HEADS = ["pages/FlightTripDetailPage.tsx", "components/Entity/EntityHeader.tsx"] as const;

  it.each(HEADS)("%s draws Edit as ActionLink variant=primary", (path) => {
    expect(read(path)).toMatch(
      /<ActionLink[^>]*variant="primary"[^>]*>\s*\{t\("common:buttons.edit"\)\}/
    );
  });
});

describe("a flight trip is edited on its own page", () => {
  it("the flight-trip page opens no popup", () => {
    expect(read("pages/FlightTripDetailPage.tsx")).not.toMatch(/import\s+TripModal\s+from/);
  });

  it("the flight-trip head links to the flight trip's edit page, not the journey's", () => {
    // Owner, 2026-10-15: "what i wanted was that flight edit popup to be
    // converted into edit page" — the previous round sent it to
    // `/trips/:id/edit`, which says "Edit Journey" and returns to the journey.
    const src = read("pages/FlightTripDetailPage.tsx");
    expect(src).toContain("to={`/flights/journeys/${trip.id}/edit`}");
    expect(src).not.toContain("to={`/trips/${trip.id}/edit`}");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest --run src/components/Entity src/pages/__tests__/FlightTripDetailPage.test.tsx src/__tests__/actionCohesion.test.ts`
Expected: FAIL on `data-variant` (`secondary`) and on the href.

- [ ] **Step 3: Implement**

`EntityHeader.tsx:112`:
```tsx
      actions={
        <ActionLink to={config.editPath(id)} variant="primary">
          {t("common:buttons.edit")}
        </ActionLink>
      }
```
Update the component's doc comment line "exactly ONE action, Edit" to add: "— amber, the colour every Edit and Save wears (owner, 2026-10-15)".

`FlightTripDetailPage.tsx` — replace the second `ActionLink` and its whole comment block (lines 250-263) with:
```tsx
            {/* Amber, and to the flight trip's OWN edit page (owner,
                2026-10-15: "all the edit buttons should be yellow … what i
                wanted was that flight edit popup to be converted into edit
                page"). The page is `TripEditPage` in its flight-trip context,
                so it edits the same journey through the same `useTripForm`
                and returns here, not to the journey. */}
            <ActionLink to={`/flights/journeys/${trip.id}/edit`} variant="primary">
              {t("common:buttons.edit")}
            </ActionLink>
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest --run src/components/Entity src/pages/__tests__/FlightTripDetailPage.test.tsx src/__tests__/actionCohesion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Entity frontend/src/pages/FlightTripDetailPage.tsx frontend/src/pages/__tests__/FlightTripDetailPage.test.tsx frontend/src/__tests__/actionCohesion.test.ts
git commit -m "fix(design): Edit is amber on the flight-trip, journey and road-trip heads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The edit page header, and the flight trip's own edit page

**Files:**
- Modify: `frontend/src/pages/TripEditPage.tsx`
- Create: `frontend/src/pages/FlightTripEditPage.tsx`
- Modify: `frontend/src/App.tsx` (lazy import near line 62; route after the `/flights/journeys/:tripId` route, ~line 307)
- Modify: `frontend/src/components/FlightPanel.tsx` (lines 14, 23-47, 126-128, 421-430)
- Modify: `frontend/src/components/Dashboard/tabs/FlightsTab.tsx:298`
- Modify: `frontend/src/__tests__/components/FlightPanel.test.tsx` (5 renders)
- Modify: `frontend/src/i18n/resources/{de,en}/trips.json` (key `editFlightTrip` next to `editTrip`, line 15)
- Modify: `frontend/src/i18n/resources/{de,en}/tripBuilder.json` (remove `edit.deleteHeading`, `edit.deleteJourneyHint`, `edit.resyncHint` only after Step 3's grep shows no other user — `edit.deleteTripHint`/`edit.resyncTripHint` go in Task 5)
- Test: `frontend/src/pages/__tests__/TripEditPage.test.tsx`, `frontend/src/pages/__tests__/FlightTripEditPage.test.tsx` (new), `frontend/src/__tests__/actionCohesion.test.ts`

**Interfaces:**
- Consumes: `ActionLink` (`title`), `PageHeader` (`ui/PageHeader`), `BackLink`.
- Produces:
  - `export type TripEditContext = "journey" | "flightTrip";` and `export default function TripEditPage({ context = "journey" }: { context?: TripEditContext })` in `pages/TripEditPage.tsx`.
  - `ResyncFromImmich({ tripId, routeId?, title? })` — `title` passed through to `ActionLink`.
  - `FlightPanel` prop `onEditTrip: (tripId: string) => void` (required).
  - Route `/flights/journeys/:id/edit`.

- [ ] **Step 1: Write the failing tests**

In `TripEditPage.test.tsx`:
1. Replace the test at line ~388 (the one asserting the Re-sync **heading**) with:
```tsx
  it("offers Re-sync and Delete in the header, right of the title — not below the form", async () => {
    renderPage();
    const title = await screen.findByRole("heading", { level: 1, name: "trips:editTrip" });
    const header = title.closest("div")!.parentElement as HTMLElement;
    const resync = within(header).getByRole("link", { name: "tripBuilder:resync.action" });
    expect(resync).toHaveAttribute("href", "/trips/t1/resync");
    expect(resync).toHaveAttribute("data-variant", "secondary");
    const del = within(header).getByRole("button", { name: "common:buttons.delete" });
    expect(del).toHaveAttribute("data-variant", "danger");
    // Black before red, both after the title.
    expect(resync.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "tripBuilder:resync.action" })).toBeNull();
  });
```
(`renderPage` is the file's existing render helper; if it is named differently, use that name — `grep -n "function render" frontend/src/pages/__tests__/TripEditPage.test.tsx`.)
2. Add a cover-row test:
```tsx
  it("draws the cover's two buttons at the right, Remove red", async () => {
    mocks.getById.mockResolvedValueOnce({ ...trip, coverImageUrl: "/c.jpg" });
    renderPage();
    const remove = await screen.findByRole("button", { name: "trips:modal.coverRemove" });
    expect(remove).toHaveAttribute("data-variant", "danger");
    expect((remove.parentElement as HTMLElement).className).toContain("justify-end");
  });
```
(Check the cover field name with `grep -n "cover" frontend/src/components/Trips/useTripForm.ts | head` and use it in place of `coverImageUrl` if it differs.)

Create `frontend/src/pages/__tests__/FlightTripEditPage.test.tsx` — copy the `mocks`, every `vi.mock(...)` and the `trip` fixture from the top of `TripEditPage.test.tsx` verbatim, then:
```tsx
import FlightTripEditPage from "../FlightTripEditPage";

function Where(): JSX.Element {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

function renderAt(path = "/flights/journeys/t1/edit"): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/flights/journeys/:id/edit" element={<FlightTripEditPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("FlightTripEditPage", () => {
  beforeEach(() => {
    mocks.getById.mockResolvedValue(trip);
    mocks.update.mockResolvedValue(trip);
  });
  afterEach(() => vi.clearAllMocks());

  it("is titled as the flight trip and goes back to it", async () => {
    renderAt();
    expect(
      await screen.findByRole("heading", { level: 1, name: "trips:editFlightTrip" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /common:buttons.back/ })).toHaveAttribute(
      "href",
      "/flights/journeys/t1"
    );
  });

  it("returns to the flight trip after Save", async () => {
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: "trips:modal.save" }));
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(/^\/flights\/journeys\/t1$/)
    );
  });

  it("returns to the flight trip on Cancel", async () => {
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: "trips:modal.cancel" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/flights\/journeys\/t1$/);
  });

  it("lands on the flights logbook after a confirmed delete", async () => {
    mocks.remove.mockResolvedValue(undefined);
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: "common:buttons.delete" }));
    fireEvent.click(await screen.findByText("trips:deleteTrip"));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/flights$/));
  });

  it("lands on the flights logbook when the trip cannot be loaded", async () => {
    mocks.getById.mockRejectedValueOnce(new Error("nope"));
    renderAt();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/flights$/));
  });
});
```
Import `useLocation`, `MemoryRouter`, `Routes`, `Route` from `react-router-dom` and `fireEvent`, `render`, `screen`, `waitFor` from Testing Library as the copied header does.

In `actionCohesion.test.ts`, replace the `describe("destructive actions wear one treatment", …)` block with:
```ts
describe("an edit page carries Re-sync and Delete in its header", () => {
  /**
   * Owner, 2026-10-15: "the resync from immich button should be next to the
   * title but all the way right of screen rather than below it. same goes for
   * delete too." The previous round put both in sections under the form's
   * Save row, left-aligned (`DangerSection`).
   */
  it("TripEditPage hands both to PageHeader's action slot", () => {
    const src = read("pages/TripEditPage.tsx");
    expect(src).toMatch(/<PageHeader[\s\S]*actions=\{[\s\S]*<ResyncFromImmich[\s\S]*variant="danger"/);
    expect(src).not.toContain("DangerSection");
  });

  it("FlightPanel edits a trip on its page, not in TripModal", () => {
    expect(read("components/FlightPanel.tsx")).not.toMatch(/import\s+TripModal\s+from/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest --run src/pages/__tests__/TripEditPage.test.tsx src/pages/__tests__/FlightTripEditPage.test.tsx src/__tests__/actionCohesion.test.ts`
Expected: FAIL — `FlightTripEditPage` does not exist; Re-sync is still a section heading; FlightPanel imports TripModal.

- [ ] **Step 3: Implement**

3a. Locale keys. `trips.json` next to `"editTrip"`:
- de: `"editFlightTrip": "Flugreise bearbeiten",`
- en: `"editFlightTrip": "Edit flight trip",`

Then run `grep -rn "edit\.deleteHeading\|edit\.deleteJourneyHint\|edit\.resyncHint" frontend/src --include=*.ts --include=*.tsx`. After 3c the only remaining hits may be `RoadtripEditSections.tsx` (`deleteHeading`, handled in Task 5) and `TripRouteEditorPage.editSections.test.tsx:210` (`deleteHeading`, Task 5). Remove `edit.deleteJourneyHint` from both `tripBuilder.json` files now. Keep `edit.resyncHint` — it becomes the Re-sync link's `title` (3c). Keep `edit.deleteHeading` until Task 5.

3b. `ResyncFromImmich.tsx`: add `title?: string` to the props and pass it on:
```tsx
  return (
    <ActionLink to={to} title={title}>
      {t("tripBuilder:resync.action")}
    </ActionLink>
  );
```
Update its doc comment: replace "the trip page's row (Edit · Re-sync · Delete) and the roadtrip band's journey cell" with "the edit pages' header row (Re-sync · Delete)".

3c. `TripEditPage.tsx`:
- Imports: remove `DangerSection`; add `import PageHeader from "../components/ui/PageHeader";`.
- Above the component:
```tsx
export type TripEditContext = "journey" | "flightTrip";

/**
 * Where the page was opened from decides its title and where every exit
 * lands; nothing else differs. A flight trip IS a journey — `/flights/journeys/:id`
 * is the flight-centred view of the same row — but the owner reads it as its
 * own thing and asked for its popup to become "an edit page", not to be sent
 * to the journey's (2026-10-15). So the same form, the same `useTripForm`,
 * with the flight trip's name and its own way home.
 */
const CONTEXTS: Record<
  TripEditContext,
  { titleKey: string; home: (id: string) => string; list: string }
> = {
  journey: { titleKey: "trips:editTrip", home: (id) => `/trips/${id}`, list: "/trips" },
  flightTrip: {
    titleKey: "trips:editFlightTrip",
    home: (id) => `/flights/journeys/${id}`,
    list: "/flights",
  },
};
```
- Signature: `export default function TripEditPage({ context = "journey" }: { context?: TripEditContext } = {}): JSX.Element {` and right after `useNavigate()` add `const where = CONTEXTS[context];`.
- Replace every `navigate("/trips")` (load failure, delete success) with `navigate(where.list)`; `navigate(\`/trips/${savedTrip.id}\`)` with `navigate(where.home(savedTrip.id))`; Cancel's `navigate(\`/trips/${trip.id}\`)` with `navigate(where.home(trip.id))`.
- Replace the `<header>…</header>` block with:
```tsx
        <div>
          <BackLink to={where.home(trip.id)}>{t("common:buttons.back")}</BackLink>
          {/* The page's own actions on the title's line, at the right edge
              (owner, 2026-10-15: "the resync from immich button should be
              next to the title but all the way right of screen rather than
              below it. same goes for delete too"). Black before red. What a
              delete takes and what survives is said by the confirm dialog it
              opens (`TripDeleteConfirm`), where the decision is made. */}
          <PageHeader
            title={t(where.titleKey)}
            actions={
              <>
                <ResyncFromImmich tripId={trip.id} title={t("tripBuilder:edit.resyncHint")} />
                <Button variant="danger" size="toolbar" onClick={() => setConfirmDelete(true)}>
                  {t("common:buttons.delete")}
                </Button>
              </>
            }
          />
        </div>
```
- Delete the `<section>` holding the Re-sync heading and the whole `<DangerSection … />` with its comment (the blocks after `</FormFooter>`).
- Cover row: change `<div className="flex gap-2 mt-2">` to `<div className="mt-2 flex flex-wrap justify-end gap-2">`, give both cover buttons `size="toolbar"`, and replace the comment above them with:
```tsx
              {/* Ends right like every action row. Black for the upload, red
                  for the remove — remove is a delete (owner, 2026-10-15:
                  "delete red and others black"). */}
```
- In the `CoverPreview` comment-free code nothing changes. Update the file's top doc comment: replace "plus the two sections the headers lose — **Re-sync from Immich** … and **Delete** …" with "plus **Re-sync from Immich** and **Delete** in its header, and — in the `flightTrip` context — the flight trip's own title and exits (see `CONTEXTS`)".

3d. `frontend/src/pages/FlightTripEditPage.tsx`:
```tsx
import type { JSX } from "react";

import TripEditPage from "./TripEditPage";

/**
 * `/flights/journeys/:id/edit` — the flight trip's edit page (owner,
 * 2026-10-15), which used to be `TripModal` over the flight-trip page. One
 * line on purpose: the form is the journey's form, so the two pages can never
 * disagree about a field; `TripEditPage`'s context gives it the flight trip's
 * title and sends every exit back to the flight trip.
 */
export default function FlightTripEditPage(): JSX.Element {
  return <TripEditPage context="flightTrip" />;
}
```

3e. `App.tsx`: next to `const TripEditPage = lazy(...)` add
`const FlightTripEditPage = lazy(() => import("./pages/FlightTripEditPage"));`
and directly after the `/flights/journeys/:tripId` `<Route … />`:
```tsx
              {/* The flight trip's own edit page (owner, 2026-10-15) — the
                  popup it replaces sat on the page above. Same guard. */}
              <Route
                path="/flights/journeys/:id/edit"
                element={
                  isAuthenticated ? (
                    <DomainRouteGuard domain="flight">
                      <FlightTripEditPage />
                    </DomainRouteGuard>
                  ) : (
                    <Navigate to="/login" />
                  )
                }
              />
```

3f. `FlightPanel.tsx`:
- Remove `import TripModal from "./Trips/TripModal";`.
- Add to `FlightPanelProps`:
```ts
  /** Opens the trip's edit page — a page, not a popup (owner, 2026-10-15). */
  onEditTrip: (tripId: string) => void;
```
  and destructure `onEditTrip` in the signature.
- `handleEditDetailTrip`: `if (detailTrip) onEditTrip(detailTrip.id);`
- Delete the `editingTrip` state declaration (find with `grep -n "editingTrip" frontend/src/components/FlightPanel.tsx`) and the `{editingTrip !== null && (<TripModal … />)}` block. If `reloadTrips` is now only referenced by the effect, leave it.

`FlightsTab.tsx:298` — add the prop to `<FlightPanel …>`:
```tsx
        onEditTrip={(tripId) => navigate(`/flights/journeys/${tripId}/edit`)}
```

`__tests__/components/FlightPanel.test.tsx` — add `onEditTrip={vi.fn()}` beside `onEdit={vi.fn()}` in each of the five renders.

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest --run src/pages/__tests__/TripEditPage.test.tsx src/pages/__tests__/TripEditPage.route.test.tsx src/pages/__tests__/FlightTripEditPage.test.tsx src/__tests__/components/FlightPanel.test.tsx src/components/Dashboard/tabs src/__tests__/actionCohesion.test.ts src/i18n && npx tsc --noEmit`
Expected: PASS. If a pre-existing `TripEditPage.test.tsx` test asserted the Re-sync **heading** or the `DangerSection` heading, it was replaced in Step 1; any other failure is a real regression.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/TripEditPage.tsx frontend/src/pages/FlightTripEditPage.tsx frontend/src/App.tsx frontend/src/components/FlightPanel.tsx frontend/src/components/Dashboard/tabs/FlightsTab.tsx frontend/src/components/Trips/tripBuilder/ResyncFromImmich.tsx frontend/src/i18n/resources frontend/src/pages/__tests__ frontend/src/__tests__
git commit -m "fix(design): a flight trip edits on its own page, and Re-sync and Delete sit beside the title

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The road-trip / tour editor's header and section headers

**Files:**
- Rename: `frontend/src/components/Roadtrips/RoadtripEditSections.tsx` → `RoadtripEditActions.tsx` (`git mv`)
- Modify: `frontend/src/pages/TripRouteEditorPage.tsx` (imports line 24; header block ~510-560; sections ~589-664)
- Modify: `frontend/src/components/Roadtrips/RoadtripDatesSection.tsx` (the `<h2>` at ~line 105)
- Modify: `frontend/src/i18n/resources/{de,en}/tripBuilder.json` (remove `edit.deleteHeading`, `edit.deleteTripHint`)
- Test: `frontend/src/pages/__tests__/TripRouteEditorPage.editSections.test.tsx`, `frontend/src/__tests__/actionCohesion.test.ts`

**Interfaces:**
- Consumes: `PageHeader`, `SectionHeader` (Task 1), `ResyncFromImmich({ title })` (Task 4).
- Produces: `RoadtripEditActions({ route, journeyId })` — returns the header actions (Re-sync link when `journeyId !== null`, red Delete) plus the two confirm dialogs, or `null` for a day tour.
- Produces for Tasks 6-8: `TourPointEditor`, `TourLegList`, `TourTrackList` each receive `title: string` and draw their own `SectionHeader`; the page stops drawing their `<h2>`. (Tasks 6-8 add the prop; this task leaves the three `<section>` wrappers in place with the `<h2>` still inside, so the tree stays green between tasks.)

- [ ] **Step 1: Write the failing tests**

In `TripRouteEditorPage.editSections.test.tsx`:
1. In the test at line 139 add, after the link is found:
```tsx
    // In the page header beside the title, not a section under the form.
    expect(screen.queryByRole("heading", { name: "tripBuilder:resync.action" })).toBeNull();
    const title = screen.getByRole("heading", { level: 1 });
    const header = title.closest("div")!.parentElement as HTMLElement;
    expect(within(header).getByRole("link", { name: "tripBuilder:resync.action" })).toBe(link);
    expect(within(header).getByRole("button", { name: "roadtrips:delete" })).toHaveAttribute(
      "data-variant",
      "danger"
    );
```
2. In the day-tour test at line 200 replace `screen.queryByText("tripBuilder:edit.deleteHeading")` with `screen.queryByRole("button", { name: "roadtrips:delete" })`.
3. In the delete test at line 217 replace `screen.findByText("roadtrips:delete")` with `screen.findByRole("button", { name: "roadtrips:delete" })`.
Add `within` to the Testing Library import if missing.

In `actionCohesion.test.ts`, inside the `describe("an edit page carries Re-sync and Delete in its header", …)` block from Task 4, add:
```ts
  it("the road-trip editor hands both to PageHeader's action slot", () => {
    const page = read("pages/TripRouteEditorPage.tsx");
    expect(page).toMatch(/<PageHeader[\s\S]*actions=\{\s*<RoadtripEditActions/);
    const actions = read("components/Roadtrips/RoadtripEditActions.tsx");
    expect(actions).toContain('variant="danger"');
    expect(actions).not.toContain("DangerSection");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest --run src/pages/__tests__/TripRouteEditorPage.editSections.test.tsx src/__tests__/actionCohesion.test.ts`
Expected: FAIL — the link sits in a section; `RoadtripEditActions.tsx` does not exist.

- [ ] **Step 3: Implement**

3a. `git mv frontend/src/components/Roadtrips/RoadtripEditSections.tsx frontend/src/components/Roadtrips/RoadtripEditActions.tsx`, then in it:
- Remove the `DangerSection` import; add `import Button from "../ui/Button";`.
- Rename the function to `RoadtripEditActions`.
- Replace the doc comment's first paragraph with: "The trip edit page's header actions (owner, 2026-10-15: Re-sync and Delete \"next to the title but all the way right of screen\"): **Re-sync from Immich** for a trip filed on a journey (§K.1) and **Delete trip** — the roadtrip delete flow, semantics unchanged: …" (keep the rest of the sentence about legs, released stops and costs, and the 800-line paragraph).
- Replace the returned JSX's two blocks (the Re-sync `<section>` and the `<DangerSection …/>` with its comment) with:
```tsx
      {journeyId !== null && (
        // The trip's OWN re-sync: it scans and updates this trip, not the
        // journey (owner request 2026-10-12).
        <ResyncFromImmich
          tripId={journeyId}
          routeId={route.id}
          title={t("tripBuilder:edit.resyncTripHint")}
        />
      )}
      <Button variant="danger" size="toolbar" onClick={() => setConfirmDelete(true)}>
        {t("roadtrips:delete")}
      </Button>
```
(The two `ConfirmModal`s stay; they portal out of the header.)

3b. Remove `edit.deleteHeading` and `edit.deleteTripHint` from both `tripBuilder.json` files after `grep -rn "edit\.deleteHeading\|edit\.deleteTripHint" frontend/src` shows no remaining user.

3c. `TripRouteEditorPage.tsx`:
- Import: replace the `RoadtripEditSections` import with `import RoadtripEditActions from "../components/Roadtrips/RoadtripEditActions";` and add `import PageHeader from "../components/ui/PageHeader";`.
- Replace `<header> … </header>` (the BackLink, the `<h1>` and the meta `<p>`) with:
```tsx
        <div>
          <BackLink
            to={
              route.kind === "roadtrip"
                ? `/roadtrips/${route.id}`
                : id
                  ? `/trips/${id}?tab=tours`
                  : "/tours"
            }
          >
            {route.kind === "roadtrip"
              ? t("roadtrips:backToRoadtrip")
              : t(id ? "trips:tours.backToTrip" : "trips:tours.backToTours")}
          </BackLink>
          {/* The trip's page actions on the title's line, at the right
              (owner, 2026-10-15). A day tour has none — RoadtripEditActions
              returns null for it. */}
          <PageHeader
            title={route.name}
            meta={
              <span className="flex flex-wrap items-center gap-2">
                {/* …move the existing children of the old meta <p> here,
                    unchanged: the activity <select>, <TourDayEditor>, and the
                    mode · km <span>… */}
              </span>
            }
            actions={<RoadtripEditActions route={route} journeyId={journeyId} />}
          />
        </div>
```
  Move the three children of the old `<p className="flex flex-wrap items-center gap-2 text-sm text-(--text-muted)">` verbatim into that `<span>` (replace the placeholder comment with them).
- Delete the final `{/* The trip's edit page carries … */}` comment and `<RoadtripEditSections … />` at the bottom.

  `PageHeader` renders `actions` only when truthy; a day tour passes an element whose render is `null`, which leaves an empty flex box. Guard it: `actions={route.kind === "roadtrip" ? <RoadtripEditActions route={route} journeyId={journeyId} /> : undefined}`.

3d. `RoadtripDatesSection.tsx`: replace `<h2 className="text-lg font-semibold mb-3">{t("roadtrips:dates.heading")}</h2>` with `<SectionHeader title={t("roadtrips:dates.heading")} />` and import `SectionHeader from "../ui/SectionHeader"`. The Save button keeps `ml-auto` (it ends the inputs row) and stays amber.

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest --run src/pages/__tests__/TripRouteEditorPage src/components/Roadtrips src/__tests__/actionCohesion.test.ts src/i18n && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/components/Roadtrips frontend/src/pages/TripRouteEditorPage.tsx frontend/src/pages/__tests__ frontend/src/i18n/resources frontend/src/__tests__/actionCohesion.test.ts
git commit -m "fix(design): the trip editor's Re-sync and Delete move beside its title

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Points — "Add point" in the section header, row icons

**Files:**
- Modify: `frontend/src/components/Trips/TourPointEditor.tsx`
- Modify: `frontend/src/pages/TripRouteEditorPage.tsx` (the points `<section>`)
- Test: `frontend/src/components/Trips/__tests__/TourPointEditor.test.tsx`

**Interfaces:**
- Consumes: `SectionHeader`, `RowActionButton` (`moveUp`, `moveDown`, `delete`, `disabled`).
- Produces: `TourPointEditor` gains required prop `title: string`.

- [ ] **Step 1: Write the failing test**

Add to `TourPointEditor.test.tsx` (use the file's existing render helper; pass `title="trips:tours.points.heading"` in it):
```tsx
  it("puts Add point on the section's title line and keeps Save at the foot", () => {
    renderEditor();
    const heading = screen.getByRole("heading", { name: "trips:tours.points.heading" });
    const add = screen.getByRole("button", { name: "trips:tours.points.add" });
    expect(heading.parentElement!.contains(add)).toBe(true);
    const save = screen.getByRole("button", { name: "trips:tours.points.save" });
    expect(save).toHaveAttribute("data-variant", "primary");
    expect(heading.parentElement!.contains(save)).toBe(false);
  });

  it("draws a point's move and remove as row icons, remove in red", () => {
    renderEditor();
    const remove = screen.getAllByRole("button", { name: "trips:tours.points.remove" })[0];
    expect(remove.style.color).toBe("var(--ts-bad)");
    expect(remove.className).not.toContain("underline");
    expect(screen.getAllByRole("button", { name: "trips:tours.points.moveUp" })[0]).toBeDisabled();
  });
```
Update any existing `getByText("trips:tours.points.remove")` in this file to `getAllByRole("button", { name: "trips:tours.points.remove" })[i]` (the label is now `aria-label`, not text).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Trips/__tests__/TourPointEditor.test.tsx`
Expected: FAIL — no heading; remove is an underlined text button.

- [ ] **Step 3: Implement**

`TourPointEditor.tsx`:
- Imports: add `import SectionHeader from "../ui/SectionHeader";` and `import { RowActionButton, RowActions } from "../table/RowActionButton";`.
- Props: add `/** The section's title — this editor draws its own header so "Add point" can sit on it. */ title: string;` and destructure it.
- Wrap the return in `<div className="space-y-2">` → first child:
```tsx
      <SectionHeader
        title={title}
        actions={
          <Button
            variant="secondary"
            size="toolbar"
            onClick={() => setDraft((prev) => [...prev, { title: "", lat: NaN, lon: NaN }])}
          >
            {t("trips:tours.points.add")}
          </Button>
        }
      />
```
- In each `<li>`, replace the two arrow `<button>`s and the remove `<button>` (and its comment) with:
```tsx
            <RowActions>
              <RowActionButton
                icon="moveUp"
                label={t("trips:tours.points.moveUp")}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              />
              <RowActionButton
                icon="moveDown"
                label={t("trips:tours.points.moveDown")}
                disabled={index === draft.length - 1}
                onClick={() => move(index, 1)}
              />
              <RowActionButton
                icon="delete"
                label={t("trips:tours.points.remove")}
                onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
              />
            </RowActions>
```
- In the `FormFooter`, delete the "Add point" `<Button>`; Save stays. Replace the long comment above the footer's second paragraph ("Right-aligned like every other footer …") with: "Save alone at the foot: Add point moved to the section's title line (owner, 2026-10-15, 'create new best placement'), so this row holds only the commit."

`TripRouteEditorPage.tsx` points section: when `ownPoints`, drop the `<h2>` and pass `title={t("trips:tours.points.heading")}` to `TourPointEditor`; when not, render `<SectionHeader title={t("trips:tours.stopsHeading")} />` above `TourStopAssigner`. Import `SectionHeader`.

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest --run src/components/Trips/__tests__/TourPointEditor.test.tsx src/pages/__tests__/TripRouteEditorPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Trips/TourPointEditor.tsx frontend/src/components/Trips/__tests__/TourPointEditor.test.tsx frontend/src/pages/TripRouteEditorPage.tsx
git commit -m "fix(design): Add point heads the points, and a point's actions are row icons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Route — "Route the whole tour" in the section header

**Files:**
- Modify: `frontend/src/components/Trips/TourLegList.tsx`
- Modify: `frontend/src/pages/TripRouteEditorPage.tsx` (the legs `<section>`)
- Test: `frontend/src/components/Trips/__tests__/TourLegList.test.tsx`

**Interfaces:**
- Consumes: `SectionHeader`, `Button`, `RowActionButton` (`clear`).
- Produces: `TourLegList` gains required prop `title: string`.

- [ ] **Step 1: Write the failing test**

Pass `title="trips:tours.legsHeading"` in the file's render helper, then add:
```tsx
  it("puts Route the whole tour on the section's title line, as the shared button", () => {
    renderList(/* the args the existing routeAll test at line ~276 uses */);
    const heading = screen.getByRole("heading", { name: "trips:tours.legsHeading" });
    const btn = screen.getByRole("button", { name: "trips:tours.routing.routeAll" });
    expect(heading.parentElement!.contains(btn)).toBe(true);
    expect(btn).toHaveAttribute("data-variant", "secondary");
    expect(btn.style.height).toBe("var(--ts-size-button-secondary)");
  });

  it("still draws the heading when there are no legs yet", () => {
    renderList({ legs: [] });
    expect(screen.getByRole("heading", { name: "trips:tours.legsHeading" })).toBeInTheDocument();
  });
```
The `clearLeg` tests at lines 235/259 query by role+name, which `RowActionButton`'s `aria-label` satisfies — keep them.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Trips/__tests__/TourLegList.test.tsx`
Expected: FAIL — no heading inside the component.

- [ ] **Step 3: Implement**

`TourLegList.tsx`:
- Imports: `Button from "../ui/Button"`, `SectionHeader from "../ui/SectionHeader"`, `{ RowActionButton } from "../table/RowActionButton"`.
- Props: add `title: string` and destructure it.
- Build the header once, above the early return:
```tsx
  const header = (
    <SectionHeader
      title={title}
      actions={
        legs.length > 0 ? (
          <Button
            variant="secondary"
            size="toolbar"
            disabled={routingAllInProgress || !routingAvailable}
            title={routingAvailable ? undefined : t("trips:tours.routing.unavailableReason")}
            onClick={onRouteAll}
          >
            {routingAllInProgress
              ? t("trips:tours.routing.routingAll")
              : t("trips:tours.routing.routeAll")}
          </Button>
        ) : undefined
      }
    />
  );
```
- Empty branch: `return (<div>{header}<p className="text-sm text-(--text-muted)">{t("trips:tours.noLegs")}</p></div>);`
- Main branch: replace the `<div className="flex justify-end"> … </div>` toolbar with `{header}`.
- Replace the row's "clear" `<button>` with:
```tsx
              <RowActionButton
                icon="clear"
                label={t("trips:tours.clearLeg")}
                disabled={leg.source === "straight"}
                onClick={() => onClear(leg)}
              />
```

`TripRouteEditorPage.tsx`: in the legs `<section>`, drop the `<h2>` and pass `title={t("trips:tours.legsHeading")}`.

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest --run src/components/Trips/__tests__/TourLegList.test.tsx src/pages/__tests__/TripRouteEditorPage src/hooks/__tests__/useTourLegActions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Trips/TourLegList.tsx frontend/src/components/Trips/__tests__/TourLegList.test.tsx frontend/src/pages/TripRouteEditorPage.tsx
git commit -m "fix(design): Route the whole tour heads the route, as the shared button

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Recordings — one "Add recording" menu, row icons

**Files:**
- Modify: `frontend/src/components/Trips/TourTrackList.tsx`
- Modify: `frontend/src/pages/TripRouteEditorPage.tsx` (the tracks `<section>`)
- Modify: `frontend/src/i18n/resources/{de,en}/trips.json` (`tours.tracks.addRecording`, `tours.tracks.uploadFile`)
- Test: `frontend/src/components/Trips/__tests__/TourTrackList.test.tsx`

**Interfaces:**
- Consumes: `MenuButton`, `MenuItem` (Task 2), `SectionHeader`, `RowActionButton` (`download`, `delete`).
- Produces: `TourTrackList` gains required prop `title: string`.

- [ ] **Step 1: Write the failing tests**

Locale keys first (they are data, not behaviour) — inside `tours.tracks` in `trips.json`:
- de: `"addRecording": "Aufzeichnung hinzufügen",` `"uploadFile": "Datei hochladen (GPX, TCX, FIT) …",`
- en: `"addRecording": "Add recording",` `"uploadFile": "Upload file (GPX, TCX, FIT) …",`

In `TourTrackList.test.tsx`, pass `title="trips:tours.tracks.heading"` in `renderList`, add an `openMenu` helper and rewrite the source tests:
```tsx
const openMenu = (): void => {
  fireEvent.click(screen.getByRole("button", { name: /trips:tours.tracks.addRecording/ }));
};

  it("offers every source through one Add recording menu on the section's title line", () => {
    renderList({ dawarichAvailable: true, onImportStrava: vi.fn() });
    const heading = screen.getByRole("heading", { name: "trips:tours.tracks.heading" });
    const trigger = screen.getByRole("button", { name: /trips:tours.tracks.addRecording/ });
    expect(heading.parentElement!.contains(trigger)).toBe(true);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "trips:tours.tracks.uploadFile" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "trips:tours.tracks.dawarich.pullLabel" })
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "roadtrips:strava.importButton" })).toBeInTheDocument();
  });

  it("opens the file picker from the Upload item, and the same file can be picked twice", () => {
    const onUpload = vi.fn();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
    const { container } = renderList({ onUpload });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "trips:tours.tracks.uploadFile" }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // The input is not inside a <button> any more — that is what made it unreliable.
    expect(input.closest("button")).toBeNull();
    const file = new File(["<gpx/>"], "a.gpx", { type: "application/gpx+xml" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onUpload).toHaveBeenCalledTimes(2);
    clickSpy.mockRestore();
  });

  it("disables the menu and says so while an upload runs", () => {
    renderList({ uploading: true });
    expect(screen.getByRole("button", { name: /trips:tours.tracks.uploading/ })).toBeDisabled();
  });

  it("disables the menu and says so while a pull runs", () => {
    renderList({ dawarichAvailable: true, pulling: true });
    expect(screen.getByRole("button", { name: /trips:tours.tracks.dawarich.pulling/ })).toBeDisabled();
  });

  it("keeps Dawarich in the menu, disabled, with its reason, when no connection is configured", () => {
    const onPullDawarich = vi.fn();
    renderList({ dawarichAvailable: false, onPullDawarich });
    openMenu();
    const item = screen.getByRole("menuitem", { name: /trips:tours.tracks.dawarich.pullLabel/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("trips:tours.tracks.dawarich.unavailableReason")).toBeVisible();
    fireEvent.click(item);
    expect(onPullDawarich).not.toHaveBeenCalled();
  });

  it("pulls from Dawarich when the item is chosen", () => {
    const onPullDawarich = vi.fn();
    renderList({ dawarichAvailable: true, onPullDawarich });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "trips:tours.tracks.dawarich.pullLabel" }));
    expect(onPullDawarich).toHaveBeenCalledTimes(1);
  });

  it("leaves Strava out of the menu when it is not connected", () => {
    renderList({ onImportStrava: undefined });
    openMenu();
    expect(screen.queryByRole("menuitem", { name: "roadtrips:strava.importButton" })).toBeNull();
  });
```
Delete the old tests at lines 100, 152, 162 and 174 (upload disabled; Dawarich disabled + reason; Dawarich enabled; pulling) — the five tests above replace them. In the delete tests (lines 115-146) replace `screen.getByText("trips:tours.tracks.deleteLabel")` with `screen.getByRole("button", { name: "trips:tours.tracks.deleteLabel" })`; in the download tests (197, 205) replace `getAllByText`/`queryByText("roadtrips:trackArchive.downloadOne")` with `getAllByRole`/`queryByRole("button", { name: "roadtrips:trackArchive.downloadOne" })`. Make `renderList` return the `render(...)` result so `container` is available.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest --run src/components/Trips/__tests__/TourTrackList.test.tsx`
Expected: FAIL — no `addRecording` trigger, no heading.

- [ ] **Step 3: Implement**

`TourTrackList.tsx`:
- Imports: `useRef` from react; `MenuButton, { type MenuItem } from "../ui/MenuButton"`; `SectionHeader from "../ui/SectionHeader"`; `{ RowActionButton, RowActions } from "../table/RowActionButton"`. Remove `Button` if unused after the change.
- Props: add `title: string`, destructure it. Add `const fileRef = useRef<HTMLInputElement>(null);`.
- Build the menu:
```tsx
  // Three SOURCES for one action, so one control (owner, 2026-10-15, "one
  // menu button"). Dawarich stays listed when it cannot be used, with the
  // reason under it — it used to be a caption beside a dead button.
  const sources: MenuItem[] = [
    {
      id: "upload",
      label: t("trips:tours.tracks.uploadFile"),
      onSelect: () => fileRef.current?.click(),
    },
    {
      id: "dawarich",
      label: t("trips:tours.tracks.dawarich.pullLabel"),
      onSelect: onPullDawarich,
      disabled: !dawarichAvailable,
      reason: t("trips:tours.tracks.dawarich.unavailableReason"),
    },
    ...(onImportStrava
      ? [{ id: "strava", label: t("roadtrips:strava.importButton"), onSelect: onImportStrava }]
      : []),
  ];
  const busyLabel = uploading
    ? t("trips:tours.tracks.uploading")
    : pulling
      ? t("trips:tours.tracks.dawarich.pulling")
      : null;
```
- Replace the whole toolbar `<div className="flex flex-wrap items-center justify-end gap-2"> … </div>` (and its comment) with:
```tsx
      <SectionHeader
        title={title}
        actions={
          <MenuButton
            label={busyLabel ?? t("trips:tours.tracks.addRecording")}
            items={sources}
            disabled={busyLabel !== null}
          />
        }
      />
      {/* Outside any <button>: a file input nested in one does not reliably
          open its picker. The menu's Upload item clicks it. */}
      <input
        ref={fileRef}
        type="file"
        // GPX, and since 2.7 the watch formats: TCX and FIT (Garmin, Wahoo,
        // Coros …). The server decides the format by the bytes.
        accept=".gpx,.tcx,.fit"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          // Clear it, so re-selecting the SAME file after fixing it still fires.
          e.target.value = "";
        }}
      />
```
- In each track `<li>`, replace the download and delete text buttons with:
```tsx
              <RowActions>
                {onDownload && (
                  <RowActionButton
                    icon="download"
                    label={t("roadtrips:trackArchive.downloadOne")}
                    onClick={() => onDownload(track)}
                  />
                )}
                <RowActionButton
                  icon="delete"
                  label={t("trips:tours.tracks.deleteLabel")}
                  onClick={() => setPendingDelete(track)}
                />
              </RowActions>
```
- Update the doc comment's first sentence: "upload a GPX, pull a window from Dawarich" → "add a recording from a file, Dawarich or Strava through one menu".

`TripRouteEditorPage.tsx`: in the tracks `<section>`, drop the `<h2>` and pass `title={t("trips:tours.tracks.heading")}`.

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest --run src/components/Trips/__tests__/TourTrackList.test.tsx src/pages/__tests__/TripRouteEditorPage src/i18n`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Trips/TourTrackList.tsx frontend/src/components/Trips/__tests__/TourTrackList.test.tsx frontend/src/pages/TripRouteEditorPage.tsx frontend/src/i18n/resources
git commit -m "fix(design): one Add recording menu heads the recordings, and the upload opens again

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Journey detail tabs — timeline, gallery, album, summary

**Files:**
- Modify: `frontend/src/components/Trips/TimelineActions.tsx`
- Modify: `frontend/src/components/Trips/TripGallery.tsx` (header ~124-156)
- Modify: `frontend/src/components/Trips/ImmichAlbumSection.tsx` (header ~276-345)
- Modify: `frontend/src/components/Trips/SummaryCard.tsx` (~144-178)
- Modify: `frontend/src/components/Trips/TimelineJournalCard.tsx` (~77-150)
- Modify: `frontend/src/components/Trips/TimelineNoteCard.tsx` (~74-90)
- Test: `frontend/src/__tests__/actionCohesion.test.ts`, plus the existing `TripGallery.test.tsx`, `ImmichAlbumSection.test.tsx`, `TripSummaryPanel.test.tsx` suites

**Interfaces:**
- Consumes: `Button`, `RowActionButton`, `RowActions` (from `table/RowActionButton`).
- Produces: nothing new for later tasks. `TimelineJournalCard`'s exported local `RowActions({ onView?, onEdit, onDelete })` keeps its name and signature (it is imported by `TripDetailPage.tsx`, which must not change); only its body changes.

- [ ] **Step 1: Write the failing test**

Append to `actionCohesion.test.ts`:
```ts
describe("the journey's tabs draw the shared controls, at the right", () => {
  /**
   * Owner, 2026-10-15: "go through flight trip, road trip and journey, all of
   * the regular screen … the interactable buttons should be on the right side
   * of screen … should be same design and size". These were hand-rolled 12px
   * outlines and underlined words; the gallery's Upload was a second amber.
   */
  const TAB_CONTROLS = [
    "components/Trips/TimelineActions.tsx",
    "components/Trips/TripGallery.tsx",
    "components/Trips/ImmichAlbumSection.tsx",
    "components/Trips/SummaryCard.tsx",
    "components/Trips/TimelineJournalCard.tsx",
    "components/Trips/TimelineNoteCard.tsx",
  ] as const;

  it.each(TAB_CONTROLS)("%s draws no hand-rolled or underlined action", (path) => {
    const src = read(path);
    expect(src).not.toContain("bg-(--accent)");
    expect(src).not.toMatch(/borderColor: "var\(--accent\)"/);
    expect(src).not.toMatch(/border: "1px solid var\(--accent\)"/);
    expect(src).not.toMatch(/<button[^>]*className="[^"]*underline/);
    expect(src).not.toMatch(/className="px-3 py-1\.5 rounded/);
  });

  it.each(["components/Trips/TimelineActions.tsx", "components/Trips/TripGallery.tsx"])(
    "%s ends its action row right",
    (path) => {
      expect(read(path)).toMatch(/justify-end|ml-auto/);
    }
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest --run src/__tests__/actionCohesion.test.ts`
Expected: FAIL on all six files.

- [ ] **Step 3: Implement**

`TimelineActions.tsx`:
- Import `Button from "../ui/Button"`; delete the `BUTTON` constant and `const style = …`.
- Container: `<div className="mb-4 flex flex-wrap justify-end gap-2">`.
- Each of the three `<button … className={BUTTON} style={style}>` becomes `<Button variant="secondary" size="toolbar" onClick={…} disabled={…}>` with the same label expression.

`TripGallery.tsx` header: the right group gets `className="ml-auto flex flex-wrap items-center justify-end gap-2"`; the Upload `<button>` becomes
```tsx
          {/* Black: an upload adds content, it does not commit an edit —
              amber is Edit and Save (owner, 2026-10-15). */}
          <Button
            variant="secondary"
            size="toolbar"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? t("common:loading.default") : t("trips:gallery.uploadButton")}
          </Button>
```
and the "Link Immich album" `<button>` becomes `<Button variant="secondary" size="toolbar" onClick={() => setShowPicker(true)}>{t("immich:albums.link")}</Button>`. Import `Button`.

`ImmichAlbumSection.tsx`:
- Re-sync `<button … className="text-xs underline …">` → `<Button variant="secondary" size="toolbar" disabled={syncing} onClick={() => void handleResync()}>` (same label expression).
- Unlink → `<Button variant="secondary" size="toolbar" onClick={onUnlinkClick}>{t("albums.unlink")}</Button>`.
- In the unlink confirm strip: "keep copies" → `<Button variant="secondary" size="toolbar" onClick={() => void handleUnlink(false)}>`; "delete copies" → `<Button variant="danger" size="toolbar" onClick={() => void handleUnlink(true)}>`; give the strip `className="mb-2 flex flex-wrap items-center justify-end gap-2 …"` keeping its other classes, with the title `<span>` keeping `flex-1`.
- Import `Button from "../ui/Button"`. Existing `ImmichAlbumSection.test.tsx` queries by text or role+name; both still match.

`SummaryCard.tsx`:
- Generate `<button …style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>` → `<Button variant="secondary" size="toolbar" onClick={() => void generateSummary()} disabled={generating}>` (same label).
- Regenerate `<button className="text-[11px] underline …">` → `<Button variant="secondary" size="toolbar" onClick={() => void generateSummary()} disabled={generating}>` (same label). Import `Button`.

`TimelineJournalCard.tsx`:
- Import `{ RowActionButton, RowActions as RowIcons } from "../table/RowActionButton"`.
- Expanded body: replace the three-button `<div className="mt-2 flex flex-wrap gap-2">…</div>` with
```tsx
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" size="toolbar" onClick={onView}>
          {t("trips:detail.timeline.openJournal")}
        </Button>
        <RowIcons>
          <RowActionButton icon="edit" label={t("common:buttons.edit")} onClick={onEdit} />
          <RowActionButton icon="delete" label={t("common:buttons.delete")} onClick={onDelete} />
        </RowIcons>
      </div>
```
  (Import `Button from "../ui/Button"`.)
- The exported `RowActions` body becomes:
```tsx
  return (
    <RowIcons>
      {onView && (
        <RowActionButton icon="view" label={t("common:accessibility.view")} onClick={onView} />
      )}
      <RowActionButton icon="edit" label={t("common:buttons.edit")} onClick={onEdit} />
      <RowActionButton icon="delete" label={t("common:buttons.delete")} onClick={onDelete} />
    </RowIcons>
  );
```

`TimelineNoteCard.tsx`: the `ev.mine` action div becomes `<div className="mt-2 flex flex-wrap items-center justify-end gap-2">`; the Edit `<button>` → `<RowActionButton icon="edit" label={t("notes:card.edit")} onClick={onEdit} />`; the "All notes" `<Link>` gets `<ActionLink to="/notes">{t("trips:detail.timeline.note.allNotes")}</ActionLink>` instead; the retry `<button>` in `TripNotesNotice` → `<Button variant="secondary" size="toolbar" onClick={onRetry}>`. Drop `ACTION_STYLE` if now unused. Imports: `Button`, `ActionLink from "../ui/ActionLink"`, `{ RowActionButton }`.

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest --run src/__tests__/actionCohesion.test.ts src/components/Trips src/pages/__tests__/TripDetailPage.tabInUrl.test.tsx src/__tests__/components/TripSummaryPanel.test.tsx src/components/Roadtrips/__tests__/RoadtripSummaryPanel.test.tsx`
Expected: PASS. If a test looked up the old journal text buttons by text (`getByText("common:buttons.edit")`), switch it to `getByRole("button", { name: … })` — the label is the `aria-label` now.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Trips frontend/src/__tests__/actionCohesion.test.ts
git commit -m "fix(design): the journey's tabs draw the shared controls and end right

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Road-trip detail — "+ Day tour" and "Edit leg"

**Files:**
- Modify: `frontend/src/components/Roadtrips/StationTimeline.tsx` (~259-273 day tour; ~335-370 leg)
- Test: `frontend/src/components/Roadtrips/__tests__/StationTimeline.test.tsx` (extend if present — `ls frontend/src/components/Roadtrips/__tests__ | grep -i station`; create otherwise using the props of the nearest existing render of `StationTimeline` in the codebase as the fixture)

**Interfaces:**
- Consumes: `Button`, `RowActionButton` (`edit`).

- [ ] **Step 1: Write the failing test**

```tsx
  it("offers a day tour as the shared black button at the station's right", () => {
    renderTimeline({ onStartTour: vi.fn() });
    const btn = screen.getAllByRole("button", { name: "roadtrips:startTour" })[0];
    expect(btn).toHaveAttribute("data-variant", "secondary");
    expect(btn.className).toContain("self-end");
  });

  it("edits a leg from a row icon, leaving the leg's facts as plain text", () => {
    const onEditLeg = vi.fn();
    renderTimeline({ onEditLeg });
    fireEvent.click(screen.getAllByRole("button", { name: "roadtrips:timeline.legEdit" })[0]);
    expect(onEditLeg).toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "roadtrips:timeline.legEdit" })[0].style.height).toBe("");
  });
```
(Use the component's real prop names for the leg-edit callback — `grep -n "onEdit\|interface" frontend/src/components/Roadtrips/StationTimeline.tsx`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Roadtrips/__tests__/StationTimeline.test.tsx`
Expected: FAIL — the day-tour control is a dashed chip without `data-variant`.

- [ ] **Step 3: Implement**

- Day tour: replace the dashed `<button … style={{ ...CHIP, border: "1px dashed …" }}>` with
```tsx
                      <Button
                        variant="secondary"
                        size="toolbar"
                        className="self-end"
                        onClick={() => onStartTour(s)}
                      >
                        {t("roadtrips:startTour")}
                      </Button>
```
- Leg: the editable branch currently renders the whole leg as one dashed `<button>`. Render instead:
```tsx
  return (
    <div className="flex flex-wrap items-center justify-between" style={{ gap: 10 }}>
      <div className="flex flex-wrap items-center" style={{ gap: 10, fontSize: 13, color: "var(--ts-muted)" }}>
        {content}
      </div>
      <RowActionButton icon="edit" label={t("roadtrips:timeline.legEdit")} onClick={onEdit} />
    </div>
  );
```
- Imports: `Button from "../ui/Button"`, `{ RowActionButton } from "../table/RowActionButton"`. Remove `CHIP` if now unused.

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest --run src/components/Roadtrips src/pages/__tests__ -t Roadtrip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Roadtrips
git commit -m "fix(design): a station's day tour and a leg's edit join the shared controls

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Tours list — the real amber Save, the row delete icon

**Files:**
- Modify: `frontend/src/pages/ToursPage.tsx` (~231 create Save; ~305-321 row delete)
- Test: `frontend/src/pages/__tests__/ToursPage.test.tsx`, `frontend/src/__tests__/actionCohesion.test.ts`

- [ ] **Step 1: Write the failing test**

In `actionCohesion.test.ts`, add `"pages/ToursPage.tsx"` to `EDITOR_SCREENS` (so the existing no-hand-rolled-accent and toolbar-height checks cover it). In `ToursPage.test.tsx` change any `getByRole("button", { name: "trips:tours.deleteLabel" })` expectations about `data-variant="danger"` to:
```tsx
    const del = screen.getAllByRole("button", { name: "trips:tours.deleteLabel" })[0];
    // A row delete is the red icon at the row's end, not a full button per row.
    expect(del.style.color).toBe("var(--ts-bad)");
    expect(del).not.toHaveAttribute("data-variant");
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest --run src/pages/__tests__/ToursPage.test.tsx src/__tests__/actionCohesion.test.ts`
Expected: FAIL — `bg-(--accent)` found; delete carries `data-variant="danger"`.

- [ ] **Step 3: Implement**

- Create Save: replace the hand-rolled `<button … className="rounded-sm bg-(--accent) px-3 py-1.5 text-sm text-white …">` with `<Button variant="primary" size="toolbar" disabled={saving} onClick={() => void handleCreate()}>{t("trips:tours.save")}</Button>` and give its row container `justify-end` if it is a flex row (the inputs keep the left; the Save ends the row).
- Row delete: replace the `<Button variant="danger" …>` and its comment with
```tsx
              {/* A delete in a ROW of many is the red row icon (owner,
                  2026-10-15: one placement per level — page, section, row). */}
              <RowActionButton
                icon="delete"
                label={t("trips:tours.deleteLabel")}
                onClick={() => setPendingDelete(tour)}
              />
```
  and import `{ RowActionButton } from "../components/table/RowActionButton"`.

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest --run src/pages/__tests__/ToursPage.test.tsx src/__tests__/actionCohesion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ToursPage.tsx frontend/src/pages/__tests__/ToursPage.test.tsx frontend/src/__tests__/actionCohesion.test.ts
git commit -m "fix(design): the tours list saves with the real amber button and deletes from a row icon

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The rule in the design doc, cleanup, full gates, browser check

**Files:**
- Delete: `frontend/src/components/ui/DangerSection.tsx`; remove its line from `frontend/src/components/ui/index.ts`
- Modify: `design/DESIGN_SYSTEM.md` (§6 `Button` row, line ~253)
- Modify: `frontend/src/__tests__/designDocClaims.test.ts`
- Modify: `frontend/src/__tests__/actionCohesion.test.ts` (header doc comment; the obsolete right-edge list)
- Modify: `scripts/action-consistency-baseline.json` (via `--update`)

- [ ] **Step 1: Write the failing doc-claim test**

Append to `designDocClaims.test.ts` (it already reads `design/DESIGN_SYSTEM.md`; reuse its `read`/path helper):
```ts
describe("§6 states the action colour and placement rule the code enforces", () => {
  const doc = readFileSync(join(ROOT, "design", "DESIGN_SYSTEM.md"), "utf8");

  it("names amber for Edit and Save, red for Delete, black for the rest", () => {
    expect(doc).toMatch(/Edit[^\n]*Save[^\n]*amber/i);
    expect(doc).toMatch(/Delete[^\n]*red/i);
    expect(doc).toMatch(/everything else[^\n]*(black|outline)/i);
  });

  it("names the three placement levels", () => {
    expect(doc).toContain("SectionHeader");
    expect(doc).toContain("RowActionButton");
    expect(doc).toMatch(/page[^\n]*title[^\n]*right/i);
  });

  it("no longer says danger appears only in a dialog or a detail header", () => {
    expect(doc).not.toContain("four of the five transport detail headers carry it there");
  });
});
```
(Use the file's existing `ROOT`/`join`/`readFileSync` imports; add any that are missing.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest --run src/__tests__/designDocClaims.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

3a. `design/DESIGN_SYSTEM.md` §6 — replace the `Button` row's text (line ~253) with:
```
three variants, one size in a row: `size="toolbar"`, 46 px, radius 12, label 16/700, never mono. **Colour follows what the action does** (owner, 2026-10-15): **Edit and every Save / Done are amber** (`primary`; Edit is `ActionLink variant="primary"` because it navigates), **Delete and Remove are red** (`danger`, a tinted outline, never a fill), **everything else is the black outline** (`secondary`, `ActionLink`, `MenuButton`). The 52 px primary is for a lone CTA outside a row (sign-in, an empty state), never beside another control.
```
and add directly after the §6 table a short subsection:
```
### Where actions go — three levels, always ending right

1. **Page** — `BackLink` above; title left; the page's actions on the title's line at the right (`PageHeader.actions`, `DetailHeader.actions`), ordered black → amber → red. An edit page's Re-sync and Delete live here, not in sections under the form.
2. **Section** — `SectionHeader`: the `t-label-mono` label left, that section's actions at the right of the same line. Several sources for one action are one `MenuButton`, not a row of buttons.
3. **Row** — `RowActionButton` icons at the row's end; the delete icon is red at rest. An underlined word never performs an action.

A form's commit row is `FormFooter`: Cancel (black), Save (amber), at the right, pinned above the safe area on a phone.
```

3b. Delete `DangerSection.tsx` and its `index.ts` export: `git rm frontend/src/components/ui/DangerSection.tsx`, then verify `grep -rn DangerSection frontend/src` only hits `actionCohesion.test.ts` assertions that it is absent.

3c. `actionCohesion.test.ts`:
- Update the file's top doc comment: after the quoted report, add a paragraph quoting the third-round report (the spec's opening quote) and "This file now pins the third round's rule: Edit and Save amber, Delete red, the rest black, all 46; page actions beside the title, section actions in `SectionHeader`, row actions as `RowActionButton`."
- In `ACTION_ROWS` replace `"components/Trips/TourLegList.tsx"` and `"components/Trips/TourTrackList.tsx"` with `"components/ui/SectionHeader.tsx"` (the two lists now end right through it), and add `"pages/ToursPage.tsx"`.
- Add `"components/Trips/TourLegList.tsx"`, `"components/Trips/TourTrackList.tsx"`, `"components/Trips/TourPointEditor.tsx"` to a new check:
```ts
describe("no underlined word performs an action on the editor", () => {
  it.each([
    "components/Trips/TourLegList.tsx",
    "components/Trips/TourTrackList.tsx",
    "components/Trips/TourPointEditor.tsx",
    "components/Roadtrips/RoadtripEditActions.tsx",
    "pages/TripEditPage.tsx",
  ])("%s", (path) => {
    // Load-error retries are the one exception and live in their own branch;
    // match only buttons whose handler is an action prop or a state setter.
    expect(read(path)).not.toMatch(/<button[^>]*className="[^"]*underline[^"]*"[^>]*onClick=\{\(\) => (on[A-Z]|set)/);
  });
});
```

3d. `cd .. && npm run check:actions -- --update` (tightens the baseline for files whose legacy counts dropped; it refuses to raise any). Commit the baseline change with this task.

- [ ] **Step 4: Run every gate**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
cd .. && npm run check:size && npm run check:actions && npm run test:actions && npm run format:check
```
Expected: all green. Fix any Prettier diff with `npm run format` and re-run.

- [ ] **Step 5: Verify in the browser (required — tests passed last round while the layout was wrong)**

Start the app (`npm run dev` at the repo root; backend on 8000, frontend on 3000). Use the claude-in-chrome tools. On each screen, measure with `getBoundingClientRect()` via `javascript_tool`:

| Screen | Check |
|---|---|
| `/flights/journeys/<id>` | Open trip black, Edit amber, both 46 px, Edit's right edge = header card's content right edge (±1 px) |
| Edit → `/flights/journeys/<id>/edit` | title "Edit flight trip"; Re-sync black + Delete red on the title line, right edge flush; Save returns to the flight trip |
| Dashboard flights side panel → trip → Edit | lands on the same page, no popup |
| `/trips/<id>` | Edit amber; Timeline tab: three black buttons flush right; Gallery tab: Upload + Link album black, flush right |
| `/trips/<id>/edit` | Re-sync + Delete on the title line; cover row flush right; Cancel/Save flush right |
| `/roadtrips/<id>` | Edit amber; + Day tour black at the station's right |
| `/roadtrips/<id>/edit` | Re-sync + Delete trip on the title line; Points/Route/Recordings headers each with their action flush right; Add recording menu opens, Upload opens the OS file picker, Dawarich shows its reason when unconfigured; row icons at row end, delete red |
| `/tours` | create Save amber 46 px; row delete is the red icon |

Every action control: `height === 46`. Report the measured numbers in the final commit message.

- [ ] **Step 6: Commit**

```bash
git add -A design/DESIGN_SYSTEM.md frontend/src scripts/action-consistency-baseline.json
git commit -m "docs(design): the action rule is written down, and DangerSection goes

<measured browser numbers here>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then report to the owner and ask — as a single, separate question — whether to merge. Push (`git push forgejo --all`) only when the owner asks.
