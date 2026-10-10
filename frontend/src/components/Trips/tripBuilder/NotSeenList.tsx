import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import { Switch } from "../../ui/Field";
import { useExistingDiff } from "./ExistingDiffContext";
import StationStatusPill from "./StationStatusPill";

/**
 * Stored stations the photos do not show. Each one is kept unless the user says
 * otherwise — except one that lies entirely outside the new dates, which starts
 * removed — and says why it starts that way. `areaKey` null: the trip's timeline stops.
 */
export default function NotSeenList({ areaKey }: { areaKey: string | null }): JSX.Element | null {
  const { notSeenOf, isKept, setKept } = useExistingDiff();
  const { t } = useTranslation(["tripBuilder"]);
  const fmt = useDisplayFormat();
  const stations = notSeenOf(areaKey);
  if (stations.length === 0) return null;
  return (
    <section style={{ marginTop: "var(--ts-space-md)" }}>
      <h4 className="t-caption" style={{ fontWeight: 700 }}>
        {t(
          areaKey === null
            ? "tripBuilder:existing.notSeenStops.title"
            : "tripBuilder:existing.notSeen.title"
        )}
      </h4>
      <ul className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
        {stations.map((station) => {
          const id = station.existingId;
          if (id === undefined) return null;
          const reason = station.notSeen?.reason ?? "notInPhotos";
          const dates =
            station.before?.startDate && station.before.endDate
              ? `${fmt.localDate(station.before.startDate)} – ${fmt.localDate(station.before.endDate)}`
              : null;
          return (
            <li key={station.key} className="flex flex-col" style={{ gap: 4 }}>
              <div className="flex items-center" style={{ gap: 8 }}>
                <StationStatusPill status="notSeen" />
                {dates && <span className="t-caption">{dates}</span>}
              </div>
              <Switch
                id={`notseen-${id}`}
                label={station.title}
                sub={t(
                  reason === "outsideWindow"
                    ? "tripBuilder:existing.notSeen.reasonOutsideWindow"
                    : "tripBuilder:existing.notSeen.reasonNotInPhotos"
                )}
                checked={isKept(id)}
                onChange={(keep) => setKept(id, keep)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
