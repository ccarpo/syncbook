import { describe, expect, it } from "vitest";
import { checkPassword, hashPassword, tokenFor, userIdFromToken } from "../src/auth.js";
describe("authentication primitives", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(checkPassword("wrong password", hash)).resolves.toBe(false);
    await expect(checkPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });
  it("rejects absent and invalid tokens", () => {
    expect(userIdFromToken(undefined)).toBeNull();
    expect(userIdFromToken("not-a-token")).toBeNull();
    const token = tokenFor("user-1");
    expect(userIdFromToken(token)).toBe("user-1");
  });
});
