import { useEffect, useState, type JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { MAX_SCAN_DAYS, windowIssue } from "../../../lib/tripBuilder/scanWindow";
import type { Day } from "../../../types/tripBuilder";
import Button from "../../ui/Button";
import Dialog from "../../ui/Dialog";
import { Field, Input } from "../../ui/Field";

interface ChangeDatesDialogProps {
  open: boolean;
  startDay: Day;
  endDay: Day;
  onClose: () => void;
  /** Scan again for these days; the page re-applies the edits by their keys. */
  onConfirm: (range: { startDay: Day; endDay: Day }) => void;
}

const ISSUE_KEY = {
  incomplete: "tripBuilder:review.dates.incomplete",
  reversed: "tripBuilder:review.dates.reversed",
  tooLong: "tripBuilder:review.dates.tooLong",
} as const;

/** Other dates for the same trip: the photos are scanned again and the edits are carried over. */
export default function ChangeDatesDialog({
  open,
  startDay,
  endDay,
  onClose,
  onConfirm,
}: ChangeDatesDialogProps): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  const [start, setStart] = useState(startDay);
  const [end, setEnd] = useState(endDay);
  useEffect(() => {
    if (open) {
      setStart(startDay);
      setEnd(endDay);
    }
  }, [open, startDay, endDay]);

  const issue = windowIssue(start, end);
  const unchanged = start === startDay && end === endDay;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("tripBuilder:review.dates.title")}
      dismissLabel={t("tripBuilder:review.dates.cancel")}
      closeLabel={t("tripBuilder:review.dates.cancel")}
      action={
        <Button
          variant="primary"
          size="toolbar"
          disabled={issue !== null || unchanged}
          onClick={() => onConfirm({ startDay: start, endDay: end })}
        >
          {t("tripBuilder:review.dates.scanAgain")}
        </Button>
      }
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
        <span className="t-caption">
          {t("tripBuilder:review.dates.hint", { days: MAX_SCAN_DAYS })}
        </span>
        <Field label={t("tripBuilder:review.dates.start")} htmlFor="builder-start">
          <Input
            id="builder-start"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field
          label={t("tripBuilder:review.dates.end")}
          htmlFor="builder-end"
          error={issue !== null ? t(ISSUE_KEY[issue], { days: MAX_SCAN_DAYS }) : undefined}
        >
          <Input
            id="builder-end"
            type="date"
            value={end}
            invalid={issue !== null}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
