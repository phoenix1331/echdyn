import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "apps/worker/src/index.ts"],
      reporter: ["text", "html"],
      thresholds: {
        lines: 90,
      },
    },
  },
});
