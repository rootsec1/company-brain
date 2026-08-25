import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  ssr: { noExternal: ["zod"] },
  test: { environment: "node", include: ["tests/unit/**/*.test.ts"], coverage: { reporter: ["text", "json"] } }
});
