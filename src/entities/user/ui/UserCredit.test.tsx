import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Credit } from "../model/credit";
import UserCredit from "./UserCredit";

const ada: Credit = {
  kind: "user",
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    label: { primary: "Ada Lovelace", secondary: "ada@example.test" },
    isServiceAccount: false,
  },
};
const campaign: Credit = {
  kind: "user",
  user: {
    id: "22222222-2222-4222-8222-222222222222",
    label: { primary: "campaign@example.test", secondary: null },
    isServiceAccount: true,
  },
};

describe("UserCredit", () => {
  it("shows the name with the email beside it (FR-413)", () => {
    render(<UserCredit credit={ada} />);

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.test")).toBeInTheDocument();
    expect(screen.queryByText("Service account")).not.toBeInTheDocument();
  });

  it("brackets the email on one line in the inline variant", () => {
    render(<UserCredit credit={ada} variant="inline" />);

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("(ada@example.test)")).toBeInTheDocument();
  });

  it("puts the email beneath the name on an inverse surface, too", () => {
    render(<UserCredit credit={ada} variant="inverse" />);

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.test")).toBeInTheDocument();
  });

  it.each(["stacked", "inline", "inverse"] as const)("badges a service account (%s)", (variant) => {
    render(<UserCredit credit={campaign} variant={variant} />);

    expect(screen.getByText("campaign@example.test")).toBeInTheDocument();
    expect(screen.getByText("Service account")).toBeInTheDocument();
  });

  it("reads Unknown when the credit names nobody", () => {
    render(<UserCredit credit={{ kind: "unknown" }} />);

    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
});
