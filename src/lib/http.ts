import { z } from "zod";

const uuidSchema = z.string().uuid();

export function validUuid(value: string) {
  return uuidSchema.safeParse(value).success;
}

export async function readJson(request: Request) {
  try { return await request.json() as unknown; }
  catch { return undefined; }
}
