/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { EventBus } from "../src/events/EventBus";
import { resolveEcovacsModelName, VacBotTransport } from "../src/ecovacs/EcovacsCloudSession";
import { StateProjector, toDeviceObjectId } from "../src/ioBroker/StateProjector";

test("robot names become readable and valid ioBroker object IDs", () => {
  assert.equal(toDeviceObjectId("Sky"), "Sky");
  assert.equal(toDeviceObjectId("Luna"), "Luna");
  assert.equal(toDeviceObjectId("Sauger Küche"), "Sauger_Kuche");
  assert.equal(toDeviceObjectId("  Obergeschoss / Bad  "), "Obergeschoss_Bad");
  assert.equal(toDeviceObjectId("***"), "Robot");
});

test("installed mops and generic station washing cannot turn vacuuming into mopping", async () => {
  let mode: unknown = 1;
  const adapter = { getStateAsync: async () => ({ val: mode }) };
  const projector = new StateProjector(adapter as never, new EventBus());
  const internal = projector as unknown as {
    robotObjectIds: Map<string, string>;
    moppingActive: Map<string, boolean>;
    sequentialCleaningPhase: Map<string, string>;
    cleaningActivity(id: string): Promise<string>;
    handleRobotStatus(id: string, status: string, source: string): Promise<void>;
    updateRobotStatus(id: string, status: string): Promise<void>;
  };
  internal.robotObjectIds.set("robot", "Chepetto");
  internal.moppingActive.set("robot", true);
  const reports: string[] = [];
  internal.updateRobotStatus = async (_id, status) => { reports.push(status); };
  assert.equal(await internal.cleaningActivity("robot"), "Saugt");
  await internal.handleRobotStatus("robot", "washing", "station");
  assert.deepEqual(reports, []);
  assert.equal(internal.sequentialCleaningPhase.has("robot"), false);
  mode = undefined;
  assert.equal(await internal.cleaningActivity("robot"), "Reinigt");
});

test("ending a run clears marked rooms and the room command selection", async () => {
  const states = new Map<string, unknown>([
    ["devices.Sky.rooms.3.selected", true],
    ["devices.Sky.control.roomIds", '["3"]'],
  ]);
  const adapter = {
    getStateAsync: async (id: string) => ({ val: states.get(id) }),
    setStateAsync: async (id: string, value: unknown) => { states.set(id, value); },
  };
  const projector = new StateProjector(adapter as never, new EventBus());
  const internal = projector as unknown as {
    robotObjectIds: Map<string, string>;
    latestSnapshots: Map<string, unknown>;
    clearSelectedRooms(id: string): Promise<void>;
    writeSnapshot(id: string, snapshot: unknown): Promise<void>;
  };
  internal.robotObjectIds.set("robot", "Sky");
  internal.latestSnapshots.set("robot", { rooms: [{ id: "3" }] });
  internal.writeSnapshot = async () => {};
  await internal.clearSelectedRooms("robot");
  assert.equal(states.get("devices.Sky.rooms.3.selected"), false);
  assert.equal(states.get("devices.Sky.control.roomIds"), "[]");
});

test("starting a room directly marks it on the map and updates roomIds", async () => {
  const states = new Map<string, unknown>();
  const adapter = {
    namespace: "ecovacs-deebot2.0",
    getStateAsync: async (id: string) => ({ val: states.get(id) }),
    setStateAsync: async (id: string, value: unknown) => { states.set(id, value); },
  };
  const projector = new StateProjector(adapter as never, new EventBus());
  const internal = projector as unknown as {
    robotObjectIds: Map<string, string>;
    latestSnapshots: Map<string, unknown>;
    handleStateChange(id: string, state: unknown): Promise<void>;
    writeSnapshot(id: string, snapshot: unknown): Promise<void>;
    executeCommand(id: string, objectId: string, command: unknown): Promise<boolean>;
  };
  internal.robotObjectIds.set("robot", "Sky");
  internal.latestSnapshots.set("robot", { mapId: "ground", isCurrentMap: true, rooms: [{ id: "3" }, { id: "4" }] });
  let redraw = false;
  let command: unknown;
  internal.writeSnapshot = async () => { redraw = true; };
  internal.executeCommand = async (_id, _objectId, value) => { command = value; return true; };
  await internal.handleStateChange("ecovacs-deebot2.0.devices.Sky.rooms.3.clean", { val: true, ack: false });
  assert.equal(states.get("devices.Sky.rooms.3.selected"), true);
  assert.equal(states.get("devices.Sky.rooms.4.selected"), false);
  assert.equal(states.get("devices.Sky.control.roomIds"), '["3"]');
  assert.equal(redraw, true);
  assert.deepEqual(command, { type: "cleanRooms", roomIds: ["3"], repetitions: 1 });
});

