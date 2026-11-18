/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H. */

import type { CloudCredentials } from "../domain/types";

/** Foreign-object writes require encrypted values, unlike this.config at runtime. */
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
