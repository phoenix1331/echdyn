import type { ChatRequest, ChatResponse } from "ollama";
import type { ChatClient } from "../extraction/extract";

/** Replays canned model replies in order and records every request it receives */
export function fakeChatClient(replies: (string | Error)[]): ChatClient & {
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  return {
    requests,
    chat: (request) => {
      requests.push(request);
      const reply = replies.shift() ?? "{}";
      return reply instanceof Error
        ? Promise.reject(reply)
        : Promise.resolve({ message: { role: "assistant", content: reply } } as ChatResponse);
    },
  };
}
