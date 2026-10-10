import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Toast from "../Toast";
import { useToastStore } from "../../store/toastStore";

afterEach(() => {
  act(() => useToastStore.getState().clearToasts());
});

describe("a toast with an action", () => {
  it("carries a link and closes itself when the link is followed", () => {
    render(
      <MemoryRouter>
        <Toast />
      </MemoryRouter>
    );
    act(() => {
      useToastStore
        .getState()
        .addToast("info", "Dates changed", 0, { label: "Re-sync", to: "/trips/t1/resync" });
    });
    const link = screen.getByRole("link", { name: "Re-sync" });
    expect(link).toHaveAttribute("href", "/trips/t1/resync");
    fireEvent.click(link);
    expect(screen.queryByText("Dates changed")).not.toBeInTheDocument();
  });

  it("still draws a plain toast without one", () => {
    render(
      <MemoryRouter>
        <Toast />
      </MemoryRouter>
    );
    act(() => {
      useToastStore.getState().addToast("success", "Saved", 0);
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
