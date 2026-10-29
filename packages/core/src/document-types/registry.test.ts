import { describe, expect, it } from "vitest";
import { energyBill } from "./energy-bill";
import { documentTypeRegistry, getDocumentType, toJsonSchema } from "./registry";

interface PropertySchema {
  type: string;
  format?: string;
  pattern?: string;
  description?: string;
}

describe("document type registry", () => {
  it("registers the energy bill type", () => {
    expect(documentTypeRegistry).toContain(energyBill);
    expect(getDocumentType("uk-energy-bill")).toBe(energyBill);
  });

  it("returns undefined for an unknown slug", () => {
    expect(getDocumentType("nope")).toBeUndefined();
  });

  it("has unique slug and version pairs", () => {
    const keys = documentTypeRegistry.map((d) => `${d.slug}@${d.version}`);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("toJsonSchema", () => {
  const schema = toJsonSchema(energyBill) as {
    type: string;
    required: string[];
    additionalProperties: boolean;
    properties: Record<string, PropertySchema>;
  };

  it("produces a closed object requiring every field", () => {
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toHaveLength(12);
    expect(Object.keys(schema.properties)).toEqual(schema.required);
  });

  it("keeps date format but drops Zod's heavy date regex", () => {
    expect(schema.properties.billing_period_start).toMatchObject({
      type: "string",
      format: "date",
    });
    expect(schema.properties.billing_period_start?.pattern).toBeUndefined();
  });

  it("keeps simple patterns and describes every field for the model", () => {
    expect(schema.properties.meter_point_number?.pattern).toBe("^\\d{6,13}$");

    for (const property of Object.values(schema.properties)) {
      expect(property.description).toBeTruthy();
    }
  });
});
