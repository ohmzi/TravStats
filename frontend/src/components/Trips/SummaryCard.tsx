import { useState } from "react";
import type { JSX } from "react";
import { useToastStore } from "../../store/toastStore";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useHasLlm } from "../../hooks/useHasLlm";
import type { useTranslation } from "../../hooks/useTranslation";

/** The two languages the server can write; anything else falls back to German. */
export function summaryLanguageOf(uiLanguage: string): "de" | "en" {
  return uiLanguage.toLowerCase().startsWith("en") ? "en" : "de";
}

/**
 * The AI summary card, shared by the journey and the trip (template spec §3,
 * §6): both Overviews show it below their map, with their own Regenerate flow.
 *
 * The card owns the laying out, the `canGenerate` derivation (the shared demo
 * is offered no generation — it spends the OPERATOR's Ollama — and an instance
 * with no model, or the admin's off switch, is told apart from "unreachable"),
 * and the toast the server's answer maps to. The caller owns the copy
 * (`keyPrefix`: each level's own `summary.*` key set in its own namespace) and
 * the call the button makes (`generate`: the journey's
 * `POST /trips/:id/summarize` or the trip's `POST /roadtrips/:id/summarize`).
 *
 * An ALREADY generated summary is shown even where generation is refused — it
 * is content the user created, and hiding it would look like data loss — while
 * the button that would call the model again is not drawn.
 */
export interface SummaryCardProps {
  /** The stored summary; null/undefined draws the pre-generation card. */
  summary: string | null | undefined;
  /** Where this level's `summary.*` sentences live (`trips:summary`, `roadtrips:summary`). */
  keyPrefix: "trips:summary" | "roadtrips:summary";
  t: ReturnType<typeof useTranslation>["t"];
  /** The reader's UI language (`i18n.language`); the summary is written in it. */
  language: string;
  /** Writes and persists THIS level's summary; rejects with the server's refusal. */
  generate: (language: "de" | "en") => Promise<void>;
  /** Called after the server persisted a new summary, so the page reloads it. */
  onChanged: () => void;
  /** The no-model card's hook — one per surface (`trip-summary-unavailable` today). */
  unavailableTestId: string;
}

export default function SummaryCard({
  summary,
  keyPrefix,
  t,
  language,
  generate,
  onChanged,
  unavailableTestId,
}: SummaryCardProps): JSX.Element | null {
  const addToast = useToastStore((s) => s.addToast);
  const isSharedDemo = useIsDemoAccount();
  /**
   * Whether this instance HAS a text model, asked before the button is drawn
   * (auditor 3, 2026-09-19). `null` is "not answered yet" and deliberately
   * keeps the button; `"disabled"` is the admin's switch, a different
   * sentence from "no model configured".
   */
  const hasLlm = useHasLlm();
  const [generating, setGenerating] = useState(false);
  const canGenerate = !isSharedDemo && hasLlm !== false && hasLlm !== "disabled";

  const generateSummary = async (): Promise<void> => {
    setGenerating(true);
    try {
      await generate(summaryLanguageOf(language));
      addToast("success", t(`${keyPrefix}.generated`));
      onChanged();
    } catch (err: unknown) {
      const response =
        typeof err === "object" && err !== null && "response" in err
          ? (err as { response?: { status?: number; data?: { code?: string } } }).response
          : undefined;
      const status = response?.status ?? 0;
      // A switch flipped after this tab learned the capabilities: the server
      // says LLM_DISABLED, and "unreachable" would be the wrong sentence.
      const message =
        response?.data?.code === "LLM_DISABLED"
          ? t(`${keyPrefix}.disabled`)
          : response?.data?.code === "LLM_CLOUD_NOT_CONSENTED"
            ? t(`${keyPrefix}.cloudNotConsented`)
            : status === 503
              ? t(`${keyPrefix}.unavailable`)
              : t(`${keyPrefix}.error`);
      addToast("error", message);
    } finally {
      setGenerating(false);
    }
  };

  if (!summary) {
    /**
     * An instance with no model gets the sentence, not silence and not a
     * button; the shared demo still gets nothing at all — that refusal is
     * about the account, it repeats on every trip, and it is noise.
     */
    if ((hasLlm === false || hasLlm === "disabled") && !isSharedDemo) {
      return (
        <div
          className="rounded-xl p-4"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
          data-testid={unavailableTestId}
        >
          <div
            className="text-[10px] uppercase tracking-wide flex items-center gap-1.5 mb-1"
            style={{ color: "var(--text-muted)" }}
          >
            <span aria-hidden>✨</span>
            {t(`${keyPrefix}.title`)}
          </div>
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
            {hasLlm === "disabled" ? t(`${keyPrefix}.disabled`) : t(`${keyPrefix}.unavailable`)}
          </div>
        </div>
      );
    }

    // Nothing to show and nothing to offer — render no card at all rather
    // than an empty placeholder.
    if (!canGenerate) return null;

    return (
      <div
        className="rounded-xl p-4 flex items-center gap-3"
        style={{
          background: "linear-gradient(135deg, rgba(240,169,71,0.06), rgba(74,166,176,0.04))",
          border: "1px dashed var(--color-border)",
        }}
      >
        <div className="text-2xl shrink-0" aria-hidden>
          ✨
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            {t(`${keyPrefix}.title`)}
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {t(`${keyPrefix}.cta`)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void generateSummary()}
          disabled={generating}
          className="px-3 py-1.5 rounded-md text-xs font-medium border disabled:opacity-50"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          {generating ? t(`${keyPrefix}.generating`) : t(`${keyPrefix}.generateButton`)}
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <div
          className="text-[10px] uppercase tracking-wide flex items-center gap-1.5"
          style={{ color: "var(--text-muted)" }}
        >
          <span aria-hidden>✨</span>
          {t(`${keyPrefix}.title`)}
        </div>
        {canGenerate && (
          <button
            type="button"
            onClick={() => void generateSummary()}
            disabled={generating}
            className="text-[11px] underline disabled:opacity-50"
            style={{ color: "var(--text-muted)" }}
          >
            {generating ? t(`${keyPrefix}.generating`) : t(`${keyPrefix}.regenerate`)}
          </button>
        )}
      </div>
      <div className="text-sm whitespace-pre-wrap leading-relaxed">{summary}</div>
    </div>
  );
}
