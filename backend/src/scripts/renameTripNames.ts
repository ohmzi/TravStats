/**
 * Bring every existing journey's trip rows and their Immich albums to the
 * naming convention (owner instruction 2026-10-12: "after changes are deployed
 * update all the existing trip and album names through the new logic, try to
 * run it via code rather than modifying the data").
 *
 * The rules live in `src/services/tripBuilder/renameExisting.ts` and are the
 * scan's own (the one naming pass, the pitstop city chain, the page's album
 * linker) — this script reads the rows, prints what would change and, with
 * `--apply`, renames the DB row, the album-link row and the Immich album
 * (name + description) together, one transaction-and-Immich-sequence per row.
 *
 * DRY RUN BY DEFAULT — prints the table and writes NOTHING.
 *
 * Usage
 * -----
 *   cd backend
 *   DATABASE_URL=… npx tsx src/scripts/renameTripNames.ts            # dry run
 *   DATABASE_URL=… npx tsx src/scripts/renameTripNames.ts --apply    # perform it
 *
 *   # In the production container the script is compiled into the image
 *   # (dist/scripts/renameTripNames.js); nothing else in the image can run
 *   # TypeScript sources.
 *   docker exec travstats-app node /app/backend/dist/scripts/renameTripNames.js --apply
 *
 * It renames only names: no album is created or deleted, no photo, asset or
 * other link is touched, and a second run reports everything unchanged. A row
 * whose album was never synced (no album of its own) is renamed alone and says
 * so; a row whose name the rules cannot re-derive is skipped with the reason.
 * Errors are caught per row, reported and do not abort the run; the exit code
 * is non-zero when any row failed.
 *
 * Only the user's own Immich connection is used (`source === "user"`): the
 * admin-global and ENV keys belong to the operator, and a rename through them
 * would reach into the wrong account's library.
 */
import { prisma } from "../db";
import { fromDbDate } from "../shared/time/localDate";
import { getCachedAirports } from "../services/airportCache";
import { createImmichClient, type ImmichClient } from "../services/immich/immichClient";
import { getImmichConnection } from "../services/immich/immichResolver";
import { stationTimes } from "../services/roadtrip/timesDto";
import { loadFlights } from "../services/tripBuilder/loadFlights";
import { scanWindow } from "../services/tripBuilder/window";
import {
  pitstopFlights,
  planJourneyRename,
  rowAlbumOf,
  rowCityOf,
  type AlbumTarget,
  type LinkedAlbumRef,
  type RenameRowInput,
  type RowPlan,
  type RowSpan,
} from "../services/tripBuilder/renameExisting";
import { pitstopAlbumDescription } from "../services/tripBuilder/stopoverAlbum";
import type { FlightAnchor } from "../services/tripBuilder/types";

/** The station columns `stationTimes` reads, and nothing else. */
interface StopRow {
  startDate: Date | null;
  endDate: Date | null;
  startUtc: Date | null;
  endUtc: Date | null;
  stopZone: string | null;
}

interface Journey {
  id: string;
  userId: string;
  name: string;
  startDay: Date | null;
  endDay: Date | null;
  routes: Array<{ id: string; name: string; stops: StopRow[] }>;
  immichAlbums: LinkedAlbumRef[];
}

/** One row and everything the script decided about renaming it. */
interface PlannedRow {
  journey: Journey;
  plan: RowPlan;
  target: AlbumTarget;
  /** The account has its own Immich connection and the album write can run. */
  canWriteAlbum: boolean;
}

const DASH = "—";

/** The row's own span from its stations' days — the min start to the max end. */
function spanOfStops(stops: readonly StopRow[]): RowSpan | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const stop of stops) {
    const times = stationTimes(stop);
    const from = times.start?.date ?? null;
    const to = times.end?.date ?? from;
    if (from !== null && (start === null || from < start)) start = from;
    if (to !== null && (end === null || to > end)) end = to;
  }
  return start !== null && end !== null ? { startDay: start, endDay: end } : null;
}

function journeyDays(journey: Journey): { startDay: string; endDay: string } | null {
  if (journey.startDay === null || journey.endDay === null) return null;
  return { startDay: fromDbDate(journey.startDay), endDay: fromDbDate(journey.endDay) };
}

