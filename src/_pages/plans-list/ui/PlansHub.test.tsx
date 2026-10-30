import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlanRow } from "../api/loader";
import PlansHub from "./PlansHub";

// The three write dialogs are out of this suite's scope (they open only from the controls under test,
// and their own imports reach `astro:transitions/client`, which Vitest cannot resolve).
vi.mock("./PlanFormDialog", () => ({ default: () => null }));
vi.mock("./ClonePlanDialog", () => ({ default: () => null }));
vi.mock("./DeletePlanDialog", () => ({ default: () => null }));
vi.mock("@/shared/lib/forms", () => ({ useConfirmAction: () => ({ confirm: vi.fn(), isBusy: false }) }));
vi.mock("../api/plans-client", () => ({
  createPlan: vi.fn(),
  clonePlan: vi.fn(),
  renamePlan: vi.fn(),
  deletePlan: vi.fn(),
  markCurrentPlan: vi.fn(),
  unmarkCurrentPlan: vi.fn(),
  readGenerationJobStatuses: vi.fn(() => Promise.resolve([])),
}));

/**
 * The hub's capability gate (S-405). A non-editor reads every plan and can still tick rows to
 * compare them, but finds no way to create a plan and no row menu — every item in it writes. Each
 * absence is pinned beside the editor's presence, so it cannot pass on a control that never existed.
 */
const plan = (over: Partial<PlanRow>): PlanRow => ({
  id: "plan",
  name: "Plan",
  slotGridPreset: "5x8",
  updatedAt: "2026-10-01T09:00:00.000Z",
  isCurrent: false,
  counts: { students: 0, courses: 0, placements: 0 },
  indicators: [],
  ...over,
});

const PLANS = [
  plan({ id: "11111111-1111-4111-8111-111111111111", name: "Year 2026/27", isCurrent: true }),
  plan({ id: "22222222-2222-4222-8222-222222222222", name: "What-if" }),
];

describe("PlansHub", () => {
  it("gives an editor New plan and a row menu per plan", () => {
    render(<PlansHub plans={PLANS} canEdit />);

    expect(screen.getByRole("button", { name: "New plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions for Year 2026/27" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions for What-if" })).toBeInTheDocument();
  });

  it("gives a viewer every plan, its Current badge and Compare, but no New plan and no row menu", () => {
    render(<PlansHub plans={PLANS} canEdit={false} />);

    expect(screen.getByRole("link", { name: "Year 2026/27" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "What-if" })).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Actions for / })).not.toBeInTheDocument();

    // Selection drives Compare, which is a read, so it stays.
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Year 2026/27" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select What-if" }));
    expect(screen.getByRole("link", { name: "Compare" })).toBeInTheDocument();
  });

  it("asks an editor to create the first plan, and a viewer nothing at all", () => {
    const { unmount } = render(<PlansHub plans={[]} canEdit />);
    expect(screen.getByText("No plans yet — create your first plan.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New plan" })).toHaveLength(2);
    unmount();

    render(<PlansHub plans={[]} canEdit={false} />);
    expect(screen.getByText("No plans yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New plan" })).not.toBeInTheDocument();
  });
});
