import { beforeEach, describe, expect, it, vi } from "vitest";

const getDocumentFile = vi.fn();
const signedUrl = vi.fn();

vi.mock("@echdyn/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@echdyn/core")>()),
  getDocumentFile: (...args: unknown[]) => getDocumentFile(...args) as unknown,
}));
vi.mock("@/lib/services", () => ({ getServices: () => ({ db: "db", storage: { signedUrl } }) }));

const apiToken = "t".repeat(32);
vi.mock("@/lib/auth/config", () => ({
  getAuthConfig: () => ({
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "correct horse battery",
    API_TOKEN: apiToken,
    SESSION_SECRET: "s".repeat(32),
  }),
}));

const { GET } = await import("./route");

const get = (id: string, auth = true) =>
  GET(
    new Request(`http://localhost/documents/${id}/pdf`, {
      headers: auth ? { authorization: `Bearer ${apiToken}` } : {},
    }),
    { params: Promise.resolve({ id }) },
  );

describe("GET /documents/:id/pdf", () => {
  beforeEach(() => {
    getDocumentFile.mockReset();
    signedUrl.mockReset().mockResolvedValue("http://storage/doc.pdf?signature=abc");
  });

  it("needs a session or token", async () => {
    expect((await get("d1", false)).status).toBe(401);
  });

  it("redirects to a short-lived signed URL for the PDF", async () => {
    getDocumentFile.mockResolvedValue({
      storageKey: "uk-energy-bill/ab/abc.pdf",
      filename: "march.pdf",
    });

    const res = await get("d1");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://storage/doc.pdf?signature=abc");
    expect(signedUrl).toHaveBeenCalledWith("uk-energy-bill/ab/abc.pdf", 900);
  });

  it("is 404 for an unknown document", async () => {
    getDocumentFile.mockResolvedValue(null);

    expect((await get("nope")).status).toBe(404);
    expect(signedUrl).not.toHaveBeenCalled();
  });
});