test("T30 room cleaning sends the modern spot-area command with the selected ID", async () => {
  const commands: Array<[string, ...unknown[]]> = [];
  const robot = {
    on() {},
    run(command: string, ...args: unknown[]) { commands.push([command, ...args]); },
    is950type: () => true,
    hasSpotAreaCleaningMode: () => true,
  };
  const transport = new VacBotTransport(robot as never);
  transport.execute({ type: "cleanRooms", roomIds: ["3"], repetitions: 1 });
  assert.deepEqual(commands[0], ["SpotArea_V2", "3", 1]);
  await transport.disconnect();
});

test("a malformed legacy XML message cannot crash the adapter", async () => {
  const protocol = {
    handleMessage(_topic: string, payload: unknown) {
      if (payload === "bad") throw new Error("missing root element");
      if (payload === "other") throw new Error("unrelated failure");
    },
  };
  const robot = { on() {}, run() {}, is950type: () => false, ecovacs: protocol };
  const transport = new VacBotTransport(robot as never);
  assert.doesNotThrow(() => protocol.handleMessage("topic", ""));
  assert.doesNotThrow(() => protocol.handleMessage("topic", "bad"));
  assert.throws(() => protocol.handleMessage("topic", "other"), /unrelated failure/);
  await transport.disconnect();
});

test("a room command starts tracking before the first cleaning report", async () => {
  const states = new Map<string, unknown>();
  const adapter = { setStateAsync: async (id: string, value: unknown) => { states.set(id, value); } };
  const projector = new StateProjector(adapter as never, new EventBus());
  const internal = projector as unknown as {
    executeCommand(id: string, objectId: string, command: { type: "cleanRooms"; roomIds: string[]; repetitions: 1 }): Promise<boolean>;
    startLocalCleaningRun(id: string, status: string): Promise<void>;
  };
  let started = "";
  internal.startLocalCleaningRun = async (_id, status) => { started = status; };
  assert.equal(await internal.executeCommand("robot", "Sky", { type: "cleanRooms", roomIds: ["3"], repetitions: 1 }), true);
  assert.equal(started, "spot_area");
  assert.deepEqual(JSON.parse(String(states.get("devices.Sky.control.lastCommand"))), { type: "cleanRooms", roomIds: ["3"], repetitions: 1 });
});

test("the history records each room crossed on the way back to the station", async () => {
  const states = new Map<string, unknown>([["devices.Sky.history.events", "[]"], ["devices.Sky.history.maxEntries", 100]]);
  const adapter = {
    getStateAsync: async (id: string) => ({ val: states.get(id) }),
    setStateAsync: async (id: string, value: unknown) => { states.set(id, value); },
  };
  const projector = new StateProjector(adapter as never, new EventBus());
  const internal = projector as unknown as {
    robotObjectIds: Map<string, string>;
    robotReady: Map<string, Promise<void>>;
    updateRobotStatus(id: string, status: string): Promise<void>;
  };
  internal.robotObjectIds.set("robot", "Sky");
  internal.robotReady.set("robot", Promise.resolve());
  await internal.updateRobotStatus("robot", "Durchquert Flur");
  await internal.updateRobotStatus("robot", "Durchquert Esszimmer");
  await internal.updateRobotStatus("robot", "Durchquert Wohnzimmer");
  const events = JSON.parse(String(states.get("devices.Sky.history.events"))) as Array<{ event: string }>;
  assert.deepEqual(events.map(item => item.event), ["Durchquert Flur", "Durchquert Esszimmer", "Durchquert Wohnzimmer"]);
});

