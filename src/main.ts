/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import * as utils from "@iobroker/adapter-core";
import { SessionManager, VerificationRequiredError } from "./auth/SessionManager";
import { storeSessionCredentials } from "./auth/StoredSession";
import { DeviceManager } from "./core/DeviceManager";
import { EcovacsCloudSessionFactory, createStableDeviceId } from "./ecovacs/EcovacsCloudSession";
import { EventBus } from "./events/EventBus";
import { StateProjector, toDeviceObjectId } from "./ioBroker/StateProjector";
import { MapManager } from "./map/MapManager";
import { RoomManager } from "./rooms/RoomManager";

interface AdapterConfig {
  username: string;
  password: string;
  country: string;
  continent: string;
  deviceId: string;
  verificationCode: string;
  authUserId: string;
  authToken: string;
  pollIntervalSeconds: number;
  roomNames?: Array<{ objectId: string; robot: string; floor: string; roomId: string; ecovacsName: string; name: string }>;
}

class EcovacsDeebot2 extends utils.Adapter {
  declare config: AdapterConfig;
  private readonly events = new EventBus();
  private readonly session = new SessionManager(new EcovacsCloudSessionFactory(message => this.log.warn(message)), {
    debug: message => this.log.debug(message),
    info: message => this.log.info(message),
    warn: message => this.log.warn(message),
    error: message => this.log.error(message),
  });
  private readonly maps = new MapManager(this.events);
  private readonly rooms = new RoomManager(this.events);
  private readonly unsubscribeRobotMap = this.events.on("robot:map", ({ robotId, update }) => {
    try {
      for (const normalized of this.maps.normalizeEcovacs(robotId, update)) {
        const rooms = this.rooms.sync(`${robotId}:${normalized.mapId}`, normalized.rooms ?? []);
        this.maps.update({ ...normalized, rooms });
        void this.syncRoomNameConfiguration(robotId, normalized.mapId, rooms);
      }
    } catch (error) {
      this.log.warn(`Cannot normalize map for ${robotId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  private readonly unsubscribeRobotCommand = this.events.on("robot:command", ({ robotId, command }) => {
    this.devices?.execute(robotId, command);
  });
  private devices: DeviceManager | null = null;
  private projector: StateProjector | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshInProgress = false;
  private authRetryAfter = 0;
  private inventoryAuthenticated = false;
  private roomConfigTimer: NodeJS.Timeout | null = null;
  private readonly pendingRoomRows = new Map<string, NonNullable<AdapterConfig["roomNames"]>[number]>();

  constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({ ...options, name: "ecovacs-deebot2" });
    this.on("ready", () => void this.onReady());
    this.on("stateChange", (id, state) => void this.projector?.handleStateChange(id, state));
    this.on("unload", callback => void this.onUnload(callback));
  }

  private async onReady(): Promise<void> {
    await this.ensureBaseObjects();
    await this.setStateAsync("info.connection", false, true);
    if (!this.config.username?.trim() || !this.config.password) {
      await this.setStateAsync("auth.status", "loggedOut", true);
      await this.setStateAsync("auth.message", "Bitte Ecovacs-Konto und Passwort in den Instanzeinstellungen hinterlegen.", true);
      this.log.info("Configure the Ecovacs account and password in the instance settings.");
      return;
    }
    await this.setStateAsync("auth.status", "loggingIn", true);
    await this.setStateAsync("auth.message", "", true);
    try {
      const deviceId = this.config.deviceId?.trim() || createStableDeviceId(`${this.namespace}:${this.config.username.trim().toLowerCase()}`);
      if (!this.config.deviceId?.trim()) this.log.info(`Using deterministic client ID ${deviceId}`);
      await this.session.login({ ...this.config, deviceId });
      if (await this.persistAuthenticatedSession()) return;
      this.projector = new StateProjector(this, this.events);
      this.projector.start();
      await this.subscribeStatesAsync("devices.*.map.rotation");
      await this.subscribeStatesAsync("devices.*.map.multiFloor.selectedId");
      await this.subscribeStatesAsync("devices.*.map.floors.*.select");
      await this.subscribeStatesAsync("devices.*.map.floors.*.rooms.*.name");
      await this.subscribeStatesAsync("devices.*.rooms.*.name");
      await this.subscribeStatesAsync("devices.*.rooms.*.group");
      await this.subscribeStatesAsync("devices.*.rooms.*.clean");
      await this.subscribeStatesAsync("devices.*.rooms.*.selected");
      await this.subscribeStatesAsync("devices.*.control.*");
      await this.subscribeStatesAsync("devices.*.control.cleaning.*");
      await this.subscribeStatesAsync("devices.*.history.*");
      await this.subscribeStatesAsync("devices.*.customArea.*");
      await this.subscribeStatesAsync("devices.*.appearance.*");
      this.devices = new DeviceManager(this.session.current, this.events);
      if (await this.refreshDevices()) return;
      const interval = Math.max(15, Number(this.config.pollIntervalSeconds) || 60) * 1000;
      this.refreshTimer = setInterval(() => void this.refreshDevices(), interval);
      if (!this.inventoryAuthenticated) return;
      await this.setStateAsync("auth.status", "authenticated", true);
      await this.setStateAsync("auth.message", "Ecovacs-Anmeldung erfolgreich", true);
      this.log.info(`Adapter ready with ${this.devices.size} robot(s)`);
      void this.maps;
      void this.rooms;
    } catch (error) {
      if (error instanceof VerificationRequiredError) {
        await this.setStateAsync("auth.status", "verificationRequired", true);
        await this.setStateAsync("auth.message", error.message, true);
        this.log.error(error.message);
      }
      else this.log.error(error instanceof Error ? error.stack ?? error.message : String(error));
    }
  }

  private async persistAuthenticatedSession(): Promise<boolean> {
    const credentials = this.session.authCredentials;
    if (!credentials) return false;
    const alreadyStored = this.config.authUserId?.trim() === credentials.userId
      && this.config.authToken?.trim() === credentials.token
      && !this.config.verificationCode?.trim();
    if (alreadyStored) return false;
    const id = `system.adapter.${this.namespace}`;
    const object = await this.getForeignObjectAsync(id);
    if (!object || object.type !== "instance") return false;
    object.native = storeSessionCredentials(object.native, credentials, value => this.encrypt(value));
    await this.setForeignObjectAsync(id, object);
    this.config.authUserId = credentials.userId;
    this.config.authToken = credentials.token;
    this.config.verificationCode = "";
    this.log.info("Verified Ecovacs session stored; waiting for the configuration restart");
    return true;
  }

  private async ensureBaseObjects(): Promise<void> {
    await this.extendObjectAsync("info", {
      type: "channel", common: { name: { de: "Adapterinformationen", en: "Adapter information" } }, native: {},
    });
    await this.extendObjectAsync("info.connection", {
      type: "state", common: {
        name: { de: "Ecovacs-Cloud verbunden", en: "Ecovacs cloud connected" },
        type: "boolean", role: "indicator.connected", read: true, write: false, def: false,
      }, native: {},
    });
    await this.extendObjectAsync("auth", {
      type: "channel", common: { name: { de: "Anmeldung", en: "Authentication" } }, native: {},
    });
    await this.extendObjectAsync("auth.status", {
      type: "state",
      common: { name: { de: "Anmeldestatus", en: "Authentication status" }, type: "string", role: "text", read: true, write: false, def: "loggedOut" },
      native: {},
    });
    await this.extendObjectAsync("auth.message", {
      type: "state",
      common: { name: { de: "Anmeldemeldung", en: "Authentication message" }, type: "string", role: "text", read: true, write: false, def: "" },
      native: {},
    });
  }

  private async refreshDevices(): Promise<boolean> {
    if (!this.devices || this.refreshInProgress) return false;
    this.refreshInProgress = true;
    try {
      const result = await this.devices.reconcile(await this.session.getDevices());
      this.inventoryAuthenticated = true;
      await this.setStateAsync("info.connection", true, true);
      if (result.added.length || result.removed.length) {
        this.log.info(`Device inventory updated: +${result.added.length}, -${result.removed.length}`);
      }
    } catch (error) {
      this.log.warn(`Device refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!/Failure code 1004 \(auth error\)/i.test(String(error))) return false;
      this.inventoryAuthenticated = false;
      await this.setStateAsync("info.connection", false, true);
      await this.setStateAsync("auth.status", "authenticationFailed", true);
      await this.setStateAsync("auth.message", "Ecovacs hat das gespeicherte Sitzungstoken abgelehnt. Anmeldung wird erneuert.", true);
      if (Date.now() < this.authRetryAfter) return false;
      this.authRetryAfter = Date.now() + 15 * 60_000;
      try {
        await this.session.refreshAuthentication({ ...this.config, deviceId: this.config.deviceId || "" });
        if (await this.persistAuthenticatedSession()) return true;
        const result = await this.devices.reconcile(await this.session.getDevices());
        this.inventoryAuthenticated = true;
        await this.setStateAsync("info.connection", true, true);
        await this.setStateAsync("auth.status", "authenticated", true);
        await this.setStateAsync("auth.message", "Ecovacs-Anmeldung erneuert", true);
        if (result.added.length || result.removed.length) this.log.info(`Device inventory updated: +${result.added.length}, -${result.removed.length}`);
      } catch (refreshError) {
        if (refreshError instanceof VerificationRequiredError) {
          this.authRetryAfter = Number.POSITIVE_INFINITY;
          await this.setStateAsync("auth.status", "verificationRequired", true);
          await this.setStateAsync("auth.message", refreshError.message, true);
        } else {
          await this.setStateAsync("auth.message", `Ecovacs-Anmeldung konnte nicht erneuert werden: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`, true);
        }
        this.log.warn(`Ecovacs reauthentication failed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`);
      }
    } finally {
      this.refreshInProgress = false;
    }
    return false;
  }

  private syncRoomNameConfiguration(robotId: string, mapId: string, rooms: import("./domain/types").Room[]): void {
    const robotName = this.devices?.all().find(device => device.id === robotId)?.name ?? robotId;
    const robot = toDeviceObjectId(robotName);
    const floor = toDeviceObjectId(mapId);
    for (const room of rooms) {
      const roomId = toDeviceObjectId(room.id);
      const objectId = `devices.${robot}.map.floors.${floor}.rooms.${roomId}.name`;
      this.pendingRoomRows.set(objectId, { objectId, robot, floor, roomId: room.id, ecovacsName: room.ecovacsName, name: room.displayName });
    }
    if (!this.roomConfigTimer) {
      this.roomConfigTimer = setTimeout(() => void this.flushRoomNameConfiguration().catch(error => {
        this.log.warn(`Cannot update room table: ${error instanceof Error ? error.message : String(error)}`);
      }), 15_000);
      this.roomConfigTimer.unref?.();
    }
  }

  private async flushRoomNameConfiguration(): Promise<void> {
    this.roomConfigTimer = null;
    if (!this.devices || !this.projector || !this.pendingRoomRows.size) return;
    const instanceId = `system.adapter.${this.namespace}`;
    const object = await this.getForeignObjectAsync(instanceId);
    if (!object || object.type !== "instance") return;
    const current = Array.isArray(object.native.roomNames) ? object.native.roomNames as AdapterConfig["roomNames"] ?? [] : [];
    const incoming = [...this.pendingRoomRows.values()].map(item => {
      const previous = current.find(row => row.objectId === item.objectId);
      return { ...item, name: previous?.name || item.name };
    });
    this.pendingRoomRows.clear();
    const retained = current.filter(row => !incoming.some(item => item.objectId === row.objectId));
    const next = [...retained, ...incoming].sort((a, b) => a.objectId.localeCompare(b.objectId));
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    object.native.roomNames = next;
    await this.setForeignObjectAsync(instanceId, object);
    this.config.roomNames = next;
  }

  private async onUnload(callback: () => void): Promise<void> {
    try {
      if (this.refreshTimer) clearInterval(this.refreshTimer);
      if (this.roomConfigTimer) clearTimeout(this.roomConfigTimer);
      // Detach map processing first, then let already running ioBroker writes
      // finish while its databases are still available.
      this.unsubscribeRobotMap();
      this.unsubscribeRobotCommand();
      await this.setStateAsync("info.connection", false, true);
      await this.projector?.stop();
      await this.devices?.disconnectAll();
      await this.session.close();
      this.events.removeAllListeners();
    } finally {
      callback();
    }
  }
}

if (require.main !== module) {
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new EcovacsDeebot2(options);
} else {
  new EcovacsDeebot2();
}
