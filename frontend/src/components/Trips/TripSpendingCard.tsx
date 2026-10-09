import { useEffect, useMemo, type JSX } from "react";

import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import type { ReconcilerData } from "../../lib/reconcilerNote";
import {
  categoryAmount,
  otherCurrency,
  tripSpendView,
  type CurrencyPair,
  type SpendCurrency,
  type SpendFigures,
  type TripSpendView,
} from "../../lib/tripSpendCurrency";
import { formatCurrency, localeForLanguage } from "../../lib/units";
import { minorUnits } from "../../shared/currencies";
import { useTripSpendStore } from "../../store/tripSpendStore";
import { Icon } from "../ui/Icon";
import { useTripReconciledSpend } from "./useTripReconciledSpend";

type T = ReturnType<typeof useTranslation>["t"];

/** Categories shown by name; the rest fold into one "N more" line. */
const TOP_CATEGORIES = 4;

const money = (minor: number, code: string, language: string): string =>
  formatCurrency(minor / 10 ** minorUnits(code), code, { statement: true, language });

/** The per-currency amounts as paid, for when nothing converts them: "CAD 1,000.00 + EUR 80.00". */
function nativeLine(native: Record<string, number>, language: string): string {
  const entries = Object.entries(native).filter(([, amount]) => amount !== 0);
  if (entries.length === 0) return "—";
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, amount]) => money(amount, code, language))
    .join(" + ");
}

