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
import ActionLink from "../components/ui/ActionLink";
import PageHeader from "../components/ui/PageHeader";
import { useSearchParams } from "react-router-dom";
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
              add one, and a search over what the cards hold. The table's own
              heading is drawn by the panel in the other branch of this page —
              the two never render together, so each view keeps its one title
              and the panel's `heading` slot is left to its other caller
              (`FlightTripDetailPage`, which passes its own). */}
          <PageHeader
            title={t("dashboard:flightsTitle")}
            actions={
              /* A destination, not an action: it carries the reader to the
                 table with the add form already asked for (`?import=email`),
                 and `ActionLink` keeps it a `Link` so a middle click still
                 opens it in a new tab. It used to be a button that set state
                 nothing here could show. */
              <ActionLink to="/flights?view=table&import=email">
                {`+ ${t("dashboard:addFlight")}`}
              </ActionLink>
            }
          />
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
