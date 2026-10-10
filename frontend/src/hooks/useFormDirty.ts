import { useRef } from "react";

/**
 * Whether a form's values differ from what they were when it opened. Compared
 * by value (JSON), so typing a letter and deleting it again is not a change.
 * `values` must be what the form shows: an object or array of its fields.
 *
 * The baseline is the first render of the component that calls this, so call it
 * where the form lives for as long as it is open, not in a tab or a section
 * that unmounts: a remount would take the edited values as the baseline.
 */
export function useFormDirty(values: unknown): boolean {
  const snapshot = JSON.stringify(values);
  const opened = useRef(snapshot);
  return snapshot !== opened.current;
}