/** "CAD 2,214.56" large, "≈ USD 1,616.40" beside it — whichever exists of the two. */
function Pair({
  pair,
  primary,
  language,
  large,
}: {
  pair: CurrencyPair;
  primary: SpendCurrency;
  language: string;
  large?: boolean;
}): JSX.Element {
  const second = otherCurrency(primary);
  const first = pair[primary];
  const other = pair[second];
  return (
    <span className="flex flex-wrap items-baseline" style={{ gap: "0 var(--ts-space-md)" }}>
      <span
        style={{
          fontSize: large ? 28 : 16,
          fontWeight: 700,
          lineHeight: 1.15,
          color: "var(--ts-text-bright)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {first === null ? "—" : money(first, primary, language)}
      </span>
      {other !== null && (
        <span
          style={{
            fontSize: large ? 15 : 13,
            color: "var(--ts-muted)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          ≈ {money(other, second, language)}
        </span>
      )}
    </span>
  );
}

/** How far the money is known: the reconciler's state, then what still needs a look. */
function statusParts(
  data: ReconcilerData | null,
  view: TripSpendView,
  t: T,
  day: (d: string) => string
): string[] {
  const parts: string[] = [];
  if (data) {
    const date = data.through ? day(data.through) : null;
    if (data.state === "upcoming") parts.push(t("trips:spend.state.upcoming"));
    if (data.state === "estimate") {
      const count = data.receipts.estimate;
      parts.push(
        count > 0 ? t("trips:spend.state.estimateFrom", { count }) : t("trips:spend.state.estimate")
      );
    }
    if (data.state === "partial") {
      parts.push(
        date ? t("trips:spend.state.partialThrough", { date }) : t("trips:spend.state.partial")
      );
    }
    if (data.state === "verified") {
      parts.push(
        date ? t("trips:spend.state.verifiedThrough", { date }) : t("trips:spend.state.verified")
      );
    }
    if (data.guesses > 0) parts.push(t("trips:spend.guesses", { count: data.guesses }));
    if (data.receipts.review > 0) {
      parts.push(t("trips:spend.review", { count: data.receipts.review }));
    }
  }
  if (view.incomplete) parts.push(t("trips:spend.incomplete"));
  return parts;
}

function rateLine(view: TripSpendView, t: T, language: string): string {
  if (view.fallback) return t(`trips:spend.rate.${view.fallback}`);
  if (view.mode === "market" || view.rate === null) return t("trips:spend.rate.market");
  const rate = new Intl.NumberFormat(localeForLanguage(language), {
    maximumFractionDigits: 4,
  }).format(view.rate);
  return t("trips:spend.rate.custom", { rate });
}

function Categories({
  cats,
  view,
  figures,
  primary,
  language,
  t,
}: {
  cats: ReconcilerData["cats"];
  view: TripSpendView;
  figures: SpendFigures;
  primary: SpendCurrency;
  language: string;
  t: T;
}): JSX.Element | null {
  if (cats.length === 0) return null;
  const sorted = [...cats].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, TOP_CATEGORIES);
  const rest = sorted.slice(TOP_CATEGORIES);
  // In the card's currency by the total's own conversion; where there is no
  // total to take a share of, the CAD figure as the reconciler reported it.
  const shown = (cad: number): string => {
    const converted = categoryAmount(cad, view, figures, primary);
    return converted === null ? money(cad, "CAD", language) : money(converted, primary, language);
  };
  const restTotal = rest.reduce((sum, [, cad]) => sum + cad, 0);
  const rows: ReadonlyArray<readonly [string, number]> =
    rest.length > 0
      ? [...top, [t("trips:spend.moreCategories", { count: rest.length }), restTotal]]
      : top;
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
      <span className="t-caption">{t("trips:spend.categories")}</span>
      <ul className="flex flex-col" style={{ gap: 2 }}>
        {rows.map(([name, cad], index) => (
          <li
            key={`${index}-${name}`}
            className="flex items-baseline justify-between gap-3 text-sm"
          >
            <span className="truncate" style={{ color: "var(--ts-text)" }}>
              {name}
            </span>
            <span style={{ color: "var(--ts-text-bright)", fontVariantNumeric: "tabular-nums" }}>
              {shown(cad)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Paid from your accounts" — what the trip cost out of the owner's bank and
 * cash accounts, as the host trip-reconciler matched it, beside the existing
 * cost tile and without touching it. Read-only: the reconciler owns these
 * rows and rewrites them on its next run.
 *
 * Both currencies at once, one large and one beside it, because the owner
 * lives in both; the swap button decides which is large and is the same
 * setting as Settings → Trip spending. Renders nothing for a trip the
 * reconciler has not booked anything on.
 */
export default function TripSpendingCard({
  tripId,
  language,
}: {
  tripId: string;
  language: string;
}): JSX.Element | null {
  const { t } = useTranslation(["trips"]);
  const display = useDisplayFormat();
  // An iPad is wide and finger-operated: the swap button's size follows the input.
  const touch = useCoarsePointer();
  const reconciliation = useTripReconciledSpend(tripId);
  const primary = useTripSpendStore((s) => s.primary);
  const rateMode = useTripSpendStore((s) => s.rateMode);
  const customUsdCad = useTripSpendStore((s) => s.customUsdCad);
  const swapPrimary = useTripSpendStore((s) => s.swapPrimary);
  const noteMarketRate = useTripSpendStore((s) => s.noteMarketRate);

  const latestUsdCad = reconciliation?.figures.latestUsdCad ?? null;
  // The settings field offers the latest rate a card has seen as its placeholder.
  useEffect(() => {
    noteMarketRate(latestUsdCad);
  }, [latestUsdCad, noteMarketRate]);

  const view = useMemo(
    () =>
      reconciliation
        ? tripSpendView(reconciliation.figures, { primary, rateMode, customUsdCad })
        : null,
    [reconciliation, primary, rateMode, customUsdCad]
  );
  if (!reconciliation || !view) return null;

  const { data, figures } = reconciliation;
  const second = otherCurrency(primary);
  const nothingConverts = view.paid.CAD === null && view.paid.USD === null;
  const showFull = view.full.CAD !== null || view.full.USD !== null;
  const status = statusParts(data, view, t, (d) => display.localDate(d));

  return (
    <section className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="t-label-mono">{t("trips:spend.title")}</h2>
        <button
          type="button"
          onClick={swapPrimary}
          aria-label={t("trips:spend.swap", { currency: second })}
          className="ts-chip inline-flex items-center"
          style={{
            gap: "var(--ts-space-xs)",
            minHeight: touch ? "var(--ts-size-touch-min)" : 28,
            padding: "0 var(--ts-space-md)",
            borderRadius: "var(--ts-radius-pill)",
            border: "1px solid var(--ts-border-button)",
            background: "transparent",
            color: "var(--ts-text)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <Icon name="arrow-left-right" size={14} />
          {second}
        </button>
      </div>
      <div
        className="flex flex-col"
        style={{
          gap: "var(--ts-space-md)",
          background: "var(--ts-surface)",
          border: "1px solid var(--ts-border)",
          borderRadius: "var(--ts-radius-card)",
          padding: "var(--ts-space-lg) var(--ts-space-xl)",
        }}
      >
        {nothingConverts ? (
          <span
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "var(--ts-text-bright)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {nativeLine(figures.spend.native, language)}
          </span>
        ) : (
          <Pair pair={view.paid} primary={primary} language={language} large />
        )}
        {showFull && (
          <div className="flex flex-col" style={{ gap: 2 }}>
            <span className="t-caption">{t("trips:spend.fullCost")}</span>
            <Pair pair={view.full} primary={primary} language={language} />
          </div>
        )}
        {status.length > 0 && <p className="t-caption">{status.join(" · ")}</p>}
        <p className="t-caption">{rateLine(view, t, language)}</p>
        {data && (
          <Categories
            cats={data.cats}
            view={view}
            figures={figures}
            primary={primary}
            language={language}
            t={t}
          />
        )}
      </div>
    </section>
  );
}
