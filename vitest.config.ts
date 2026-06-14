import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// @/* → ./src/* (tsconfig の paths と一致させる)
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
