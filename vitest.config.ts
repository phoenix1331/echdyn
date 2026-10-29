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
    globalSetup: ["./vitest.global-setup.ts"],
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "apps/worker/src/index.ts", "packages/*/src/bin/**"],
      reporter: ["text", "html"],
      thresholds: {
        lines: 90,
      },
    },
  },
});
