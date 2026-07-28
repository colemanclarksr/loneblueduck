import { describe, expect, it } from "vitest";
import { can, canRefund, navFor, MANAGER_REFUND_LIMIT_CENTS, PERMISSIONS } from "@/lib/permissions";

// These assert the table in blueprint §5 line by line, including the
// "Cannot Do by Default" column, which is the half that usually rots.
describe("role matrix, per blueprint §5", () => {
  it("owner can do everything", () => {
    for (const p of PERMISSIONS) expect(can("OWNER", p)).toBe(true);
  });

  it("manager runs the shop but cannot touch processor settings or the audit trail", () => {
    expect(can("MANAGER", "ro:write")).toBe(true);
    expect(can("MANAGER", "inventory:write")).toBe(true);
    expect(can("MANAGER", "payment:refund")).toBe(true);
    expect(can("MANAGER", "settings:users")).toBe(true);

    expect(can("MANAGER", "settings:payment")).toBe(false);
    expect(can("MANAGER", "audit:delete")).toBe(false);
  });

  it("service advisor writes work and takes payment but cannot change tax or payment settings", () => {
    expect(can("SERVICE_ADVISOR", "estimate:write")).toBe(true);
    expect(can("SERVICE_ADVISOR", "ro:write")).toBe(true);
    expect(can("SERVICE_ADVISOR", "payment:take")).toBe(true);
    expect(can("SERVICE_ADVISOR", "message:send")).toBe(true);

    expect(can("SERVICE_ADVISOR", "settings:tax")).toBe(false);
    expect(can("SERVICE_ADVISOR", "settings:payment")).toBe(false);
    expect(can("SERVICE_ADVISOR", "payment:refund")).toBe(false);
  });

  it("technician updates its own work and sees no money", () => {
    expect(can("TECHNICIAN", "job:update")).toBe(true);

    expect(can("TECHNICIAN", "reports:financial")).toBe(false);
    expect(can("TECHNICIAN", "payment:refund")).toBe(false);
    expect(can("TECHNICIAN", "payment:take")).toBe(false);
    expect(can("TECHNICIAN", "estimate:write")).toBe(false);
  });

  it("counter clerk rings up work but cannot edit an invoice already paid", () => {
    expect(can("COUNTER_CLERK", "payment:take")).toBe(true);
    expect(can("COUNTER_CLERK", "estimate:write")).toBe(true);

    expect(can("COUNTER_CLERK", "invoice:editPaid")).toBe(false);
    expect(can("COUNTER_CLERK", "reports:financial")).toBe(false);
  });

  it("bookkeeper reads the books and changes nothing operational", () => {
    expect(can("BOOKKEEPER", "reports:financial")).toBe(true);
    expect(can("BOOKKEEPER", "reports:export")).toBe(true);
    expect(can("BOOKKEEPER", "audit:view")).toBe(true);

    expect(can("BOOKKEEPER", "ro:write")).toBe(false);
    expect(can("BOOKKEEPER", "customer:delete")).toBe(false);
    expect(can("BOOKKEEPER", "payment:take")).toBe(false);
  });

  it("only the owner may delete audit history", () => {
    const allowed = (["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN", "COUNTER_CLERK", "BOOKKEEPER"] as const)
      .filter((r) => can(r, "audit:delete"));
    expect(allowed).toEqual(["OWNER"]);
  });

  it("only the owner may configure the payment processor", () => {
    const allowed = (["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN", "COUNTER_CLERK", "BOOKKEEPER"] as const)
      .filter((r) => can(r, "settings:payment"));
    expect(allowed).toEqual(["OWNER"]);
  });
});

describe("refund limits", () => {
  it("caps a manager at the approval limit but not the owner", () => {
    expect(canRefund("MANAGER", MANAGER_REFUND_LIMIT_CENTS)).toBe(true);
    expect(canRefund("MANAGER", MANAGER_REFUND_LIMIT_CENTS + 1)).toBe(false);
    expect(canRefund("OWNER", MANAGER_REFUND_LIMIT_CENTS + 1_000_00)).toBe(true);
  });

  it("refuses roles that cannot refund at all, at any amount", () => {
    for (const role of ["SERVICE_ADVISOR", "TECHNICIAN", "COUNTER_CLERK", "BOOKKEEPER"] as const) {
      expect(canRefund(role, 1)).toBe(false);
    }
  });
});

describe("navigation", () => {
  it("gives a technician only the dashboard and their work queue", () => {
    expect(navFor("TECHNICIAN").map((i) => i.href)).toEqual(["/dashboard", "/my-work"]);
  });

  it("gives a bookkeeper reports but no repair orders", () => {
    const hrefs = navFor("BOOKKEEPER").map((i) => i.href);
    expect(hrefs).toContain("/reports");
    expect(hrefs).not.toContain("/repair-orders");
    expect(hrefs).not.toContain("/settings");
  });

  it("gives the owner every link", () => {
    expect(navFor("OWNER")).toHaveLength(9);
  });

  it("never offers a link the role cannot use", () => {
    for (const role of ["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN", "COUNTER_CLERK", "BOOKKEEPER"] as const) {
      for (const item of navFor(role)) {
        if (item.permission) expect(can(role, item.permission)).toBe(true);
      }
    }
  });
});
