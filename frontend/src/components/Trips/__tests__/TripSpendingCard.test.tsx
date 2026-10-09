import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { TripExpense } from "../../../types/expense";
import { RECONCILER_MARKER } from "../../../lib/reconcilerNote";
import { DEFAULT_TRIP_SPEND_SETTING } from "../../../lib/tripSpendCurrency";
import { useTripSpendStore } from "../../../store/tripSpendStore";

// The card loads the trip's expenses itself; the setup refuses a request that
// reaches the network (forgejo#110), so the client is the stub here.
const listForTrip = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/expenses", () => ({ expensesApi: { listForTrip } }));

// The global i18n stub returns the bare key; this one shows what the key was
// given too, so a test can see the date and the counts the card hands it.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

import TripSpendingCard from "../TripSpendingCard";

const TRIP = "6f1c1c3e-2b8e-4a55-9a51-0d6f1e6b2a10";

const DATA = {
  cats: [
    ["Dining", "61240"],
    ["Transit", "12000"],
    ["Groceries", "9000"],
    ["Museums", "5000"],
    ["Laundry", "1200"],
    ["Tips", "800"],
  ],
  cur: "CAD",
  guesses: 3,
  idle: [],
  latestUsdCad: 1.3712,
  native: "100000",
  priced: { atDate: { CAD: "98000", USD: "71500" }, native: { CAD: "98000" } },
  receipts: { estimate: 0, pending: 0, review: 1 },
  spend: { atDate: { CAD: "123456", USD: "90012" }, native: { CAD: "100000", USD: "17000" } },
  state: "verified",
  through: "2026-11-30",
  unconverted: 0,
  v: 1,
};

const row = (over: Partial<TripExpense> & { data?: unknown; cur?: string }): TripExpense => {
  const { data = DATA, cur = "CAD", ...rest } = over;
  return {
    id: `e-${cur}`,
    tripId: TRIP,
    routeId: null,
    stopId: null,
    legFromStopId: null,
    legToStopId: null,
    kind: "other",
    amount: 1000,
    currency: cur,
    date: null,
    note: `${RECONCILER_MARKER}trip=${TRIP} cur=${cur}] Matched from your accounts.\n#data ${
      typeof data === "string" ? data : JSON.stringify(data)
    }`,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...rest,
  };
};

const answer = (expenses: TripExpense[]) => listForTrip.mockResolvedValue({ expenses, totals: {} });

/** Lets the answered request land, so "nothing rendered" is not just "not loaded yet". */
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** "CAD 1,234.56" — Intl puts a no-break space after the code, which `\s` matches. */
const amount = (code: string, figure: string) =>
  new RegExp(`${code}\\s${figure.replace(".", "\\.")}`);

