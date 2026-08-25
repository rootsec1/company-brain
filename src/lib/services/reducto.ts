import Reducto from "reductoai";
import { requireSecret, secrets } from "@/lib/config";

let client: Reducto | undefined;

export function getReductoClient() {
  client ??= new Reducto({ apiKey: requireSecret("reductoApiKey") });
  return client;
}

export async function validateReducto() {
  if (!secrets.reductoApiKey) return { healthy: false, detail: "REDUCTO_API_KEY is missing" };
  try {
    await getReductoClient().job.getAll({ limit: 1, exclude_configs: true });
    return { healthy: true, detail: "SDK authenticated" };
  } catch (error) {
    return { healthy: false, detail: error instanceof Error ? error.message : "Reducto validation failed" };
  }
}
