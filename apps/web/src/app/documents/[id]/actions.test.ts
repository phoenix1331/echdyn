import { beforeEach, describe, expect, it, vi } from "vitest";

// Next's redirect() throws to stop the action; the mock does the same so code after it never runs
class Redirect extends Error {
  constructor(readonly path: string) {
    super(`redirect ${path}`);
  }
}

class ReviewError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const core = {
  approveDocument: vi.fn(),
  appendToLabelledSet: vi.fn(),
  ReviewError,
};
const services = {
  db: {},
  storage: { get: vi.fn() },
  config: { LABELLED_SET_DIR: "/app/eval/sets/private" as string | undefined },
};
const reviewer = vi.fn<() => Promise<string | null>>();

vi.mock("@echdyn/core", () => core);
vi.mock("@/lib/services", () => ({ getServices: () => services }));
vi.mock("@/lib/auth/reviewer", () => ({ currentReviewer: reviewer }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Redirect(path);
  },
}));

const { approveReview } = await import("./actions");

const approved = {
  approved: true,
  recordId: "r1",
  data: { total_gbp: 12 },
  corrected: [],
  document: {
    slug: "uk-energy-bill",
    filename: "bill.pdf",
    sha256: "a".repeat(64),
    storageKey: "uk-energy-bill/aa/a.pdf",
  },
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.append(name, value);
  }
  return data;
}

async function redirectOf(action: Promise<unknown>): Promise<string> {
  const error: unknown = await action.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(Redirect);
  return (error as Redirect).path;
}

describe("approveReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reviewer.mockResolvedValue("admin");
    services.config.LABELLED_SET_DIR = "/app/eval/sets/private";
  });

  it("sends a signed-out caller to sign in, back to this document, without approving", async () => {
    reviewer.mockResolvedValue(null);

    expect(await redirectOf(approveReview("doc-1", {}, form({})))).toBe(
      "/login?next=%2Fdocuments%2Fdoc-1",
    );
    expect(core.approveDocument).not.toHaveBeenCalled();
  });

  it("approves with the reviewer's corrections and returns to the document", async () => {
    core.approveDocument.mockResolvedValue(approved);

    const path = await redirectOf(
      approveReview("doc-1", {}, form({ "correct.total_gbp": "12", override: "on" })),
    );

    expect(path).toBe("/documents/doc-1");
    expect(core.approveDocument).toHaveBeenCalledWith(services.db, "doc-1", {
      reviewer: "admin",
      corrections: { total_gbp: "12" },
      overrideChecks: true,
    });
    expect(core.appendToLabelledSet).not.toHaveBeenCalled();
  });

  it("returns validation errors beside their fields instead of approving", async () => {
    core.approveDocument.mockResolvedValue({
      approved: false,
      errors: [{ field: "total_gbp", rule: "total-adds-up", message: "Total is off" }],
      fields: ["total_gbp"],
    });

    expect(await approveReview("doc-1", {}, form({}))).toEqual({
      fieldErrors: { total_gbp: ["Total is off"] },
      general: [],
      canOverride: true,
    });
  });

  it("shows a review error, such as someone else approving first, as a message", async () => {
    core.approveDocument.mockRejectedValue(
      new ReviewError("not_reviewable", "This document was approved by someone else"),
    );

    expect(await approveReview("doc-1", {}, form({}))).toEqual({
      general: ["This document was approved by someone else"],
    });
  });

  it("lets unexpected errors through", async () => {
    core.approveDocument.mockRejectedValue(new Error("database down"));

    await expect(approveReview("doc-1", {}, form({}))).rejects.toThrow("database down");
  });

  it("adds the approved values and the PDF to the labelled set when asked", async () => {
    core.approveDocument.mockResolvedValue(approved);
    services.storage.get.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    core.appendToLabelledSet.mockResolvedValue("reviewed-aaaaaaaaaaaa");

    const path = await redirectOf(approveReview("doc-1", {}, form({ label: "on" })));

    expect(path).toBe("/documents/doc-1?labelled=reviewed-aaaaaaaaaaaa");
    expect(services.storage.get).toHaveBeenCalledWith("uk-energy-bill/aa/a.pdf");
    expect(core.appendToLabelledSet).toHaveBeenCalledWith("/app/eval/sets/private", {
      documentType: "uk-energy-bill",
      sha256: "a".repeat(64),
      filename: "bill.pdf",
      pdf: new Uint8Array([37, 80, 68, 70]),
      expected: { total_gbp: 12 },
      reviewer: "admin",
    });
  });

  it("still approves, and says so, when labelling fails or the file is missing", async () => {
    core.approveDocument.mockResolvedValue(approved);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    services.storage.get.mockRejectedValue(new Error("storage down"));
    expect(await redirectOf(approveReview("doc-1", {}, form({ label: "on" })))).toBe(
      "/documents/doc-1?labelled=failed",
    );

    services.storage.get.mockResolvedValue(null);
    expect(await redirectOf(approveReview("doc-1", {}, form({ label: "on" })))).toBe(
      "/documents/doc-1?labelled=failed",
    );
    expect(core.appendToLabelledSet).not.toHaveBeenCalled();
  });

  it("skips labelling when no labelled set directory is configured", async () => {
    core.approveDocument.mockResolvedValue(approved);
    delete services.config.LABELLED_SET_DIR;

    expect(await redirectOf(approveReview("doc-1", {}, form({ label: "on" })))).toBe(
      "/documents/doc-1",
    );
    expect(services.storage.get).not.toHaveBeenCalled();
  });
});
