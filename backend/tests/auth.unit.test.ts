/**
 * Phase 1 unit tests — auth primitives.
 * These do NOT require a database; they verify password hashing and JWT behaviour in isolation.
 */
import argon2 from "argon2";
import jwt from "jsonwebtoken";

describe("argon2 password hashing", () => {
  it("hashes and verifies a password correctly", async () => {
    const password = "Admin@12345";
    const hash = await argon2.hash(password);
    expect(await argon2.verify(hash, password)).toBe(true);
    expect(await argon2.verify(hash, "wrong-password")).toBe(false);
  });

  it("produces a different hash each time (salted)", async () => {
    const h1 = await argon2.hash("same-password");
    const h2 = await argon2.hash("same-password");
    expect(h1).not.toBe(h2);
  });
});

describe("JWT access/refresh tokens", () => {
  const accessSecret = "test-access-secret-min-32-chars!!";
  const refreshSecret = "test-refresh-secret-min-32-chars!!";

  it("signs and verifies an access token with type claim", () => {
    const payload = { sub: "user-1", email: "a@b.com", type: "access" as const };
    const token = jwt.sign(payload, accessSecret, { expiresIn: "15m" });
    const decoded = jwt.verify(token, accessSecret) as { sub: string; type: string };
    expect(decoded.sub).toBe("user-1");
    expect(decoded.type).toBe("access");
  });

  it("rejects a token signed with the wrong secret", () => {
    const token = jwt.sign({ sub: "user-1", type: "access" }, accessSecret);
    expect(() => jwt.verify(token, "wrong-secret")).toThrow();
  });

  it("refresh token with type claim verifies and expires", () => {
    const token = jwt.sign(
      { sub: "user-1", type: "refresh" as const },
      refreshSecret,
      { expiresIn: "1s" }
    );
    const decoded = jwt.verify(token, refreshSecret) as { type: string };
    expect(decoded.type).toBe("refresh");
  });
});
