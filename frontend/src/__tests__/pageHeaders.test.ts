/**
 * One page heading.
 *
 * The app had seventeen different h1 class chains; PageHeader is all of them.
 * Thirteen pages still drew their own — a title plus a hand-built action row —
 * which is the drift this pins: the same header, drawn twice, deciding its own
 * gaps and its own control order.
 *
 * It asserts the ABSENCE of the hand-rolled shape rather than the presence of
 * PageHeader, because the failure mode is a page that quietly keeps its own
 * markup while importing the component for something else — and because the
 * exceptions below are real and must stay possible.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONVERTED = [
  "pages/BusPage.tsx",
  "pages/CruisesPage.tsx",
  "pages/FerryPage.tsx",
  "pages/RailPage.tsx",
  "pages/RentalsPage.tsx",
  "pages/LodgingListPage.tsx",
  "pages/PlacesListPage.tsx",
  "pages/RoadtripsPage.tsx",
  "pages/PlaceListsPage.tsx",
  "pages/CuratedChecklistPage.tsx",
  "pages/ToursPage.tsx",
  "pages/FlightsTablePage.tsx",
];

const read = (relative: string) => readFileSync(join(__dirname, "..", relative), "utf8");

describe("the logbook list pages", () => {
  it.each(CONVERTED)("%s draws its heading with PageHeader", (file) => {
    expect(read(file), `${file} does not import PageHeader`).toContain("PageHeader");
  });

  it.each(CONVERTED)("%s no longer hand-rolls an h1", (file) => {
    expect(read(file), `${file} still writes its own t-screen-title h1`).not.toMatch(
      /<h1[^>]*className="[^"]*t-screen-title/
    );
  });

  it("keeps the pages whose heading is legitimately not a PageHeader", () => {
    // Each of these is in the plan's exception table with a reason. If one of
    // them starts importing PageHeader, somebody converted it without reading
    // why it was left — the auth cards are centred with no action slot, and
    // PassportPage's heading is inside the PRINTED document.
    for (const file of [
      "pages/LoginPage.tsx",
      "pages/RegisterPage.tsx",
      "pages/ResetPasswordPage.tsx",
      "pages/SetupPage.tsx",
    ]) {
      expect(read(file), `${file} is an auth card, not a page header`).not.toMatch(/<PageHeader/);
    }
    expect(read("pages/PassportPage.tsx")).toContain("passport-heading");
  });
});
