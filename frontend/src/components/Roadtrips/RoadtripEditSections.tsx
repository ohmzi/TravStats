import { useCallback, useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";

import ConfirmModal from "../Training/ConfirmModal";
import DangerSection from "../ui/DangerSection";
import ResyncFromImmich from "../Trips/tripBuilder/ResyncFromImmich";
import { useTranslation } from "../../hooks/useTranslation";
import { toursApi } from "../../lib/api/tours";
import { sectionExpenseCount } from "../../lib/sectionExpenses";
import { useToastStore } from "../../store/toastStore";
import type { TourRoute } from "../../types/tour";

/**
 * The two sections the trip's edit page carries at its foot (spec 2026-10-12
 * §4): **Re-sync from Immich** for a trip filed on a journey (§K.1), and
 * **Delete** — the roadtrip delete flow the trip page's footer ran, semantics
 * unchanged: the section and its legs go, a stop that sits on the journey is
 * RELEASED rather than deleted, and costs with no journey to take them are
 * refused once with their count, asked again, then sent with the opt-in.
 *
 * A component of its own rather than more lines on `TripRouteEditorPage`,
 * which sits close to the 800-line cap and may not cross it.
 */
export default function RoadtripEditSections({
  route,
  journeyId,
}: {
  route: TourRoute;
  /** The journey this trip is filed on; null on a detached trip — no re-sync section then. */
  journeyId: string | null;
}): JSX.Element | null {
  const { t } = useTranslation(["trips", "roadtrips", "common", "tripBuilder"]);
  const addToast = useToastStore((s) => s.addToast);
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Costs with no journey to take them (forgejo#140): the delete is refused
  // once with their count, asked again, and only then sent with `deleteExpenses`.
  const [costsBlock, setCostsBlock] = useState<number | null>(null);

  const remove = useCallback(
    async (deleteExpenses = false): Promise<void> => {
      try {
        await toursApi.removeStandalone(route.id, { deleteExpenses });
        navigate("/roadtrips");
      } catch (err: unknown) {
        const count = sectionExpenseCount(err);
        if (count !== null) setCostsBlock(count);
        else addToast("error", t("roadtrips:deleteError"));
      }
    },
    [route.id, navigate, addToast, t]
  );

  // A day tour's editor carries neither section — this is the TRIP's edit page.
  if (route.kind !== "roadtrip") return null;

  return (
    <>
      {journeyId !== null && (
        <section>
          <h2 className="text-lg font-semibold mb-3">{t("tripBuilder:resync.action")}</h2>
          <p className="text-sm text-(--text-muted) mb-3">{t("tripBuilder:edit.resyncTripHint")}</p>
          {/* The trip's own Re-sync (owner request 2026-10-12): this scans and
              updates THIS trip, not the journey — the journey edit page's
              section is the journey-wide one. */}
          <ResyncFromImmich tripId={journeyId} routeId={route.id} />
        </section>
      )}

      {/* The shared destructive control, not a bare underlined word. It WAS
          `<button className="underline">` until 2026-10-15, which is the exact
          pair the owner put side by side: this screen's "Delete trip" as plain
          text beside the journey's red-outlined Delete. Their words: "delete
          button one place looks plain and boring and unrecognizable and other
          place is red and obvious". `DangerSection` is now the one way a delete
          that takes a whole thing is offered — see its doc comment for the
          rule that separates it from a row-level remove. */}
      <DangerSection
        heading={t("tripBuilder:edit.deleteHeading")}
        hint={t("tripBuilder:edit.deleteTripHint")}
        label={t("roadtrips:delete")}
        onClick={() => setConfirmDelete(true)}
      />

      {confirmDelete && (
        <ConfirmModal
          isOpen
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void remove();
          }}
          title={t("roadtrips:deleteConfirm.title")}
          message={t("roadtrips:deleteConfirm.message", { name: route.name })}
          confirmText={t("roadtrips:deleteConfirm.confirm")}
          destructive
        />
      )}

      {costsBlock !== null && (
        <ConfirmModal
          isOpen
          onClose={() => setCostsBlock(null)}
          onConfirm={() => {
            setCostsBlock(null);
            void remove(true);
          }}
          title={t("roadtrips:deleteWithCosts.title")}
          message={t("roadtrips:deleteWithCosts.message", { name: route.name, count: costsBlock })}
          confirmText={t("roadtrips:deleteWithCosts.confirm")}
          destructive
        />
      )}
    </>
  );
}
