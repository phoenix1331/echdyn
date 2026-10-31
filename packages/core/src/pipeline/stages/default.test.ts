import { describe, expect, it } from "vitest";
import { fakeChatClient } from "../../testing/fake-chat-client";
import { createPipelineStages } from "./default";

describe("createPipelineStages", () => {
  it("uses the production order: render for scans, then two extraction runs before validation", () => {
    const stages = createPipelineStages({
      client: fakeChatClient([]),
      textModel: "m",
      autoApprove: true,
    });

    expect(stages.map((s) => s.name)).toEqual([
      "pre-process",
      "render",
      "extract",
      "extract",
      "validate",
      "score",
    ]);
  });
});
