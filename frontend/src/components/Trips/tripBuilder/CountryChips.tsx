import { useState, type JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { Input } from "../../ui/Field";
import Pill from "../../ui/Pill";

interface CountryChipsProps {
  countries: readonly string[];
  onChange: (countries: string[]) => void;
}

const CODE = /^[A-Za-z]{2}$/;

/**
 * The countries of the trip as two-letter pills, filled in by the scan. The ×
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
        <Pill key={code} color="var(--ts-muted)">
          <span className="flex items-center" style={{ gap: "var(--ts-space-sm)" }}>
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
        </Pill>
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
