/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H. */

import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import test from "node:test";
import { storeSessionCredentials } from "../src/auth/StoredSession";

// Controller-compatible storage formats; no live ioBroker database is needed.
const legacyTransform = (secret: string, value: string): string => [...value]
  .map((character, index) => String.fromCharCode(character.charCodeAt(0) ^ secret.charCodeAt(index % secret.length))).join("");
const tools = {
  encrypt(secret: string, value: string): string {
    if (secret.length !== 48) return legacyTransform(secret, value);
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-192-cbc", Buffer.from(secret, "hex"), iv);
    const payload = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `$/aes-192-cbc:${iv.toString("hex")}:${payload.toString("hex")}`;
  },
  decrypt(secret: string, value: string): string {
    if (!value.startsWith("$/aes-192-cbc:")) return legacyTransform(secret, value);
    const [, iv, payload] = value.split(":");
    const decipher = createDecipheriv("aes-192-cbc", Buffer.from(secret, "hex"), Buffer.from(iv, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(payload, "hex")), decipher.final()]).toString("utf8");
  },
};

for (const [format, secret] of [["AES", "0123456789abcdef".repeat(3)], ["legacy", "legacy-system-secret"]]) {
  test(`session token survives a save and controller restart (${format})`, () => {
    const storedPassword = tools.encrypt(secret, "test-password");
    const original = { password: storedPassword, authToken: "old-token", verificationCode: "old-code", roomNames: [{ name: "Kitchen" }] };
    const credentials = { userId: "test-user", token: "new-session-token" };
    const stored = storeSessionCredentials(original, credentials, value => tools.encrypt(secret, value));
    const reloaded = JSON.parse(JSON.stringify(stored));
    assert.notEqual(reloaded.authToken, credentials.token);
    assert.equal(tools.decrypt(secret, reloaded.authToken), credentials.token);
    assert.equal(reloaded.password, storedPassword);
    assert.equal(tools.decrypt(secret, reloaded.password), "test-password");
    assert.equal(reloaded.authUserId, credentials.userId);
    assert.equal(reloaded.verificationCode, "");
    assert.deepEqual(reloaded.roomNames, original.roomNames);
    assert.equal(original.authToken, "old-token");
  });
}
