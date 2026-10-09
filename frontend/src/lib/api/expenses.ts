import { api } from "./client";
import type { AmountsByCurrency, ExpenseInput, TripExpense } from "../../types/expense";

/** What `GET /trips/:id/expenses` answers: the rows, and their sum per currency. */
export interface TripExpenseList {
  /** The trip's own (trip-wide) expenses AND its sections'. */
  expenses: TripExpense[];
  totals: AmountsByCurrency;
}

/**
 * A roadtrip's expenses (forgejo#140) — the web books costs on the roadtrip
 * page only, so writing covers that family. The trip-wide family
 * (`/trips/:id/expenses`) is READ for the trip page's "Paid from your
 * accounts" card, whose rows a host service books through the public API.
 */
export const expensesApi = {
  /** Bare response, like every trip router (ADR 0001). */
  listForTrip: async (tripId: string): Promise<TripExpenseList> => {
    const { data } = await api.get<TripExpenseList>(`/trips/${tripId}/expenses`);
    return data;
  },

  createForRoadtrip: async (roadtripId: string, input: ExpenseInput): Promise<TripExpense> => {
    const { data } = await api.post<{ expense: TripExpense }>(
      `/roadtrips/${roadtripId}/expenses`,
      input
    );
    return data.expense;
  },

  /** Partial: an omitted field is left alone, `null` clears it. */
  updateForRoadtrip: async (
    roadtripId: string,
    expenseId: string,
    input: Partial<ExpenseInput>
  ): Promise<TripExpense> => {
    const { data } = await api.patch<{ expense: TripExpense }>(
      `/roadtrips/${roadtripId}/expenses/${expenseId}`,
      input
    );
    return data.expense;
  },

  removeForRoadtrip: async (roadtripId: string, expenseId: string): Promise<void> => {
    await api.delete(`/roadtrips/${roadtripId}/expenses/${expenseId}`);
  },
};
