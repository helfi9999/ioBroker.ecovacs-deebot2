/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager, VerificationRequiredError } from "../src/auth/SessionManager";
import { DeviceManager } from "../src/core/DeviceManager";
import type { CloudSession, CloudSessionFactory, RobotCommand, RobotDescriptor, RobotTransport } from "../src/domain/types";
import { EventBus } from "../src/events/EventBus";
import { RoomManager } from "../src/rooms/RoomManager";

const logger = { debug() {}, info() {}, warn() {}, error() {} };

class FakeTransport implements RobotTransport {
  connected = false;
  mapRequests = 0;
  commands: RobotCommand[] = [];
  async connect(): Promise<void> { this.connected = true; }
  async disconnect(): Promise<void> { this.connected = false; }
  requestMap(): void { this.mapRequests += 1; }
  execute(command: RobotCommand): void { this.commands.push(command); }
  deviceImageUrl(): string { return "https://api-app.example/device-image"; }
}

class FakeSession implements CloudSession {
  transports = new Map<string, FakeTransport>();
  async login(_account?: string, _password?: string, _code?: string, _credentials?: import("../src/domain/types").CloudCredentials): Promise<void> {}
  async refreshAuthentication(_account: string, _password: string): Promise<void> {}
  async listRobots(): Promise<RobotDescriptor[]> { return []; }
  createTransport(robot: RobotDescriptor): RobotTransport {
    const transport = new FakeTransport();
    this.transports.set(robot.id, transport);
    return transport;
  }
  async close(): Promise<void> {}
}

test("verification code bypasses an expired cached token", async () => {
  let cached: unknown = "unseen";
  let renewed = false;
  const session = new FakeSession();
  session.login = async (_account, _password, _code, credentials) => { cached = credentials; };
  session.refreshAuthentication = async () => { renewed = true; };
  const manager = new SessionManager({ create: () => session }, logger);
  const config = { username: "person@example.org", password: "secret", country: "de", continent: "eu",
    deviceId: "A1B2C3D4", authUserId: "old-user", authToken: "expired", verificationCode: "123456" };
  await manager.login(config);
  assert.equal(cached, undefined);
  await manager.refreshAuthentication(config);
  assert.equal(renewed, true);
});

const robot = (id: string): RobotDescriptor => ({ id, name: id, model: "test", deviceClass: "test", raw: {} });

test("DeviceManager adds, retains and removes robots independently", async () => {
  const cloud = new FakeSession();
  const events = new EventBus();
  const manager = new DeviceManager(cloud, events);
  assert.deepEqual(await manager.reconcile([robot("sky"), robot("luna")]), {
    added: ["sky", "luna"], removed: [], retained: [],
  });
  assert.equal(manager.size, 2);
  assert.equal(cloud.transports.get("sky")?.connected, true);
  assert.equal(cloud.transports.get("luna")?.mapRequests, 1);

  assert.deepEqual(await manager.reconcile([robot("luna")]), {
    added: [], removed: ["sky"], retained: ["luna"],
  });
  assert.equal(manager.size, 1);
  assert.equal(cloud.transports.get("sky")?.connected, false);
  assert.equal(cloud.transports.get("luna")?.mapRequests, 2);
});

test("DeviceManager sends room-cleaning and control commands to the selected robot", async () => {
  const cloud = new FakeSession();
  const manager = new DeviceManager(cloud, new EventBus());
  await manager.reconcile([robot("sky"), robot("luna")]);
  manager.execute("sky", { type: "cleanRooms", roomIds: ["1", "4"], repetitions: 2 });
  manager.execute("sky", { type: "cleanCustomArea", coordinates: "10,20,80,90", repetitions: 1 });
  manager.execute("sky", { type: "pause" });
  manager.execute("sky", { type: "setSetting", setting: "cleanSpeed", value: 3 });
  assert.deepEqual(cloud.transports.get("sky")?.commands, [
    { type: "cleanRooms", roomIds: ["1", "4"], repetitions: 2 },
    { type: "cleanCustomArea", coordinates: "10,20,80,90", repetitions: 1 },
    { type: "pause" },
    { type: "setSetting", setting: "cleanSpeed", value: 3 },
  ]);
  assert.deepEqual(cloud.transports.get("luna")?.commands, []);
});

test("DeviceManager publishes the Ecovacs device image URL after connecting", async () => {
  const cloud = new FakeSession();
  const events = new EventBus();
  let image: { robotId: string; url: string } | undefined;
  events.on("robot:deviceImage", value => { image = value; });
  const manager = new DeviceManager(cloud, events);
  await manager.reconcile([robot("sky")]);
  assert.deepEqual(image, { robotId: "sky", url: "https://api-app.example/device-image" });
});

test("RoomManager preserves custom names and manages groups", () => {
  const manager = new RoomManager(new EventBus());
  manager.sync("luna", [
    { id: "2", ecovacsName: "C", polygon: [{ x: 0, y: 0 }, { x: 2, y: 2 }] },
    { id: "3", ecovacsName: "D", polygon: [{ x: 2, y: 2 }, { x: 4, y: 4 }] },
  ]);
  manager.rename("luna", "2", "Kinderzimmer links");
  const group = manager.merge("luna", ["2", "3"], "Kinderzimmer");
  assert.equal(group.id, "2,3");
  assert.deepEqual(manager.getRooms("luna").map(room => room.groupId), ["2,3", "2,3"]);

  manager.sync("luna", [
    { id: "2", ecovacsName: "C neu", polygon: [{ x: 0, y: 0 }] },
    { id: "3", ecovacsName: "D neu", polygon: [{ x: 4, y: 4 }] },
  ]);
  assert.equal(manager.getRooms("luna")[0].displayName, "Kinderzimmer");
});

test("RoomManager keeps identical room IDs on different floor scopes independent", () => {
  const manager = new RoomManager(new EventBus());
  manager.sync("robot:ground", [{ id: "1", ecovacsName: "Küche", polygon: [] }]);
  manager.sync("robot:upper", [{ id: "1", ecovacsName: "Schlafzimmer", polygon: [] }]);
  manager.rename("robot:ground", "1", "Küche unten");
  assert.equal(manager.getRooms("robot:ground")[0]?.displayName, "Küche unten");
  assert.equal(manager.getRooms("robot:upper")[0]?.displayName, "Schlafzimmer");
});

test("SessionManager coalesces concurrent login attempts", async () => {
  let logins = 0;
  const cloud = new FakeSession();
  cloud.login = async () => { logins += 1; await new Promise(resolve => setTimeout(resolve, 5)); };
  const factory: CloudSessionFactory = { create: () => cloud };
  const manager = new SessionManager(factory, logger);
  const config = { username: "user@example.org", password: "secret", country: "de", continent: "eu", deviceId: "stable" };
  await Promise.all([manager.login(config), manager.login(config), manager.login(config)]);
  assert.equal(logins, 1);
});

test("SessionManager exposes Ecovacs 1013 as a verification error", async () => {
  const cloud = new FakeSession();
  cloud.login = async () => { const error = new Error("API failure 1013"); throw error; };
  const manager = new SessionManager({ create: () => cloud }, logger);
  await assert.rejects(
    manager.login({ username: "u", password: "p", country: "de", continent: "eu", deviceId: "stable" }),
    VerificationRequiredError,
  );
});
