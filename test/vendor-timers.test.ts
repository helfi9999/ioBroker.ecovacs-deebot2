/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const ecovacsRequire = createRequire(
  join(__dirname, "../../vendor/ecovacs-deebot/package.json"),
);

void test("legacy XMPP clears its ping interval on disconnect", async () => {
  const Protocol = ecovacsRequire("./library/non950type/ecovacsXMPP_XML");

  const protocol = Object.create(Protocol.prototype);
  let connected = false;
  let disconnected = false;

  protocol.user = "test-user";
  protocol.hostname = "localhost";
  protocol.resource = "test-resource";
  protocol.secret = "test-secret";
  protocol.serverAddress = "localhost";
  protocol.serverPort = 5223;
  protocol.pingInterval = null;
  protocol.simpleXmpp = {
    connect: () => {
      connected = true;
    },
    disconnect: () => {
      disconnected = true;
    },
  };

  try {
    protocol.connect();

    assert.equal(connected, true);
    assert.ok(protocol.pingInterval, "Ping interval should be started");

    await protocol.disconnect();

    assert.equal(disconnected, true);
    assert.equal(protocol.pingInterval, null);
  } finally {
    if (protocol.pingInterval) {
      clearInterval(protocol.pingInterval);
    }
  }
});

void test("legacy map timeout completes pending virtual boundaries", async () => {
  const VacBot = ecovacsRequire("./library/vacBot");
  const bot = Object.create(VacBot.prototype);
  let readyCount = 0;
  const commands: string[] = [];

  Object.assign(bot, {
    mapDataObject: [{ mapID: "test-map" }],
    mapDataObjectQueue: [{ type: "GetSpotAreas", mapID: "test-map" }],
    ecovacs: {
      emit: (event: string) => {
        if (event === "MapDataReady") {
          readyCount++;
        }
      },
    },
    run: (command: string) => {
      commands.push(command);
    },
  });

  await bot.handleMapSpotAreasEvent({
    mapID: "test-map",
    mapSpotAreas: {},
  });

  assert.deepEqual(commands, ["GetVirtualBoundaries"]);
  assert.equal(readyCount, 0);
  assert.equal(bot.mapDataObjectQueue.length, 1);

  // Exercise the timeout callback's target without waiting 500 ms.
  bot.handleZeroVirtualBoundariesForMap("test-map");

  assert.equal(bot.mapDataObjectQueue.length, 0);
  assert.equal(readyCount, 1);

  // Verify that the original timer does not emit the event again.
  await new Promise<void>((resolve) => setTimeout(resolve, 600));
  assert.equal(readyCount, 1, "MapDataReady must not fire twice");
});

void test("GetCleanLogs handles rejected cloud requests", () => {
  const vendorSource = readFileSync(
    join(__dirname, "../../vendor/ecovacs-deebot/library/950type/vacBot.js"),
    "utf8",
  );

  const start = vendorSource.indexOf("this.callCleanResultsLogsApi().then(");
  assert.ok(start >= 0, "GetCleanLogs cloud request not found");

  const end = vendorSource.indexOf(
    "this.sendCommand(new VacBotCommand.GetCleanLogs())",
    start,
  );
  assert.ok(end > start, "GetCleanLogs fallback not found");

  assert.match(
    vendorSource.slice(start, end),
    /\.catch\(\(err\) =>/,
    "Cloud request must handle rejected promises",
  );
});
