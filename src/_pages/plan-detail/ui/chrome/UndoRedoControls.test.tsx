import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UndoRedoControls, { type UndoRedoControlsProps } from "./UndoRedoControls";

const renderControls = (overrides: Partial<UndoRedoControlsProps> = {}) => {
  const props: UndoRedoControlsProps = {
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: true,
    canRedo: true,
    undoLabel: "Remove bundle at Mon · P3",
    redoLabel: "Place group at Tue · P4",
    ...overrides,
  };
  render(<UndoRedoControls {...props} />);
  return props;
};

describe("UndoRedoControls", () => {
  it("names the next step in the button title/aria-label when the stack is non-empty", () => {
    renderControls();
    expect(screen.getByRole("button", { name: "Undo: Remove bundle at Mon · P3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redo: Place group at Tue · P4" })).toBeInTheDocument();
  });

  it("disables each button when its stack is empty and falls back to a plain label", () => {
    renderControls({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null });
    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
  });

  it("fires undo / redo on click", () => {
    const props = renderControls();
    fireEvent.click(screen.getByRole("button", { name: /^Undo/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Redo/ }));
    expect(props.undo).toHaveBeenCalledTimes(1);
    expect(props.redo).toHaveBeenCalledTimes(1);
  });
});
