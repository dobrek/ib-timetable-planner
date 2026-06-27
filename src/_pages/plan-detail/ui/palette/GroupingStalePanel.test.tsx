import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cohort } from "@/shared/config";
import { refreshPage } from "@/shared/lib/forms";
import GroupingStalePanel from "./GroupingStalePanel";
import { computeGroupings } from "../../api/grouping-client";

// The panel's behavior is the unit under test; its two collaborators are mocked.
// `computeGroupings` is the existing Action wrapper (returns `{ error }`); `refreshPage`
// re-runs the loader (the success signal). The view dispatch is covered by palette-view.test,
// the end-to-end swap by the Phase 3 E2E — here we lock the panel's own contract.
vi.mock("../../api/grouping-client", () => ({ computeGroupings: vi.fn() }));
vi.mock("@/shared/lib/forms", () => ({ refreshPage: vi.fn() }));

const computeMock = vi.mocked(computeGroupings);
const refreshMock = vi.mocked(refreshPage);

const PLAN_ID = "plan-1";
const COHORT: Cohort = "dp1";

/** A controllable promise so the busy/pending intermediate state can be observed before settle. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  computeMock.mockReset();
  refreshMock.mockReset();
});

describe("GroupingStalePanel", () => {
  it("renders the out-of-date message and a Recompute control", () => {
    render(<GroupingStalePanel planId={PLAN_ID} cohort={COHORT} />);

    expect(screen.getByText(/Suggestions are out of date/)).toBeInTheDocument();
    expect(screen.getByText(/Your placed timetable is unchanged/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recompute" })).toBeInTheDocument();
  });

  it("clicking Recompute invokes computeGroupings with the plan/cohort and shows a busy, disabled button", async () => {
    const pending = deferred<{ error: string | undefined }>();
    computeMock.mockReturnValue(pending.promise);

    render(<GroupingStalePanel planId={PLAN_ID} cohort={COHORT} />);
    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));

    expect(computeMock).toHaveBeenCalledWith({ planId: PLAN_ID, cohort: COHORT });
    // Busy: the label flips and the button is disabled while the call is in flight.
    const busyButton = await screen.findByRole("button", { name: "Recomputing…" });
    expect(busyButton).toBeDisabled();

    // Success → re-run the loader (the returning palette is the success signal).
    pending.resolve({ error: undefined });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });

  it("an error result renders an inline alert, keeps the panel, and never reloads", async () => {
    computeMock.mockResolvedValue({ error: "Compute failed" });

    render(<GroupingStalePanel planId={PLAN_ID} cohort={COHORT} />);
    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Compute failed");
    expect(refreshMock).not.toHaveBeenCalled();
    // The panel stays put for a retry: the Recompute button returns to its idle, enabled state.
    expect(screen.getByRole("button", { name: "Recompute" })).toBeEnabled();
  });
});
