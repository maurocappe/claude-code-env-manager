import { KeychainError } from "../errors";

const EXIT_NOT_FOUND = 44;

async function runSecurity(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["security", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

/**
 * Read a value from the macOS Keychain.
 *
 * Uses `security find-generic-password -s <service> -w` which outputs the
 * password directly to stdout (no parsing of stderr required).
 *
 * @returns The stored string, or null if the entry does not exist.
 * @throws KeychainError for any failure other than "not found".
 */
export async function keychainRead(
  service: string,
  account?: string
): Promise<string | null> {
  if (!service) {
    throw new KeychainError("service name must not be empty");
  }

  const effectiveAccount = account ?? (process.env.USER || "unknown");
  const args = [
    "find-generic-password",
    "-s", service,
    "-a", effectiveAccount,
    "-w",
  ];

  const { stdout, stderr, exitCode } = await runSecurity(args);

  if (exitCode === EXIT_NOT_FOUND) {
    return null;
  }

  if (exitCode !== 0) {
    throw new KeychainError(
      `keychainRead failed (exit ${exitCode}): ${stderr.trim() || stdout.trim()}`
    );
  }

  // -w outputs the password value followed by a newline
  return stdout.trimEnd();
}

/**
 * Write a value to the macOS Keychain, creating or updating the entry.
 *
 * Uses `-U` to update an existing entry if one already exists.
 *
 * @throws KeychainError on failure.
 */
export async function keychainWrite(
  service: string,
  account: string,
  data: string
): Promise<void> {
  if (!service) {
    throw new KeychainError("service name must not be empty");
  }

  const args = [
    "add-generic-password",
    "-U",
    "-a", account,
    "-s", service,
    "-w", data,
  ];

  const { stdout, stderr, exitCode } = await runSecurity(args);

  if (exitCode !== 0) {
    throw new KeychainError(
      `keychainWrite failed (exit ${exitCode}): ${stderr.trim() || stdout.trim()}`
    );
  }
}

/**
 * Delete an entry from the macOS Keychain.
 *
 * Silently succeeds if the entry does not exist (exit code 44).
 *
 * @throws KeychainError for any failure other than "not found".
 */
export async function keychainDelete(
  service: string,
  account: string
): Promise<void> {
  const args = [
    "delete-generic-password",
    "-a", account,
    "-s", service,
  ];

  const { stdout, stderr, exitCode } = await runSecurity(args);

  if (exitCode === EXIT_NOT_FOUND || exitCode === 0) {
    return;
  }

  throw new KeychainError(
    `keychainDelete failed (exit ${exitCode}): ${stderr.trim() || stdout.trim()}`
  );
}
