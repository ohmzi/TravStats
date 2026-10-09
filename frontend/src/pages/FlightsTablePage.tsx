/**
 * Flights Page
 *
 * The Flights logbook, which is one page with two middles (owner,
 * 2026-10-08): the journeys as cards, or the whole list as a table.
 *
 * The table itself moved into `FlightsTablePanel` so a journey's own page can
 * show literally the same one rather than a second copy that drifts. What is
 * left here is the choice between the two views and the card side's chrome —
 * the table's title, add button, filters and dialogs all belong to the panel.
 */

import AppShell from "../components/ui/AppShell";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "../hooks/useTranslation";
import FlightJourneyGrid from "../components/flightsTable/FlightJourneyGrid";
import { FlightsTablePanel } from "../components/flightsTable/FlightsTablePanel";
import LogbookTabs from "../components/table/LogbookTabs";

export default function FlightsTablePage(): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const [searchParams] = useSearchParams();

  // The card view is the front door: the journeys, each with its flying drawn
  // on a map. `?view=table` is the logbook's own word for "show me the table",
  // shared with the table tab of a journey's page.
  if (searchParams.get("view") !== "table") {
    return (
      <AppShell width="table">
        <LogbookTabs />
        <div className="w-full">
          {/* The same furniture the roadtrip list wears: the title, the way to
              add one, and a search over what the cards hold. */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h1 className="t-screen-title">{t("dashboard:flightsTitle")}</h1>
            {/* Adding a flight is the TABLE's dialog, and the card view does
                not render it — so this carries the reader to the table with
                the dialog already asked for (`?import=email`, which opens the
                add form). It used to be a button that set state nothing here
                could show. */}
            <Link
              to="/flights?view=table&import=email"
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
              style={{ textDecoration: "none" }}
            >
              <span>+</span>
              <span>{t("dashboard:addFlight")}</span>
            </Link>
          </div>
          <FlightJourneyGrid />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell width="table">
      <LogbookTabs />
      <FlightsTablePanel />
    </AppShell>
  );
}