test("history records arrival and cleaning within the same room", async () => {
  const states = new Map<string, unknown>([["devices.Sky.history.events", "[]"], ["devices.Sky.history.maxEntries", 100]]);
  const adapter = {
    getStateAsync: async (id: string) => ({ val: states.get(id) }),
    setStateAsync: async (id: string, value: unknown) => { states.set(id, value); },
  };
  const projector = new StateProjector(adapter as never, new EventBus());
  const internal = projector as unknown as {
    robotObjectIds: Map<string, string>;
    robotReady: Map<string, Promise<void>>;
    readableStatus(id: string, status: string): Promise<string>;
    updateRobotStatus(id: string, status: string): Promise<void>;
  };
  internal.robotObjectIds.set("robot", "Sky");
  internal.robotReady.set("robot", Promise.resolve());
  let arriving = true;
  internal.readableStatus = async () => arriving ? "Fährt zu Küche" : "Saugt: Küche";
  await internal.updateRobotStatus("robot", "spot_area");
  arriving = false;
  await internal.updateRobotStatus("robot", "spot_area");
  const events = JSON.parse(String(states.get("devices.Sky.history.events"))) as Array<{ event: string }>;
  assert.deepEqual(events.map(item => item.event), ["Fährt zu Küche", "Saugt: Küche"]);
});

test("vacuum-first travel cannot report the whole job as finished", async () => {
  const writes: unknown[] = [];
  const adapter = { setStateAsync: async (...args: unknown[]) => { writes.push(args); } };
  const projector = new StateProjector(adapter as never, new EventBus());
  const internal = projector as unknown as {
    robotObjectIds: Map<string, string>;
    robotReady: Map<string, Promise<void>>;
    cleaningActive: Set<string>;
    sequentialCleaningPhase: Map<string, "vacuum" | "mop">;
    updateRobotStatus(id: string, status: string): Promise<void>;
  };
  internal.robotObjectIds.set("robot", "Sky");
  internal.robotReady.set("robot", Promise.resolve());
  internal.cleaningActive.add("robot");
  internal.sequentialCleaningPhase.set("robot", "vacuum");
  await internal.updateRobotStatus("robot", "idle");
  assert.deepEqual(writes, []);
});

test("room settings use the floor selected for display", () => {
  const projector = new StateProjector({} as never, new EventBus());
  const internal = projector as unknown as {
    latestSnapshots: Map<string, unknown>;
    floorSnapshots: Map<string, Map<string, unknown>>;
    selectedFloorIds: Map<string, string>;
    displayedSnapshot(id: string): { mapId: string } | undefined;
  };
  internal.latestSnapshots.set("robot", { mapId: "ground" });
  internal.floorSnapshots.set("robot", new Map([["upper", { mapId: "upper" }]]));
  internal.selectedFloorIds.set("robot", "upper");
  assert.equal(internal.displayedSnapshot("robot")?.mapId, "upper");
  internal.selectedFloorIds.set("robot", "");
  assert.equal(internal.displayedSnapshot("robot")?.mapId, "ground");
});

test("the displayed floor map keeps the custom area draggable", async () => {
  const writes = new Map<string, unknown>();
  const adapter = {
    namespace: "ecovacs-deebot2.0",
    config: {},
    getStateAsync: async () => null,
    setStateAsync: async (id: string, value: unknown) => { writes.set(id, value); },
    extendObjectAsync: async () => {},
  };
  const projector = new StateProjector(adapter as never, new EventBus());
  const internal = projector as unknown as {
    robotObjectIds: Map<string, string>;
    floorSnapshots: Map<string, Map<string, unknown>>;
    customAreas: Map<string, { active: boolean; values: string }>;
    writeSnapshot(id: string, snapshot: unknown, latest: boolean): Promise<void>;
  };
  internal.robotObjectIds.set("robot", "Sky");
  const snapshot = {
    robotId: "robot", mapId: "ground", revision: 1, isCurrentMap: true,
    rooms: [{ id: "1", ecovacsName: "A", displayName: "Zimmer", groupId: null,
      polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], center: { x: 50, y: 50 } }],
    robotPosition: null, dockPosition: null, svg: "", updatedAt: new Date().toISOString(),
  };
  internal.floorSnapshots.set("robot", new Map([["ground", snapshot]]));
  internal.customAreas.set("robot", { active: true, values: "10,20,80,90" });
  await internal.writeSnapshot("robot", snapshot, false);
  const html = String(writes.get("devices.Sky.map.floors.ground.html"));
  assert.match(html, /class="custom-area"/);
  assert.match(html, /data-state-id="ecovacs-deebot2\.0\.devices\.Sky\.customArea\.values"/);
});

