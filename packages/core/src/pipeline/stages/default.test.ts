import { describe, expect, it } from "vitest";
import { fakeChatClient } from "../../testing/fake-chat-client";
import { createPipelineStages } from "./default";

describe("createPipelineStages", () => {
  it("uses the production order: two extraction runs between pre-process and validation", () => {
    const stages = createPipelineStages({
      client: fakeChatClient([]),
      textModel: "m",
      autoApprove: true,
    });

    expect(stages.map((s) => s.name)).toEqual([
      "pre-process",
      "extract",
      "extract",
      "validate",
      "score",
    ]);
  });
});
