import { describe, test, expect, afterAll } from "bun:test";
import {
  keychainRead,
  keychainWrite,
  keychainDelete,
} from "../../src/lib/keychain";
import { KeychainError } from "../../src/errors";

// Unique test service name to avoid collisions with real keychain entries
const TEST_SERVICE = `cenv-test-${Date.now()}`;
const TEST_ACCOUNT = "cenv-test-user";

describe("keychain integration", () => {
  afterAll(async () => {
    // Clean up any leftover test entries
    await keychainDelete(TEST_SERVICE, TEST_ACCOUNT).catch(() => {});
  });

  test("write a value then read it back returns the same value", async () => {
    const testValue = "super-secret-test-value-42";

    await keychainWrite(TEST_SERVICE, TEST_ACCOUNT, testValue);
    const result = await keychainRead(TEST_SERVICE, TEST_ACCOUNT);

    expect(result).toBe(testValue);
  });

  test("read a non-existent entry returns null", async () => {
    const result = await keychainRead(
      `cenv-nonexistent-${Date.now()}`,
      TEST_ACCOUNT
    );

    expect(result).toBeNull();
  });

  test("delete entry then read returns null", async () => {
    const testValue = "value-to-delete";

    await keychainWrite(TEST_SERVICE, TEST_ACCOUNT, testValue);
    await keychainDelete(TEST_SERVICE, TEST_ACCOUNT);
    const result = await keychainRead(TEST_SERVICE, TEST_ACCOUNT);

    expect(result).toBeNull();
  });

  test("overwrite an existing value then read returns new value", async () => {
    const originalValue = "original-value";
    const newValue = "overwritten-value";

    await keychainWrite(TEST_SERVICE, TEST_ACCOUNT, originalValue);
    await keychainWrite(TEST_SERVICE, TEST_ACCOUNT, newValue);
    const result = await keychainRead(TEST_SERVICE, TEST_ACCOUNT);

    expect(result).toBe(newValue);
  });

  test("keychainRead without account argument uses process.env.USER and returns string or null", async () => {
    // Write with explicit account matching process.env.USER
    const account = process.env.USER || "unknown";
    const value = "no-account-test-value";

    await keychainWrite(TEST_SERVICE, account, value);

    // Read without specifying account — should default to process.env.USER
    const result = await keychainRead(TEST_SERVICE);

    expect(result).toBe(value);

    // Clean up
    await keychainDelete(TEST_SERVICE, account).catch(() => {});
  });

  test("write and read a large JSON payload (simulating OAuth credentials)", async () => {
    const largePayload = JSON.stringify({
      accessToken: "a".repeat(200),
      refreshToken: "b".repeat(200),
      expiresAt: new Date().toISOString(),
      scopes: ["read", "write", "admin"],
      subscriptionType: "pro",
    });

    await keychainWrite(TEST_SERVICE, TEST_ACCOUNT, largePayload);
    const result = await keychainRead(TEST_SERVICE, TEST_ACCOUNT);

    expect(result).toBe(largePayload);
  });

  test("delete a non-existent entry does not throw", async () => {
    await expect(
      keychainDelete(`cenv-nonexistent-${Date.now()}`, TEST_ACCOUNT)
    ).resolves.toBeUndefined();
  });
});

describe("keychain error handling", () => {
  test("read with empty service name throws KeychainError", async () => {
    await expect(keychainRead("", TEST_ACCOUNT)).rejects.toThrow(KeychainError);
  });

  test("write with empty service name throws KeychainError", async () => {
    await expect(keychainWrite("", TEST_ACCOUNT, "value")).rejects.toThrow(
      KeychainError
    );
  });
});