test("Ecovacs device classes resolve to readable model names", () => {
  assert.equal(resolveEcovacsModelName("ls1ok3", "DN5G"), "DEEBOT 900 Series");
  assert.equal(resolveEcovacsModelName("z4lvk7", "T30_MAX_INT_BLACK"), "DEEBOT T30 OMNI");
  assert.equal(resolveEcovacsModelName("not-listed", "MODEL-CODE"), "MODEL-CODE");
});

test("charging remains authoritative over periodic idle reports", () => {
  const projector = new StateProjector({} as never, new EventBus());
  const effective = (projector as unknown as {
    effectiveRuntimeStatus(runtime: { clean: string; charge: string }, source: "clean", cleaning: boolean): string;
  }).effectiveRuntimeStatus({ clean: "idle", charge: "charging" }, "clean", false);
  assert.equal(effective, "charging");
});

test("a real active cleaning session may still finish", () => {
  const projector = new StateProjector({} as never, new EventBus());
  const effective = (projector as unknown as {
    effectiveRuntimeStatus(runtime: { clean: string; charge: string }, source: "clean", cleaning: boolean): string;
  }).effectiveRuntimeStatus({ clean: "finished", charge: "charging" }, "clean", true);
  assert.equal(effective, "finished");
});

test("an active station drying event overrides charging", () => {
  const projector = new StateProjector({} as never, new EventBus());
  const effective = (projector as unknown as {
    effectiveRuntimeStatus(runtime: { clean: string; charge: string; station: string }, source: "station", cleaning: boolean): string;
  }).effectiveRuntimeStatus({ clean: "idle", charge: "charging", station: "drying" }, "station", false);
  assert.equal(effective, "drying");
});

test("station drying remains authoritative when charging is polled again", () => {
  const projector = new StateProjector({} as never, new EventBus());
  const effective = (projector as unknown as {
    effectiveRuntimeStatus(runtime: { clean: string; charge: string; station: string }, source: "charge", cleaning: boolean): string;
  }).effectiveRuntimeStatus({ clean: "idle", charge: "charging", station: "drying" }, "charge", false);
  assert.equal(effective, "drying");
});

test("room traversal and auto-empty reports have stable internal classes", () => {
  const projector = new StateProjector({} as never, new EventBus());
  const classify = (projector as unknown as { classifyStatus(status: string): string }).classifyStatus.bind(projector);
  assert.equal(classify("Durchquert Flur"), "traversing");
  assert.equal(classify("Fährt zu Badezimmer"), "navigating");
  assert.equal(classify("auto_empty"), "emptying");
  assert.equal(classify("Saugt: Badezimmer"), "cleaning");
});


test("upstream fire-and-forget MQTT disconnect rejection is handled and closes the socket", async () => {
  const warnings: string[] = [];
  const receiver: unknown[] = [];
  const forced: boolean[] = [];
  const protocol = {
    client: { end(force?: boolean) { forced.push(force === true); } },
    async disconnect() { receiver.push(this); throw false; },
  };
  const robot = { on() {}, run() {}, ecovacs: protocol };
  const transport = new VacBotTransport(robot as never, message => warnings.push(message));
  // Reproduce upstream's internal call: the caller does not await or catch it.
  protocol.disconnect();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(receiver, [protocol]);
  assert.deepEqual(forced, [true]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unsubscribe failed.*false/);
  await transport.disconnect();
});

test("protocol disconnect preserves successful results and reports non-boolean failures", async () => {
  const warnings: string[] = [];
  let fail = false;
  let closes = 0;
  const protocol = {
    client: { end() { closes++; } },
    async disconnect() { if (fail) throw new Error("socket closed"); return true; },
  };
  const transport = new VacBotTransport({ on() {}, run() {}, ecovacs: protocol } as never, message => warnings.push(message));
  assert.equal(await protocol.disconnect(), true);
  assert.equal(closes, 0);
  assert.equal(warnings.length, 0);
  fail = true;
  await protocol.disconnect();
  assert.equal(closes, 1);
  assert.match(warnings[0], /socket closed/);
  await transport.disconnect();
});
