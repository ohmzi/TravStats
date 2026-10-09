import { useState, useEffect, useMemo, useCallback } from "react";
import type { JSX, ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { flightsApi, tripsApi } from "../../lib/api";
import { ColumnPicker } from "../table/ColumnPicker";
import { SortableHeader } from "../table/SortableHeader";
import ListSummaryStrip from "../table/ListSummaryStrip";
import ListEmptyState from "../table/ListEmptyState";
import { DELETE_BUTTON_CLASS } from "../../lib/deleteConfirm";
import { useColumnPrefs } from "../table/useColumnPrefs";
import type { Flight, FlightFacets, FlightInput, Trip } from "../../types";
import SimplifiedFlightFormV2 from "../SimplifiedFlightFormV2";
import SpecialFlightModal from "../SpecialFlightModal";
import FlightEditModal from "../FlightEditModal";
import FlightRowActions from "../FlightRowActions";
import { buildDuplicateInput } from "../../lib/flightDuplicate";
import type { SpecialTypeFilter } from "../specialFlights/specialTypeMeta";
import ConfirmModal from "../Training/ConfirmModal";
import { useToastStore } from "../../store/toastStore";
import { getFlightDuration } from "../../lib/flightDuration";
import { formatDurationWithEstimate } from "../../lib/formatters";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { priceCellState } from "../../lib/flightPriceCell";
import { FlightRow, FLIGHT_COLUMN_LAYOUT } from "./FlightRow";
import { FlightsFilterBar } from "./FlightsFilterBar";
import { LoyaltyFilterNotice, useLoyaltyListFilter } from "../Loyalty/LoyaltyListFilter";
import { Table, type TableColumn } from "../ui/Table";
import { formatAmount } from "../../lib/units";
import { SkeletonTable } from "../SkeletonLoader";
import { useSortPrefs } from "../table/useSortPrefs";
import { useServerPagination } from "../table/useServerPagination";
import TablePagination from "../table/TablePagination";
import {
  FLIGHT_ALWAYS_VISIBLE,
  FLIGHT_COLUMN_IDS,
  FLIGHT_SORT_KEY_BY_COLUMN,
  flightColumnLabel,
  type FlightStatusFilter,
} from "./flightColumns";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import {
  buildFlightFilterQuery,
  buildFlightListQuery,
  flightFilterSignature,
  type FlightListFilterState,
} from "../../lib/flights/flightListQuery";
import { flightSummaryFiguresFromCounts } from "../../lib/flights/flightSummaryFigures";
import { useTableHints } from "../ui/useTableHints";

/**
 * The flights table, as one component.
 *
 * Pulled out of `FlightsTablePage` (owner, 2026-10-08) so the SAME table can
 * be read in two places: the logbook at `/flights?view=table`, and the table
 * tab of a journey's own page. A journey card used to open the logbook's table
 * filtered to the trip; the page it opens now wears that journey's head and
 * figures, and the table underneath must be literally the table the logbook
 * shows — not a second renderer of the rows that drifts the first time a
 * column changes.
 *
 * Everything the table needs comes with it: the server-paged fetch, the facet
 * counts behind the filter bar and the summary strip, the sort and column
 * preferences, the four CRUD dialogs. The caller only supplies the page chrome
 * around it — what is above the table, and where it sits.
 *
 * `lockedTripId` scopes the table to ONE journey. Then the trip filter is not
 * drawn at all: the page owns the trip, and a control the reader cannot change
 * is a lie. `heading` replaces the default title for callers whose page already
 * has one (`null` draws none). `onChanged` lets a caller refresh what IT drew
 * from the same trips endpoint after a create, edit or delete here.
 */
export function FlightsTablePanel({
  lockedTripId,
  heading,
  onChanged,
}: {
  /** When set, the table shows one journey's flights and the trip filter is fixed to it. */
  lockedTripId?: string;
  /** Replaces the default page title above the table; `null` draws no title. */
  heading?: ReactNode;
  /** Called after a create, edit, duplicate or delete, for the caller's own figures. */
  onChanged?: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation([
    "flights",
    "common",
    "dashboard",
    "trips",
    "specialFlights",
    "settings",
  ]);
  const tableHints = useTableHints();
  // The card view's own search, separate from the table's filters below: the
  // two views ask different questions of the same data, and one's query must
  // not survive into the other.
  const [flights, setFlights] = useState<Flight[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [facets, setFacets] = useState<FlightFacets | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  // Scoped to a journey, the filter IS the journey and is never the reader's to
  // change; unscoped, `?trip=` seeds it (see the effect below).
  const [tripFilter, setTripFilter] = useState<"all" | "with" | "without" | string>(
    lockedTripId ?? "all"
  );
  const [specialFilter, setSpecialFilter] = useState<SpecialTypeFilter>("all");
  // Every filter, the sort and the page are decided by the SERVER now, and
  // the option lists and the summary figures come from /flights/facets.
  // They were all decided here, over a list this page fetched in full — a
  // `limit=500` loop until the account was exhausted, on every load, so that
  // a dropdown could count years (measured 2026-09-20). A page cannot be a
  // page while the thing that decides its contents runs after the fetch.
  const [search, setSearch] = useState<string>("");
  const debouncedSearch = useDebouncedValue(search);
  const [statusFilter, setStatusFilter] = useState<FlightStatusFilter>("all");
  // A loyalty link (`?membership=…&year=…`) opens the logbook on one card's
  // flights; its year seeds the ordinary year filter.
  const loyaltyFilter = useLoyaltyListFilter();
  const [yearFilter, setYearFilter] = useState<string>(() =>
    loyaltyFilter.linkedYear !== null ? String(loyaltyFilter.linkedYear) : "all"
  );
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [airlineFilter, setAirlineFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editingFlight, setEditingFlight] = useState<Flight | null>(null);
  const [editingSpecialFlight, setEditingSpecialFlight] = useState<Flight | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [flightToDelete, setFlightToDelete] = useState<Flight | null>(null);
  const [duplicateMenuFor, setDuplicateMenuFor] = useState<string | null>(null);
  // Newest first everywhere, and the choice survives a reload — the
  // column choice already did (useColumnPrefs), the sort never had.
  const { sortBy, sortOrder, setSort } = useSortPrefs("flights-list", "departureTime", "desc", [
    "departureTime",
    "airline",
    "status",
    "duration",
  ] as const);
  const flightColumnPrefs = useColumnPrefs("flights-list", FLIGHT_ALWAYS_VISIBLE);
  const [showAddFlight, setShowAddFlight] = useState(false);
  const [showSpecialModal, setShowSpecialModal] = useState(false);
  const addToast = useToastStore((state) => state.addToast);

  // `?import=email` — kept for old bookmarks. It simply opens the add dialog:
  // the drop zone is its first route now, so there is no separate email view
  // left to jump to. The param is stripped so a reload does not reopen it.
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("import") !== "email") return;
    setShowAddFlight(true);
    const next = new URLSearchParams(searchParams);
    next.delete("import");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // `?trip=` — how a journey link USED to open this table. The param IS the
  // filter rather than a hint beside it, so the link is shareable and a reload
  // lands on the same journey's flights. A journey page locks the trip instead
  // (it owns it), so there the param is not read.
  useEffect(() => {
    if (lockedTripId) return;
    const trip = searchParams.get("trip");
    if (trip !== null) setTripFilter(trip);
  }, [searchParams, lockedTripId]);

  const closeAddFlight = (): void => {
    setShowAddFlight(false);
  };

  useEffect(() => {
    const loadTrips = async (): Promise<void> => {
      try {
        const data = await tripsApi.getAll();
        setTrips(data);
      } catch (err) {
        logger.warn({ err }, "Failed to load trips");
      }
    };
    void loadTrips();
  }, []);

  /** Bumped after a create, edit, duplicate or delete — the only reason to
   *  ask the server for the same page and the same counts twice. */
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback((): void => {
    setReloadToken((n) => n + 1);
    // The same change moves the journey's own figures, which the caller drew
    // from `/trips/:id`; a table that refreshed while the band above it did
    // not would contradict it.
    onChanged?.();
  }, [onChanged]);

  /**
   * The row opens the flight's PAGE now, like a cruise row and a lodging row
   * always did. It used to open the edit form, which was the only way to read
   * the ~50 fields the table has no column for — reading meant entering an
   * editable state. The edit icon still goes straight to the form.
   */
  const openFlight = (f: Flight): void => {
    navigate(`/flights/${f.id}`);
  };

  /** "LH2462 MUC → CPH" — enough to recognise the row you clicked. */
  const flightLabel = (f: Flight): string => {
    const route = [f.depIata, f.arrIata].filter(Boolean).join(" → ");
    return [f.flightNumber, route].filter(Boolean).join(" ") || t("common:labels.unknown");
  };

  const handleDeleteClick = (id: string) => {
    setFlightToDelete(flights.find((f) => f.id === id) ?? null);
    setDeleteConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!flightToDelete) return;

    try {
      await flightsApi.delete(flightToDelete.id);
      addToast("success", t("flights:table.toast.deleted"));
      setDeleteConfirmOpen(false);
      setFlightToDelete(null);
      reload();
    } catch (error) {
      logger.error("Failed to delete flight:", error);
      addToast("error", t("dashboard:errors.deleteFlight"));
      setDeleteConfirmOpen(false);
      setFlightToDelete(null);
    }
  };

  // Close duplicate menu when clicking outside
  useEffect(() => {
    if (!duplicateMenuFor) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-duplicate-menu]")) {
        setDuplicateMenuFor(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [duplicateMenuFor]);

  const handleDuplicate = async (flight: Flight, mode: "return" | "same") => {
    setDuplicateMenuFor(null);
    const input = buildDuplicateInput(flight, mode);
    try {
      const created = await flightsApi.create(input, { force: true });
      addToast("success", t("flights:table.toast.duplicated"));
      reload();
      setEditingFlight(created);
    } catch (error) {
      logger.error("Failed to duplicate flight:", error);
      addToast("error", t("flights:table.toast.duplicateFailed"));
    }
  };

  const handleUpdate = async (id: string, updates: Partial<FlightInput>) => {
    try {
      await flightsApi.update(id, updates);
      addToast("success", t("flights:table.toast.updated"));
      setEditingFlight(null);
      reload();
    } catch (error) {
      logger.error("Failed to update flight:", error);
      addToast("error", t("dashboard:errors.updateFlight"));
      throw error;
    }
  };

  const handleAddFlight = async (
    flight: FlightInput,
    opts: { force?: boolean; merge?: boolean; hasMoreFlights?: boolean } = {}
  ): Promise<Flight> => {
    try {
      const result = (await flightsApi.create(flight, {
        force: opts.force,
        merge: opts.merge,
      })) as Flight & { mergedFields?: string[] };
      if (opts.merge && result.mergedFields && result.mergedFields.length > 0) {
        addToast(
          "success",
          t("flights:form.duplicate.mergedToast", { count: result.mergedFields.length })
        );
      } else {
        // handleAddFlight always CREATES. Reporting "updated" told the user
        // they had edited an existing record (Forgejo #11). The merge branch
        // above keeps its own wording because a merge really did change a row.
        addToast("success", t("flights:table.toast.created"));
      }
      if (!opts.hasMoreFlights) {
        setShowAddFlight(false);
      }
      reload();
      // The created flight flows back so the form can run its post-create
      // trip assignment (#199).
      return result;
    } catch (error) {
      logger.error("Failed to add flight:", error);
      throw error;
    }
  };

  const tripMap = useMemo(() => new Map(trips.map((t) => [t.id, t])), [trips]);

  const handleSort = (column: typeof sortBy) => {
    setSort(column, sortBy === column ? (sortOrder === "asc" ? "desc" : "asc") : "desc");
  };

  /**
   * The visible columns, in order, with their narrow places and their sort
   * headers. One list feeds the head and every row, so a cell can no longer
   * land under the wrong column — which is what the two separate
   * `isVisible` filters, one in the head and one in the body, made possible.
   */
  const visibleColumns = useMemo<TableColumn[]>(
    () =>
      FLIGHT_COLUMN_IDS.filter((id) => flightColumnPrefs.isVisible(id)).map((id) => {
        const layout = FLIGHT_COLUMN_LAYOUT[id];
        const label = flightColumnLabel(t, id);
        const sortKey = FLIGHT_SORT_KEY_BY_COLUMN[id];
        return {
          key: id,
          min: layout.min,
          grow: layout.grow,
          priority: layout.priority,
          align: layout.align,
          mono: layout.mono,
          onNarrow: layout.onNarrow,
          label:
            sortKey === undefined ? (
              label
            ) : (
              <SortableHeader
                column={sortKey}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={handleSort}
                ariaLabel={t("flights:table.sortBy", { col: label })}
              >
                {label}
              </SortableHeader>
            ),
        };
      }),
    [flightColumnPrefs, t, sortBy, sortOrder]
  );

  /**
   * The filter bar's answers as ONE value, so the query, the effect
   * dependencies and the pager's reset key cannot drift apart.
   */
  const filterState = useMemo<FlightListFilterState>(
    () => ({
      // Debounced: the search used to filter rows already in the browser, so
      // typing cost nothing. As a query parameter, "Lufthansa" is nine
      // requests without this, eight for a prefix nobody wanted to see.
      search: debouncedSearch,
      status: statusFilter,
      year: yearFilter,
      month: monthFilter,
      airline: airlineFilter,
      trip: lockedTripId ?? tripFilter,
      special: specialFilter,
      membershipId: loyaltyFilter.membershipId,
    }),
    [
      loyaltyFilter.membershipId,
      debouncedSearch,
      statusFilter,
      yearFilter,
      monthFilter,
      airlineFilter,
      tripFilter,
      lockedTripId,
      specialFilter,
    ]
  );
  const filterSignature = useMemo(() => flightFilterSignature(filterState), [filterState]);

  const pagination = useServerPagination(total, "flights-list", filterSignature);
  const { limit, offset } = pagination;

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        setLoading(true);
        setLoadError(false);
        const data = await flightsApi.getAll(
          buildFlightListQuery(filterState, { sortBy, sortOrder }, { limit, offset })
        );
        if (cancelled) return;
        setFlights(data.flights);
        setTotal(data.total);
      } catch (error) {
        if (cancelled) return;
        // Logged only, until 2.7: a network failure left an empty table that
        // looked exactly like an account with no flights.
        logger.error("Failed to load flights:", error);
        setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [filterState, sortBy, sortOrder, limit, offset, reloadToken]);

  // The option lists and the summary figures. Separate from the page fetch on
  // purpose: paging and re-sorting do not change a single one of these
  // numbers, and asking again would make every page turn cost two queries
  // over the whole filtered set.
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const data = await flightsApi.getFacets(buildFlightFilterQuery(filterState));
        if (!cancelled) setFacets(data);
      } catch (error) {
        // The table still works without them; the strip and the dropdowns go
        // quiet rather than showing counts nobody measured.
        logger.error("Failed to load flight facets:", error);
        if (!cancelled) setFacets(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [filterState, reloadToken]);

  /** Counted by the database under every OTHER filter, so picking a carrier
   *  no longer leaves the carrier list holding only that carrier. */
  const availableYears = useMemo(() => (facets?.years ?? []).map((y) => y.value), [facets]);
  const availableAirlines = useMemo(
    () => (facets?.airlines ?? []).map((a) => ({ name: a.value, count: a.count })),
    [facets]
  );

  /** The rule, the note and the reasons live in `lib/flights/flightSummaryFigures`. */
  const summaryFigures = useMemo(
    () =>
      facets === null
        ? []
        : flightSummaryFiguresFromCounts(facets.summary, {
            flights: (count) => t("common:summary.flights", { count }),
            airlines: (count) => t("common:summary.airlines", { count }),
            airports: (count) => t("common:summary.airports", { count }),
            withoutAirline: (count) => t("common:summary.withoutAirline", { count }),
          }),
    [facets, t]
  );

  const resetFilters = (): void => {
    setSearch("");
    setStatusFilter("all");
    setYearFilter("all");
    setMonthFilter("all");
    setAirlineFilter("all");
    // A locked trip is not a filter the reader set, so resetting leaves it be.
    setTripFilter(lockedTripId ?? "all");
    setSpecialFilter("all");
    loyaltyFilter.clear();
  };

  // Month, airline, trip and special type are the four this domain owns. A
  // locked trip does not count: the page scoped the table, the reader did not.
  const extraActiveCount =
    (monthFilter === "all" ? 0 : 1) +
    (airlineFilter === "all" ? 0 : 1) +
    (lockedTripId || tripFilter === "all" ? 0 : 1) +
    (specialFilter === "all" ? 0 : 1) +
    (loyaltyFilter.membershipId === null ? 0 : 1);
  const hasActiveFilter =
    search.length > 0 || statusFilter !== "all" || yearFilter !== "all" || extraActiveCount > 0;

  const formatFlightDurationCell = (flight: Flight) => {
    const d = getFlightDuration(flight);
    return formatDurationWithEstimate(d?.minutes ?? null, d?.estimated ?? false);
  };

  const sortLabels: Record<typeof sortBy, string> = {
    departureTime: t("flights:table.sort.departure"),
    airline: t("flights:table.sort.airline"),
    status: t("flights:table.sort.status"),
    duration: t("flights:table.sort.duration"),
  };

  return (
    <>
      <div className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          {heading === undefined ? (
            <h1 className="t-screen-title">{t("dashboard:flightsTitle")}</h1>
          ) : (
            heading
          )}
          {/* Scoped to one journey, there is no "all journeys" to go back to
              from here — the page that locked the trip brought its own way
              back in its header. */}
          {!lockedTripId && (
            <Link to="/flights" className="t-caption underline mr-auto ml-4">
              {t("flights:journeyCard.allJourneys")}
            </Link>
          )}
          <div className="flex items-center gap-2">
            <ColumnPicker
              columns={FLIGHT_COLUMN_IDS.map((id) => ({
                id,
                // Two ids whose label keys don't match their column id: the
                // duration header says "Flugzeit", the trip column borrows
                // the trips tab title.
                label:
                  id === "trip"
                    ? t("trips:tab")
                    : id === "duration"
                      ? t("flights:table.flightTime")
                      : t(`flights:table.${id}`),
                always: (FLIGHT_ALWAYS_VISIBLE as readonly string[]).includes(id),
              }))}
              prefs={flightColumnPrefs}
            />
            <button
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
              onClick={() => setShowAddFlight(true)}
            >
              <span>+</span>
              <span>{t("dashboard:addFlight")}</span>
            </button>
          </div>
        </div>

        <ListSummaryStrip
          figures={summaryFigures}
          filtered={hasActiveFilter}
          filteredLabel={t("common:filters.filtered")}
          unknown={loading || loadError}
        />

        {loyaltyFilter.membershipId !== null && (
          <div className="mb-3">
            <LoyaltyFilterNotice
              membershipId={loyaltyFilter.membershipId}
              onClear={loyaltyFilter.clear}
            />
          </div>
        )}

        <FlightsFilterBar
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          yearFilter={yearFilter}
          onYearChange={setYearFilter}
          availableYears={availableYears}
          monthFilter={monthFilter}
          onMonthChange={setMonthFilter}
          airlineFilter={airlineFilter}
          onAirlineChange={setAirlineFilter}
          availableAirlines={availableAirlines}
          tripFilter={tripFilter}
          onTripChange={setTripFilter}
          trips={trips}
          tripLocked={Boolean(lockedTripId)}
          specialFilter={specialFilter}
          onSpecialChange={setSpecialFilter}
          extraActiveCount={extraActiveCount}
          hasActiveFilter={hasActiveFilter}
          onReset={resetFilters}
          loading={loading}
          loadError={loadError}
          resultCount={total}
        />

        {loadError ? (
          <div
            role="alert"
            className="rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-4 py-4 text-sm text-[var(--danger)]"
          >
            {t("flights:table.loadError")}
          </div>
        ) : (
          <>
            {!loading && flights.length > 0 && (
              <TablePagination {...pagination} allowAll={false} placement="top" />
            )}
            {loading ? (
              <SkeletonTable rows={10} />
            ) : flights.length === 0 ? (
              <div
                className="overflow-hidden rounded-lg"
                style={{ border: "1px solid var(--color-border)" }}
              >
                <ListEmptyState
                  filtered={hasActiveFilter}
                  emptyTitle={t("flights:table.noFlights")}
                  emptyHint={t("flights:table.noFlightsHint")}
                  onReset={resetFilters}
                />
              </div>
            ) : (
              <Table columns={visibleColumns} label={t("flights:table.title")} {...tableHints}>
                {flights.map((flight) => (
                  <FlightRow
                    key={flight.id}
                    flight={flight}
                    trip={flight.tripId ? tripMap.get(flight.tripId) : undefined}
                    columns={visibleColumns}
                    language={i18n.language}
                    durationText={formatFlightDurationCell(flight)}
                    onOpen={() => openFlight(flight)}
                    cells={{
                      flightNumber: flight.flightNumber || t("common:labels.notAvailable"),
                      duration: formatFlightDurationCell(flight),
                      aircraft: flight.aircraft || t("common:labels.notAvailable"),
                      price:
                        priceCellState(flight) === "amount" ? (
                          formatAmount(flight.price!, flight.currency, {
                            language: i18n.language,
                          })
                        ) : priceCellState(flight) === "package" ? (
                          <span title={t("flights:price.packageHint")}>
                            {t("flights:price.package")}
                          </span>
                        ) : (
                          t("common:labels.notAvailable")
                        ),
                    }}
                    actions={
                      <FlightRowActions
                        flight={flight}
                        openDuplicateMenuFor={duplicateMenuFor}
                        onToggleDuplicateMenu={setDuplicateMenuFor}
                        onEdit={(f) => {
                          // Special flights → SpecialFlightModal so the user
                          // edits eclipse coords / parabolas / etc. through the
                          // same UI that created them, not the generic edit
                          // modal (which hides those fields entirely).
                          if (f.specialType) {
                            setEditingSpecialFlight(f);
                          } else {
                            setEditingFlight(f);
                          }
                        }}
                        onDuplicate={(f, mode) => void handleDuplicate(f, mode)}
                        onDelete={handleDeleteClick}
                      />
                    }
                  />
                ))}
              </Table>
            )}
            {/* `allowAll` is off: over a network "Alle" would promise a
                row count nobody has checked — see `useServerPagination`. */}
            {!loading && flights.length > 0 && <TablePagination {...pagination} allowAll={false} />}
            {/* Footer */}
            {!loading && flights.length > 0 && (
              <p className="mt-2 px-1 text-right text-xs text-(--text-muted)">
                {t("flights:table.footer.sortedBy", {
                  label: sortLabels[sortBy],
                  direction:
                    sortOrder === "asc" ? t("common:sort.ascending") : t("common:sort.descending"),
                })}
              </p>
            )}
            {/* The same footer the card view wears, in the same place: the two
                views are one page shown two ways, so the way across sits at the
                foot of both rather than only on the side that had it. Scoped to
                a journey, there is no card grid to go across to, so only the
                import hint is drawn. */}
            <p className="mt-4 text-xs text-(--text-muted)">
              {t("flights:list.wholeListHint")}{" "}
              <Link
                to="/settings/data?section=import"
                className="underline underline-offset-4 hover:text-(--text-primary)"
              >
                {t("settings:import.openHub")}
              </Link>
              {!lockedTripId && (
                <>
                  {" · "}
                  <Link to="/flights" className="underline underline-offset-4">
                    {t("flights:journeyCard.viewCards")}
                  </Link>
                </>
              )}
            </p>
          </>
        )}
      </div>

      {/* Edit Modal */}
      {editingFlight && (
        <FlightEditModal
          flight={editingFlight}
          isOpen={!!editingFlight}
          onClose={() => setEditingFlight(null)}
          onSave={handleUpdate}
        />
      )}

      {/* Add Flight Modal */}
      {showAddFlight && (
        <SimplifiedFlightFormV2
          onSubmit={handleAddFlight}
          onCancel={closeAddFlight}
          onPickSpecialFlight={() => {
            closeAddFlight();
            setShowSpecialModal(true);
          }}
        />
      )}

      {/* Special Flight Modal — create (showSpecialModal) OR edit (editingSpecialFlight) */}
      <SpecialFlightModal
        isOpen={showSpecialModal || !!editingSpecialFlight}
        flight={editingSpecialFlight}
        onClose={() => {
          setShowSpecialModal(false);
          setEditingSpecialFlight(null);
        }}
        onSaved={() => {
          // This one modal serves both create and edit, so the message has
          // to be read off which one is open — BEFORE the state is cleared,
          // or it always reports a create (Forgejo #11).
          const wasEdit = !!editingSpecialFlight;
          setShowSpecialModal(false);
          setEditingSpecialFlight(null);
          addToast(
            "success",
            t(wasEdit ? "flights:table.toast.updated" : "flights:table.toast.created")
          );
          reload();
        }}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setFlightToDelete(null);
        }}
        onConfirm={handleDelete}
        title={t("flights:table.deleteConfirm.title")}
        // Names the flight, like the other five dialogs do now. "Diesen
        // Flug" was fine on a detail page and wrong in a list, where the
        // row you clicked may not be the row you meant.
        message={t("flights:table.deleteConfirm.message", {
          name: flightToDelete ? flightLabel(flightToDelete) : "",
        })}
        confirmText={t("flights:table.deleteConfirm.confirm")}
        cancelText={t("flights:table.deleteConfirm.cancel")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
      />
    </>
  );
}