/** The rows' own span, for a journey that carries no days of its own. */
function spanUnion(spans: readonly (RowSpan | null)[]): RowSpan | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const span of spans) {
    if (span === null) continue;
    if (start === null || span.startDay < start) start = span.startDay;
    if (end === null || span.endDay > end) end = span.endDay;
  }
  return start !== null && end !== null ? { startDay: start, endDay: end } : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadJourneys(): Promise<Journey[]> {
  const trips = await prisma.trip.findMany({
    where: { routes: { some: { kind: "roadtrip" } } },
    select: {
      id: true,
      userId: true,
      name: true,
      startDay: true,
      endDay: true,
      routes: {
        where: { kind: "roadtrip" },
        orderBy: { orderIdx: "asc" },
        select: {
          id: true,
          name: true,
          stops: {
            where: { viaPoint: false },
            orderBy: { routeOrderIdx: "asc" },
            select: {
              startDate: true,
              endDate: true,
              startUtc: true,
              endUtc: true,
              stopZone: true,
            },
          },
        },
      },
      immichAlbums: {
        orderBy: { sortIdx: "asc" },
        select: { id: true, immichAlbumId: true, albumName: true },
      },
    },
    orderBy: [{ userId: "asc" }, { startDay: "asc" }, { id: "asc" }],
  });
  return trips.map((trip) => ({
    ...trip,
    immichAlbums: trip.immichAlbums.map((album) => ({
      linkId: album.id,
      immichAlbumId: album.immichAlbumId,
      albumName: album.albumName,
    })),
  }));
}

/** The user's own connection only: the admin-global and ENV keys never rename. */
async function userClient(userId: string): Promise<ImmichClient | null> {
  const connection = await getImmichConnection(userId);
  if (connection === null || connection.source !== "user") return null;
  return createImmichClient(connection);
}

/** Every journey's rows, planned and paired with the album the page resolves for each. */
async function planAll(
  journeys: readonly Journey[],
  clientFor: (userId: string) => Promise<ImmichClient | null>
): Promise<PlannedRow[]> {
  const planned: PlannedRow[] = [];
  for (const journey of journeys) {
    const spans = journey.routes.map((route) => spanOfStops(route.stops));
    // The journey's own flights, in departure order, loaded by the scan's own
    // loader over the scan's own window — the journey's days when it has them,
    // else the rows' own span so a dated row can still find its flights.
    const days = journeyDays(journey) ?? spanUnion(spans);
    let flights: FlightAnchor[] = [];
    if (days !== null) {
      const anchors = await loadFlights(
        journey.userId,
        scanWindow(days.startDay, days.endDay),
        journey.id
      );
      flights = anchors.filter((anchor) => anchor.tripId === journey.id);
    }
    const codes = spans.flatMap((span) => {
      const pair = span === null ? null : pitstopFlights(flights, span);
      const iata = pair?.arriving.arrIata ?? null;
      return iata === null ? [] : [iata];
    });
    const airports = await getCachedAirports(codes);
    const rows: RenameRowInput[] = journey.routes.map((route, i) => {
      const span = spans[i];
      const city = rowCityOf({ name: route.name, span, flights, airports });
      return {
        id: route.id,
        name: route.name,
        startDay: span?.startDay ?? null,
        endDay: span?.endDay ?? null,
        city: city.city,
        citySource: city.source,
      };
    });
    const plans = planJourneyRename(journey.name, days?.startDay ?? null, rows);
    for (const plan of plans) {
      const target = rowAlbumOf(journey.name, journey.immichAlbums, plan.oldName);
      // The dry run resolves the connection too, so the table only promises
      // the album renames `--apply` will actually make.
      const canWriteAlbum =
        plan.changed && target.kind === "own" ? (await clientFor(journey.userId)) !== null : true;
      planned.push({ journey, plan, target, canWriteAlbum });
    }
  }
  return planned;
}

/** The note the row's fate earns, and why — the table's honesty column. */
function noteOf(planned: PlannedRow): string {
  const { plan, target, canWriteAlbum } = planned;
  if (plan.skipped !== null) return `skipped: ${plan.skipped}`;
  if (!plan.changed) return "unchanged";
  if (target.kind === "own") {
    return canWriteAlbum ? "rename" : "rename (row only: no user Immich connection)";
  }
  if (target.kind === "journey") {
    return `rename (row only: no album of its own — the page shows the journey's ${JSON.stringify(
      target.album.albumName
    )}, left alone)`;
  }
  return "rename (row only: the journey links no album)";
}

function lineOf(planned: PlannedRow): string[] {
  const { journey, plan, target } = planned;
  const own = target.kind === "own" ? target.album : null;
  return [
    journey.name,
    plan.rowId,
    plan.oldName,
    plan.changed ? plan.newName : DASH,
    own === null ? DASH : own.linkId,
    own === null ? DASH : own.albumName,
    own !== null && plan.changed ? plan.newName : DASH,
    noteOf(planned),
  ];
}

