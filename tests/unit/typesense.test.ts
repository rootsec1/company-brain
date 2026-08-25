import { describe, expect, it } from "vitest";
import { assertTypesenseCollectionCompatible } from "@/lib/services/typesense";

describe("Typesense bootstrap compatibility", () => {
  it("fails clearly instead of serving vectors with the wrong dimension", () => {
    expect(() => assertTypesenseCollectionCompatible({ fields: [{ name: "embedding", num_dim: 1024 }] })).not.toThrow();
    expect(() => assertTypesenseCollectionCompatible({ fields: [{ name: "embedding", num_dim: 768 }] })).toThrow("Reindex");
  });
});
