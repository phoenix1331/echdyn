import type { RecordSummary } from "@echdyn/core";
import { describe, expect, it } from "vitest";
import { summaryCells } from "./summary";

const record = (slug: string, data: Record<string, unknown>): RecordSummary => ({
  id: "r1",
  documentId: "d1",
  filename: "march.pdf",
  documentType: { slug, name: "UK business energy bill", version: 1 },
  data,
  approvedBy: "admin",
  approvedAt: new Date(),
});

describe("summaryCells", () => {
  it("formats the type's summary fields as the review screen does", () => {
    expect(
      summaryCells(
        record("uk-energy-bill", {
          supplier: "Northern Power Ltd",
          billing_period_end: "2026-08-31",
          total_gbp: 1603.3,
        }),
      ),
    ).toEqual([
      { key: "supplier", label: "Supplier", value: "Northern Power Ltd" },
      { key: "billing_period_end", label: "Period end", value: "31 Aug 2026" },
      { key: "total_gbp", label: "Total", value: "£1,603.30" },
    ]);
  });

  it("leaves a missing value empty, and has nothing for an unknown type", () => {
    expect(summaryCells(record("uk-energy-bill", {}))[2]?.value).toBe("");
    expect(summaryCells(record("passport", { name: "x" }))).toEqual([]);
  });
});
