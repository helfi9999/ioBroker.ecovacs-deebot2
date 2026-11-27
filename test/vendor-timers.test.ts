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

  const timerHandle = { id: "xmpp-test-timer" };
  let intervalStarted = false;
  let intervalCleared = false;

  protocol.vacBot = {
    timerService: {
      setInterval: (callback: () => void, delay: number) => {
        assert.equal(typeof callback, "function");
        assert.equal(delay, 30000);
        intervalStarted = true;
        return timerHandle;
      },
      clearInterval: (timer: unknown) => {
        assert.equal(timer, timerHandle);
        intervalCleared = true;
      },
    },
  };

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
    assert.equal(intervalStarted, true);
    assert.equal(protocol.pingInterval, timerHandle);

    await protocol.disconnect();

    assert.equal(disconnected, true);
    assert.equal(intervalCleared, true);
    assert.equal(protocol.pingInterval, null);
  } finally {
    if (protocol.pingInterval) {
      protocol.vacBot.timerService.clearInterval(protocol.pingInterval);
    }
  }
});

void test("legacy map timeout completes pending virtual boundaries", async () => {
  const VacBot = ecovacsRequire("./library/vacBot");
  const bot = Object.create(VacBot.prototype);
  let readyCount = 0;
  const commands: string[] = [];
  const scheduled = new Map<object, () => void>();

  const timerService = {
    setTimeout: (callback: () => void, delay: number) => {
      assert.equal(delay, 500);
      const handle = {};
      scheduled.set(handle, callback);
      return handle;
    },
    clearTimeout: (handle: object) => {
      scheduled.delete(handle);
    },
  };

  Object.assign(bot, {
    mapDataObject: [{ mapID: "test-map" }],
    mapDataObjectQueue: [{ type: "GetSpotAreas", mapID: "test-map" }],
    mapTimeouts: new Set(),
    timerService,
    ecovacs: {
      emit: (event: string) => {
        if (event === "MapDataReady") {
          readyCount++;
        }
      },
      disconnect: async () => {},
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
  assert.equal(scheduled.size, 1);
  assert.equal(bot.mapTimeouts.size, 1);

  const callback = [...scheduled.values()][0];
  callback();

  assert.equal(bot.mapDataObjectQueue.length, 0);
  assert.equal(readyCount, 1);
  assert.equal(bot.mapTimeouts.size, 0);

  await bot.disconnectAsync();
  assert.equal(scheduled.size, 1);
  assert.equal(readyCount, 1);
});

void test("legacy map timeout is cancelled on disconnect", async () => {
  const VacBot = ecovacsRequire("./library/vacBot");
  const bot = Object.create(VacBot.prototype);
  const scheduled = new Map<object, () => void>();
  let disconnected = false;
  let readyCount = 0;

  Object.assign(bot, {
    mapDataObject: [{ mapID: "test-map" }],
    mapDataObjectQueue: [{ type: "GetSpotAreas", mapID: "test-map" }],
    mapTimeouts: new Set(),
    timerService: {
      setTimeout: (callback: () => void) => {
        const handle = {};
        scheduled.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle: object) => {
        scheduled.delete(handle);
      },
    },
    ecovacs: {
      emit: (event: string) => {
        if (event === "MapDataReady") {
          readyCount++;
        }
      },
      disconnect: () => {
        disconnected = true;
        return Promise.resolve();
      },
    },
    run: () => {},
  });

  await bot.handleMapSpotAreasEvent({
    mapID: "test-map",
    mapSpotAreas: {},
  });

  assert.equal(scheduled.size, 1);

  // Simulate a callback already queued before the timer was cancelled.
  const delayedCallback = [...scheduled.values()][0];

  await bot.disconnectAsync();

  assert.equal(disconnected, true);
  assert.equal(scheduled.size, 0);
  assert.equal(bot.mapTimeouts.size, 0);
  assert.equal(readyCount, 0);

  delayedCallback();

  assert.equal(readyCount, 0);
  assert.equal(bot.mapDataObjectQueue.length, 1);
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