function printTable(header: readonly string[], rows: readonly string[][]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const render = (cells: readonly string[]): string =>
    cells
      .map((cell, i) => cell.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  console.log(render(header));
  console.log(render(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(render(row));
}

/**
 * One row's rename: the Immich album first (the write that can fail on its
 * own), then the two DB rows in one transaction. The album is only written
 * when the row has one of its own; otherwise the row moves alone, as the
 * add-only rule requires.
 */
async function applyRow(
  planned: PlannedRow,
  clientFor: (userId: string) => Promise<ImmichClient | null>
): Promise<"album+row" | "row"> {
  const { journey, plan, target } = planned;
  if (target.kind === "own") {
    const client = await clientFor(journey.userId);
    if (client !== null) {
      await client.updateAlbum(target.album.immichAlbumId, {
        albumName: plan.newName,
        description: pitstopAlbumDescription(plan.newName),
      });
      const [route, link] = await prisma.$transaction([
        prisma.tripRoute.updateMany({
          where: { id: plan.rowId, tripId: journey.id },
          data: { name: plan.newName },
        }),
        prisma.tripImmichAlbum.updateMany({
          where: { id: target.album.linkId, tripId: journey.id },
          data: { albumName: plan.newName },
        }),
      ]);
      if (route.count !== 1 || link.count !== 1) {
        throw new Error(
          `the row moved under the script (route ${route.count}, link ${link.count}) — the album was renamed, the DB was not`
        );
      }
      return "album+row";
    }
  }
  const route = await prisma.tripRoute.updateMany({
    where: { id: plan.rowId, tripId: journey.id },
    data: { name: plan.newName },
  });
  if (route.count !== 1) throw new Error(`the row moved under the script (route ${route.count})`);
  return "row";
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("renameTripNames: DATABASE_URL is not set — refusing to run.\n");
    process.exitCode = 1;
    return;
  }
  const apply = process.argv.slice(2).includes("--apply");
  console.log(
    `Existing trip and album names → the naming convention — ${
      apply ? "APPLY (writing)" : "DRY RUN (nothing written)"
    }`
  );

  const clients = new Map<string, ImmichClient | null>();
  const clientFor = async (userId: string): Promise<ImmichClient | null> => {
    if (!clients.has(userId)) clients.set(userId, await userClient(userId));
    return clients.get(userId) ?? null;
  };

  const journeys = await loadJourneys();
  const planned = await planAll(journeys, clientFor);

  const rows: string[][] = planned.map((row) => lineOf(row));
  printTable(
    ["JOURNEY", "ROW", "OLD NAME", "NEW NAME", "ALBUM", "OLD ALBUM", "NEW ALBUM", "NOTE"],
    rows
  );

  const skips = new Map<string, number>();
  let renames = 0;
  let unchanged = 0;
  for (const row of planned) {
    if (row.plan.skipped !== null)
      skips.set(row.plan.skipped, (skips.get(row.plan.skipped) ?? 0) + 1);
    else if (row.plan.changed) renames += 1;
    else unchanged += 1;
  }
  const skipped = [...skips.values()].reduce((sum, count) => sum + count, 0);
  const reasons = [...skips].map(([reason, count]) => `${count} ${reason}`).join("; ");
  console.log(
    `summary: rename: ${renames}, unchanged: ${unchanged}, skipped: ${skipped}` +
      (reasons === "" ? "" : ` (${reasons})`)
  );

  if (!apply) {
    console.log("DRY RUN — nothing was written. Re-run with --apply to perform the changes.");
    return;
  }

  let applied = 0;
  let rowOnly = 0;
  const failures: Array<{ row: PlannedRow; error: string }> = [];
  for (const row of planned) {
    if (!row.plan.changed) continue;
    try {
      const outcome = await applyRow(row, clientFor);
      if (outcome === "row") rowOnly += 1;
      applied += 1;
    } catch (error) {
      failures.push({ row, error: messageOf(error) });
    }
  }
  for (const failure of failures) {
    console.error(
      `FAILED row ${failure.row.plan.rowId} (${failure.row.journey.name}): ${failure.error}`
    );
  }
  console.log(
    `applied: ${applied} (${rowOnly} row-only), failed: ${failures.length}` +
      (failures.length > 0 ? " — re-run after looking at the failures above" : "")
  );
  if (failures.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`renameTripNames failed: ${messageOf(error)}`);
    process.exitCode = 1;
  });
}
