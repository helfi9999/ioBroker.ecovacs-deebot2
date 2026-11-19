/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  EcovacsAuthApiError,
  ModernEcovacsAuthenticator,
  createStableDeviceId,
} from "../src/ecovacs/EcovacsCloudSession";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

void test("stable device ID is deterministic and eight characters long", () => {
  assert.equal(
    createStableDeviceId("adapter:user"),
    createStableDeviceId("adapter:user"),
  );
  assert.match(createStableDeviceId("adapter:user"), /^[A-F0-9]{8}$/);
});

void test("modern authenticator requests and completes e-mail device verification", async () => {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const encodedKey = publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64");
  const calls: URL[] = [];
  // The fetch mock must return a Promise<Response> like the real fetch API.
  // eslint-disable-next-line @typescript-eslint/require-await
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    calls.push(url);
    if (url.pathname.endsWith("/user/login")) {
      return jsonResponse({ code: "1013", msg: "verification required" });
    }
    if (url.pathname.endsWith("/common/getConfig")) {
      return jsonResponse({
        code: "0000",
        data: [
          {
            key: "PUBLIC.KEY.CONFIG",
            value: JSON.stringify({ publicKey: encodedKey }),
          },
        ],
      });
    }
    if (url.pathname.endsWith("/user/sendEmailVerifyCode")) {
      assert.notEqual(url.searchParams.get("encryptEmail"), "user@example.org");
      return jsonResponse({ code: "0000", data: {} });
    }
    if (url.pathname.endsWith("/user/verifyDevice")) {
      assert.equal(url.searchParams.get("verifyCode"), "123456");
      return jsonResponse({
        code: "0000",
        data: { uid: "user-id", accessToken: "access-token" },
      });
    }
    if (url.pathname === "/v1/global/auth/getAuthCode") {
      return jsonResponse({ code: "0000", data: { authCode: "auth-code" } });
    }
    if (url.pathname === "/api/users/user.do") {
      return jsonResponse({
        result: "ok",
        userId: "short-user-id",
        token: "session-token",
      });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const auth = new ModernEcovacsAuthenticator(
    { deviceId: "A1B2C3D4", country: "de", continent: "eu" },
    fetcher,
  );

  await assert.rejects(
    auth.login("user@example.org", "secret"),
    EcovacsAuthApiError,
  );
  await auth.requestVerificationCode("user@example.org");
  const credentials = await auth.verifyDevice("user@example.org", "123456");

  assert.deepEqual(credentials, {
    userId: "short-user-id",
    token: "session-token",
  });
  assert.equal(
    calls.filter((url) => url.pathname.endsWith("/common/getConfig")).length,
    1,
  );
  assert.ok(
    calls.every(
      (url) =>
        url.searchParams.get("authSign") ||
        url.pathname === "/api/users/user.do",
    ),
  );
});
