/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H. */

const path = require("node:path");
const assert = require("node:assert/strict");
const { tests } = require("@iobroker/testing");

tests.integration(path.join(__dirname, ".."), {
    controllerVersion: "latest",
    defineAdditionalTests({ suite }) {
        suite("Legacy and modern transport availability", () => {
            it("constructs DEEBOT 900 and T30 transports from the distributed library", () => {
                const { EcoVacsAPI } = require("../vendor/ecovacs-deebot");
                const api = new EcoVacsAPI("compatibility-test", "de", "eu");
                api.uid = "test-user";
                api.user_access_token = "dummy-token";
                const legacy = api.getVacBotObj({ did: "test-legacy", class: "ls1ok3", company: "eco-ng", resource: "atom" });
                const modern = api.getVacBotObj({ did: "test-modern", class: "z4lvk7", company: "eco-ng", resource: "atom" });
                assert.equal(legacy.is950type(), false);
                assert.equal(modern.is950type(), true);
            });
        });
        suite("Startup without credentials", getHarness => {
            it("stays running, reports disconnected and waits for configuration", async () => {
                const harness = getHarness();
                await harness.startAdapterAndWait();
                // The controller's alive state precedes the adapter's ready handler.
                // Wait for the configuration prompt before checking final startup state.
                const deadline = Date.now() + 10000;
                let configuredPrompt = false;
                while (Date.now() < deadline) {
                    const message = await harness.states.getStateAsync("ecovacs-deebot2.0.auth.message");
                    if (message && typeof message.val === "string" && message.val.length > 0) {
                        configuredPrompt = true;
                        break;
                    }
                    assert.equal(harness.isAdapterRunning(), true);
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                assert.equal(configuredPrompt, true, "adapter should request configuration without a cloud login");
                const connection = await harness.states.getStateAsync("ecovacs-deebot2.0.info.connection");
                assert.equal(connection.val, false);
                const auth = await harness.states.getStateAsync("ecovacs-deebot2.0.auth.status");
                assert.equal(auth.val, "loggedOut");
                assert.equal(harness.hasLog(/./, "error"), false);
            });
        });
    },
});