describe("TripSpendingCard", () => {
  beforeEach(() => {
    listForTrip.mockReset();
    useTripSpendStore.setState({ ...DEFAULT_TRIP_SPEND_SETTING, seenMarketUsdCad: null });
  });
  afterEach(() => window.localStorage.clear());

  it("renders nothing for a trip the reconciler has not booked on", async () => {
    answer([{ ...row({}), note: "Ferry ticket" }]);
    const { container } = render(<TripSpendingCard tripId={TRIP} language="en" />);
    await waitFor(() => expect(listForTrip).toHaveBeenCalledWith(TRIP));
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the expenses cannot be loaded", async () => {
    listForTrip.mockRejectedValue(new Error("offline"));
    const { container } = render(<TripSpendingCard tripId={TRIP} language="en" />);
    await waitFor(() => expect(listForTrip).toHaveBeenCalled());
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows what was paid in both currencies, the full cost, and how far it is verified", async () => {
    answer([row({})]);
    render(<TripSpendingCard tripId={TRIP} language="en" />);

    expect(await screen.findByText("trips:spend.title")).toBeInTheDocument();
    expect(screen.getByText(amount("CAD", "1,234.56"))).toBeInTheDocument();
    expect(screen.getByText(amount("USD", "900.12"))).toHaveTextContent(/^≈/);
    // Full trip cost = paid + priced: 1234.56 + 980.00 CAD, 900.12 + 715.00 USD.
    expect(screen.getByText("trips:spend.fullCost")).toBeInTheDocument();
    expect(screen.getByText(amount("CAD", "2,214.56"))).toBeInTheDocument();
    expect(screen.getByText(amount("USD", "1,615.12"))).toBeInTheDocument();

    const status = screen.getByText(/trips:spend\.state\.verifiedThrough/);
    expect(status).toHaveTextContent('{"date":"30.11.2026"}');
    expect(status).toHaveTextContent('trips:spend.guesses {"count":3}');
    expect(status).toHaveTextContent('trips:spend.review {"count":1}');
    expect(status).not.toHaveTextContent("trips:spend.incomplete");
    expect(screen.getByText("trips:spend.rate.market")).toBeInTheDocument();
  });

  it("lists the top categories in the primary currency and folds the rest", async () => {
    answer([row({})]);
    render(<TripSpendingCard tripId={TRIP} language="en" />);
    expect(await screen.findByText("Dining")).toBeInTheDocument();
    expect(screen.getByText(amount("CAD", "612.40"))).toBeInTheDocument();
    expect(screen.queryByText("Laundry")).toBeNull();
    expect(screen.getByText('trips:spend.moreCategories {"count":2}')).toBeInTheDocument();
    expect(screen.getByText(amount("CAD", "20.00"))).toBeInTheDocument();
  });

  it("swaps which currency is large, and keeps the choice in the setting", async () => {
    answer([row({})]);
    render(<TripSpendingCard tripId={TRIP} language="en" />);
    const swap = await screen.findByRole("button", { name: /trips:spend\.swap.*USD/ });
    await userEvent.click(swap);

    expect(useTripSpendStore.getState().primary).toBe("USD");
    expect(screen.getByText(amount("CAD", "1,234.56"))).toHaveTextContent(/^≈/);
    // Categories follow: 612.40 of 1234.56 CAD is 446.50 of 900.12 USD.
    expect(screen.getByText(amount("USD", "446.50"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /trips:spend\.swap.*CAD/ })).toBeInTheDocument();
  });

  it("re-renders at once when the rate setting changes", async () => {
    answer([row({})]);
    render(<TripSpendingCard tripId={TRIP} language="en" />);
    await screen.findByText(amount("CAD", "1,234.56"));

    act(() => useTripSpendStore.setState({ rateMode: "custom", customUsdCad: 1.35 }));
    // 1000.00 + 170.00 × 1.35
    expect(screen.getByText(amount("CAD", "1,229.50"))).toBeInTheDocument();
    expect(screen.getByText(/trips:spend\.rate\.custom/)).toHaveTextContent('{"rate":"1.35"}');

    act(() => useTripSpendStore.setState({ customUsdCad: null }));
    expect(screen.getByText(amount("CAD", "1,234.56"))).toBeInTheDocument();
    expect(screen.getByText("trips:spend.rate.noCustomRate")).toBeInTheDocument();
  });

  it("notes the latest market rate for the settings field's placeholder", async () => {
    answer([row({})]);
    render(<TripSpendingCard tripId={TRIP} language="en" />);
    await screen.findByText("trips:spend.title");
    expect(useTripSpendStore.getState().seenMarketUsdCad).toBe(1.3712);
  });

  it("shows the amounts as paid, and says the conversion is incomplete, when no block can be read", async () => {
    answer([
      row({ cur: "CAD", amount: 1234.56, data: "{broken" }),
      row({ cur: "EUR", amount: 80, data: '{"v":1}' }),
    ]);
    render(<TripSpendingCard tripId={TRIP} language="en" />);
    const line = await screen.findByText(/\+/);
    expect(line).toHaveTextContent(amount("CAD", "1,234.56"));
    expect(line).toHaveTextContent(amount("EUR", "80.00"));
    expect(screen.getByText("trips:spend.incomplete")).toBeInTheDocument();
    expect(screen.queryByText("trips:spend.fullCost")).toBeNull();
  });

  it("names an estimate by its receipts, and a missing rate as an incomplete conversion", async () => {
    answer([
      row({
        data: {
          ...DATA,
          state: "estimate",
          through: null,
          guesses: 0,
          receipts: { estimate: 4, pending: 0, review: 0 },
          spend: { ...DATA.spend, atDate: { CAD: "123456", USD: null } },
        },
      }),
    ]);
    render(<TripSpendingCard tripId={TRIP} language="en" />);
    const status = await screen.findByText(/trips:spend\.state\.estimateFrom/);
    expect(status).toHaveTextContent('{"count":4}');
    expect(status).toHaveTextContent("trips:spend.incomplete");
    expect(status).not.toHaveTextContent("trips:spend.guesses");
    expect(screen.getByText(amount("CAD", "1,234.56"))).toBeInTheDocument();
  });
});
