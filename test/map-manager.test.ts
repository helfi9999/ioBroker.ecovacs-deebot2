/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { EventBus } from "../src/events/EventBus";
import { MapManager } from "../src/map/MapManager";

void test("Ecovacs map objects become normalized rooms and positions", () => {
  const manager = new MapManager(new EventBus());
  const updates = manager.normalizeEcovacs("luna-id", {
    currentMapId: "map-1",
    robotPosition: { x: 12, y: 34 },
    dockPosition: { x: 10, y: 30 },
    currentRoomId: "0",
    currentRoomName: "A",
    maps: [
      {
        mapID: "map-1",
        mapSpotAreas: [
          {
            mapSpotAreaID: "2",
            mapSpotAreaName: "Kinderzimmer",
            mapSpotAreaBoundaries: "0,0;100,0;100,100;0,100",
          },
        ],
      },
    ],
  });

  assert.equal(updates.length, 1);
  const update = updates[0];
  assert.equal(update.mapId, "map-1");
  assert.deepEqual(update.robotPosition, { x: 12, y: 34 });
  assert.equal(update.currentRoomId, "0");
  assert.equal(update.currentRoomName, "A");
  assert.deepEqual(update.rooms?.[0], {
    id: "2",
    ecovacsName: "Kinderzimmer",
    displayName: "Kinderzimmer",
    polygon: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    center: { x: 50, y: 50 },
    groupId: null,
  });
});

void test("multi-floor maps retain their identity and active-floor marker", () => {
  const manager = new MapManager(new EventBus());
  const updates = manager.normalizeEcovacs("t30-id", {
    currentMapId: "ground",
    currentMapName: "Erdgeschoss",
    currentMapIndex: 0,
    multiMapEnabled: true,
    robotPosition: null,
    dockPosition: null,
    maps: [
      {
        mapID: "ground",
        mapIndex: 0,
        mapName: "Erdgeschoss",
        mapIsCurrentMap: true,
        mapIsBuilt: true,
        mapSpotAreas: [],
      },
      {
        mapID: "upper",
        mapIndex: 1,
        mapName: "Obergeschoss",
        mapIsCurrentMap: false,
        mapIsBuilt: true,
        mapSpotAreas: [],
      },
    ],
  });

  assert.equal(updates.length, 2);
  assert.deepEqual(
    updates.map((update) => ({
      id: update.mapId,
      name: update.mapName,
      index: update.mapIndex,
      active: update.isCurrentMap,
    })),
    [
      { id: "ground", name: "Erdgeschoss", index: 0, active: true },
      { id: "upper", name: "Obergeschoss", index: 1, active: false },
    ],
  );
  assert.equal(
    updates.every((update) => update.multiMapEnabled),
    true,
  );
});

void test("live current map ID overrides stale cached floor markers", () => {
  const manager = new MapManager(new EventBus());
  const updates = manager.normalizeEcovacs("t30-id", {
    currentMapId: "upper",
    robotPosition: { x: 10, y: 20 },
    dockPosition: null,
    maps: [
      { mapID: "ground", mapIsCurrentMap: true, mapSpotAreas: [] },
      { mapID: "upper", mapIsCurrentMap: false, mapSpotAreas: [] },
    ],
  });
  assert.deepEqual(
    updates.map((update) => ({
      id: update.mapId,
      active: update.isCurrentMap,
      position: update.robotPosition,
    })),
    [
      { id: "ground", active: false, position: null },
      { id: "upper", active: true, position: { x: 10, y: 20 } },
    ],
  );
});
