/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H. */

import type { CloudCredentials } from "../domain/types";

/**
 * Prepares session credentials for storage in the adapter's native configuration.
 * Foreign-object writes require encrypted values, unlike this.config at runtime.
 *
 * @param storedNative - Existing native configuration values to preserve.
 * @param credentials - Authenticated user ID and session token.
 * @param encrypt - Encrypts the session token before it is stored.
 * @returns Updated native configuration with encrypted credentials.
 */
export function storeSessionCredentials(
  storedNative: Record<string, unknown>,
  credentials: CloudCredentials,
  encrypt: (value: string) => string,
): Record<string, unknown> {
  return {
    ...storedNative,
    authUserId: credentials.userId,
    authToken: encrypt(credentials.token),
    verificationCode: "",
  };
}
