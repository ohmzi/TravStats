import { useState, type CSSProperties, type JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { Input } from "../../ui/Field";
import { alpha } from "../../ui/tokens";

interface CountryChipsProps {
  countries: readonly string[];
  onChange: (countries: string[]) => void;
}

const CODE = /^[A-Za-z]{2}$/;

/**
 * A country chip is a CONTROL in a field row, not a status pill: it stands
 * beside the add-country input and takes the same metrics as that field —
 * height and padding from the input, the muted tint it always had — so the
 * row reads as one control (owner, 2026-10-11: "all these should be same
 * size"). The 11px capitalised pill recipe stays where it belongs: on status,
 * in `ui/Pill`.
 */
const CHIP: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--ts-space-sm)",
  minHeight: "var(--ts-size-touch-min)",
  padding: "0 var(--ts-space-lg)",
  borderRadius: "var(--ts-radius-pill)",
  color: "var(--ts-muted)",
  background: alpha("var(--ts-muted)", 12),
  border: `1px solid ${alpha("var(--ts-muted)", 45)}`,
  fontFamily: "var(--ts-font-ui)",
  fontSize: 14,
  fontWeight: 700,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

/**
 * The countries of the trip as two-letter chips, filled in by the scan. The ×
 * takes one off; type a code and press Enter to add one.
 */
export default function CountryChips({ countries, onChange }: CountryChipsProps): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  const [draft, setDraft] = useState("");

  const add = (): void => {
    const code = draft.trim().toUpperCase();
    setDraft("");
    if (CODE.test(code) && !countries.includes(code)) onChange([...countries, code]);
  };

  return (
    <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
      {countries.map((code) => (
        <span key={code} style={CHIP}>
          {code}
          <button
            type="button"
            aria-label={t("tripBuilder:review.header.removeCountry", { code })}
            onClick={() => onChange(countries.filter((existing) => existing !== code))}
            style={{ padding: "0 2px", color: "inherit", fontWeight: 700 }}
          >
            ×
          </button>
        </span>
      ))}
      <div style={{ width: 120 }}>
        <Input
          aria-label={t("tripBuilder:review.header.addCountry")}
          placeholder={t("tripBuilder:review.header.addCountryPlaceholder")}
          value={draft}
          maxLength={2}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={add}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
      </div>
    </div>
  );
}
