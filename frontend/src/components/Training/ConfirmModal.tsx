import type { JSX } from "react";
import Modal from "../Modal";
import Button from "../ui/Button";
import { useTranslation } from "../../hooks/useTranslation";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** The confirm button removes or destroys something — it wears `danger`. */
  destructive?: boolean;
  isLoading?: boolean;
}

/**
 * A question with two answers — the one dialog the design system lets wear
 * `danger`, because it is where the object, the reach and the consequence are
 * already stated.
 *
 * It built its own overlay until 2026-09-15, and that overlay carried the
 * defect the shared frame exists to prevent: the backdrop was `fixed`, which
 * outranks an unpositioned sibling in the stacking order no matter the DOM
 * order, so it covered the buttons. Every click landed on the backdrop, which
 * closes the dialog — confirming LOOKED like it had worked while nothing
 * happened. The class beside it, `bg-[var(--bg-base)]0`, was a typo that
 * rendered no colour, which is why an invisible blocker went unnoticed for
 * months (found in the 2.6.0-rc.9 browser UAT).
 *
 * It is `Modal` now, so it inherits the escape hatch, the focus trap, the
 * focus return and the mobile docking rather than owning a third copy of
 * them — and it had no focus trap of its own at all.
 *
 * The destructive cue travelled as a CSS class (`confirmButtonClass`) until
 * 2026-10-14, which meant "this removes data" was spelled
 * `bg-[var(--danger)] hover:opacity-90` at 32 call sites and as a hand-written
 * utility list at 4 more — and nowhere was it typed. A caller that forgot the
 * class got an amber button on a delete and no error. It is `destructive`
 * now, the same question asked once, and the class constant is gone.
 */
export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  destructive = false,
  isLoading = false,
}: ConfirmModalProps): JSX.Element | null {
  const { t } = useTranslation(["training", "common"]);

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      busy={isLoading}
      title={title}
      maxWidth={512}
      testId="confirm-modal"
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          <Button size="toolbar" onClick={onClose} disabled={isLoading}>
            {cancelText || t("common:buttons.cancel")}
          </Button>
          <Button
            size="toolbar"
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading
              ? t("training:modal.processing")
              : confirmText || t("common:buttons.confirm")}
          </Button>
        </>
      }
    >
      <p className="text-sm whitespace-pre-line" style={{ color: "var(--ts-muted)" }}>
        {message}
      </p>
    </Modal>
  );
}
