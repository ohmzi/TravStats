import { useEffect, useId, useState, type JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import {
  SPEND_CURRENCIES,
  parseRateInput,
  type RateMode,
  type SpendCurrency,
} from "../../lib/tripSpendCurrency";
import { localeForLanguage } from "../../lib/units";
import { useSettingsStore } from "../../store/settingsStore";
import { useTripSpendStore } from "../../store/tripSpendStore";
import { Input } from "../ui/Field";
import { Segmented } from "../ui/Segmented";
import { SettingRow, SettingRows } from "../ui/SettingRow";
import { SectionCard, SectionTitle } from "./SettingsShared";

const RATE_MODES: readonly RateMode[] = ["market", "custom"];

/**
 * Settings → Trip spending: how the trip page's "Paid from your accounts"
 * card shows money. Three choices, each applied the moment it is made — the
 * card reads the same store, and the store follows the account as the
 * `tripSpend` web preference.
 *
 * The rate field is a text field, not a number one: a number input in a German
 * browser silently drops "1,37" as invalid, and an empty value is a real state
 * here ("no rate yet"), which the card answers by showing the market rate and
 * saying why.
 */
export default function TripSpendSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const language = useSettingsStore((s) => s.display.language);
  const primary = useTripSpendStore((s) => s.primary);
  const rateMode = useTripSpendStore((s) => s.rateMode);
  const customUsdCad = useTripSpendStore((s) => s.customUsdCad);
  const seenMarketUsdCad = useTripSpendStore((s) => s.seenMarketUsdCad);
  const setPrimary = useTripSpendStore((s) => s.setPrimary);
  const setRateMode = useTripSpendStore((s) => s.setRateMode);
  const setCustomUsdCad = useTripSpendStore((s) => s.setCustomUsdCad);

  const inputId = useId();
  const [draft, setDraft] = useState(() => (customUsdCad === null ? "" : String(customUsdCad)));
  // A rate that arrives from elsewhere (another device, another tab) replaces
  // the field — unless the field already says the same number another way.
  useEffect(() => {
    setDraft((current) =>
      parseRateInput(current) === customUsdCad
        ? current
        : customUsdCad === null
          ? ""
          : String(customUsdCad)
    );
  }, [customUsdCad]);

  const custom = rateMode === "custom";
  const parsed = parseRateInput(draft);
  const invalid = custom && parsed === "invalid";
  const latest =
    seenMarketUsdCad === null
      ? null
      : new Intl.NumberFormat(localeForLanguage(language), { maximumFractionDigits: 4 }).format(
          seenMarketUsdCad
        );

  const onRateChange = (text: string): void => {
    setDraft(text);
    const value = parseRateInput(text);
    if (value !== "invalid") setCustomUsdCad(value);
  };

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:tripSpend.title")}
        description={t("settings:tripSpend.description")}
      />
      <SettingRows>
        <SettingRow
          title={t("settings:tripSpend.primary.label")}
          sub={t("settings:tripSpend.primary.sub")}
          control={
            <Segmented<SpendCurrency>
              label={t("settings:tripSpend.primary.label")}
              value={primary}
              onChange={setPrimary}
              options={SPEND_CURRENCIES.map((code) => ({ value: code, label: code }))}
            />
          }
        />
        <SettingRow
          title={t("settings:tripSpend.rateMode.label")}
          sub={t("settings:tripSpend.rateMode.sub")}
          control={
            <Segmented<RateMode>
              label={t("settings:tripSpend.rateMode.label")}
              value={rateMode}
              onChange={setRateMode}
              options={RATE_MODES.map((mode) => ({
                value: mode,
                label: t(`settings:tripSpend.rateMode.${mode}`),
              }))}
            />
          }
        />
        <SettingRow
          title={t("settings:tripSpend.customRate.label")}
          htmlFor={inputId}
          sub={
            invalid ? (
              <span role="alert" style={{ color: "var(--ts-bad)" }}>
                {t("settings:tripSpend.customRate.invalid")}
              </span>
            ) : !custom ? (
              t("settings:tripSpend.customRate.disabledHint")
            ) : latest ? (
              t("settings:tripSpend.customRate.latest", { rate: latest })
            ) : (
              t("settings:tripSpend.customRate.hint")
            )
          }
          control={
            <span className="inline-flex items-center" style={{ gap: "var(--ts-space-sm)" }}>
              <span className="t-caption">{t("settings:tripSpend.customRate.prefix")}</span>
              <Input
                id={inputId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={draft}
                disabled={!custom}
                invalid={invalid}
                aria-invalid={invalid || undefined}
                placeholder={latest ?? t("settings:tripSpend.customRate.placeholder")}
                onChange={(event) => onRateChange(event.target.value)}
                style={{ width: 110, opacity: custom ? 1 : 0.5 }}
              />
              <span className="t-caption">{t("settings:tripSpend.customRate.suffix")}</span>
            </span>
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
