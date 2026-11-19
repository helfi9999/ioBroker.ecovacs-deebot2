/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * Map-related portions based on ioBroker.ecovacs-map, Copyright (c) 2026 Helfi9999.
 * Original MIT terms are preserved in licenses/ioBroker.ecovacs-map-MIT.txt.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import type * as utils from "@iobroker/adapter-core";
import { createHash } from "node:crypto";
import type {
  MapSnapshot,
  Point,
  RobotCapabilities,
  RobotCommand,
  RobotDescriptor,
  RobotSettingName,
  Room,
} from "../domain/types";
import type { EventBus } from "../events/EventBus";
import { SvgRenderer } from "../map/SvgRenderer";

/**
 * Projects robot events and map data into ioBroker states and objects.
 */
export class StateProjector {
  private readonly hiddenTelemetryPaths = new Set([
    "consumables.raw",
    "device.firmware.raw",
    "extended.cleaningStation.operationCode",
    "extended.cleaningStation.model",
    "station.autoEmpty.raw",
    "statistics.lastCleaning.raw",
  ]);
  private readonly unsubscribers: Array<() => void> = [];
  private readonly robotReady = new Map<string, Promise<void>>();
  private readonly robotObjectIds = new Map<string, string>();
  private readonly usedObjectIds = new Set<string>();
  private readonly latestSnapshots = new Map<string, MapSnapshot>();
  private readonly floorSnapshots = new Map<string, Map<string, MapSnapshot>>();
  private readonly floorSignatures = new Map<string, Map<string, string>>();
  private readonly selectedFloorIds = new Map<string, string>();
  private readonly moppingActive = new Map<string, boolean>();
  private readonly autoEmptyActive = new Set<string>();
  private readonly autoEmptyEnabled = new Set<string>();
  private readonly inferredAutoEmpty = new Set<string>();
  private readonly returningActive = new Set<string>();
  private readonly sequentialCleaningPhase = new Map<
    string,
    "vacuum" | "mop"
  >();
  private readonly finalWaterDrainReported = new Set<string>();
  private readonly waterCycleActive = new Set<string>();
  private readonly commandedRoomIds = new Map<string, string[]>();
  private readonly currentSpotAreaIds = new Map<string, string[]>();
  private readonly announcedSpotTargets = new Map<string, string>();
  private readonly rotations = new Map<string, number>();
  private readonly robotCapabilities = new Map<string, RobotCapabilities>();
  private readonly customAreas = new Map<
    string,
    { active: boolean; values: string }
  >();
  private readonly lastStatuses = new Map<string, string>();
  private readonly lastHistoryClasses = new Map<string, string>();
  private readonly terminalStatuses = new Set<string>();
  private readonly cleaningCompletedAt = new Map<string, number>();
  private readonly cleaningStartedAt = new Map<string, number>();
  private readonly lastCleaningSignalAt = new Map<string, number>();
  private readonly lastReturningAt = new Map<string, number>();
  private readonly lastCustomAreaStarts = new Map<
    string,
    { coordinates: string; at: number }
  >();
  private readonly customAreaCoordinatesAt = new Map<string, number>();
  private readonly customAreaOriginRooms = new Map<string, string>();
  private readonly inferredCustomAreaRooms = new Map<string, string>();
  private readonly customAreaTargetReached = new Set<string>();
  private readonly appearances = new Map<
    string,
    { robotSizePercent: number; robotImageUrl: string }
  >();
  private readonly trails = new Map<string, Point[]>();
  private readonly cleaningActive = new Set<string>();
  private readonly trailFinishTimers = new Map<string, ioBroker.Timeout>();
  private readonly currentRooms = new Map<string, string>();
  private readonly runtimeStatuses = new Map<
    string,
    Partial<Record<"clean" | "charge" | "station", string>>
  >();
  private readonly airDryingStartedAt = new Map<string, number>();
  private readonly airDryingDurations = new Map<string, number>();
  private readonly airDryingTimers = new Map<string, ioBroker.Interval>();
  private readonly runningEvents = new Set<Promise<void>>();
  private stopping = false;
  private readonly renderer = new SvgRenderer();

  /**
   * Creates a state projector for the adapter and event bus.
   *
   * @param adapter - ioBroker adapter instance.
   * @param events - Event bus for robot updates.
   */
  constructor(
    private readonly adapter: InstanceType<typeof utils.Adapter>,
    private readonly events: EventBus,
  ) {}

  /**
   * Starts subscribing to robot and map events.
   */
  start(): void {
    this.stopping = false;
    this.unsubscribers.push(
      this.events.on("robot:added", ({ robot }) => {
        this.robotObjectIds.set(robot.id, this.allocateObjectId(robot));
        const ready = this.createRobot(robot);
        this.robotReady.set(robot.id, ready);
        void ready.catch((error) => {
          if (!this.stopping) {
            this.adapter.log.error(
              `Cannot create objects for ${robot.name}: ${String(error)}`,
            );
          }
        });
      }),
      this.events.on("robot:removed", ({ robotId }) => {
        const objectId = this.robotObjectIds.get(robotId);
        if (objectId) {
          this.usedObjectIds.delete(objectId);
        }
        this.robotObjectIds.delete(robotId);
        this.robotReady.delete(robotId);
        this.robotCapabilities.delete(robotId);
        this.customAreas.delete(robotId);
        this.lastStatuses.delete(robotId);
        this.lastHistoryClasses.delete(robotId);
        this.terminalStatuses.delete(robotId);
        this.cleaningCompletedAt.delete(robotId);
        this.cleaningStartedAt.delete(robotId);
        this.lastCleaningSignalAt.delete(robotId);
        this.lastReturningAt.delete(robotId);
        this.lastCustomAreaStarts.delete(robotId);
        this.customAreaCoordinatesAt.delete(robotId);
        this.customAreaOriginRooms.delete(robotId);
        this.inferredCustomAreaRooms.delete(robotId);
        this.customAreaTargetReached.delete(robotId);
        this.appearances.delete(robotId);
        this.floorSnapshots.delete(robotId);
        this.floorSignatures.delete(robotId);
        this.selectedFloorIds.delete(robotId);
        this.moppingActive.delete(robotId);
        this.autoEmptyActive.delete(robotId);
        this.autoEmptyEnabled.delete(robotId);
        this.inferredAutoEmpty.delete(robotId);
        this.returningActive.delete(robotId);
        this.sequentialCleaningPhase.delete(robotId);
        this.finalWaterDrainReported.delete(robotId);
        this.waterCycleActive.delete(robotId);
        this.commandedRoomIds.delete(robotId);
        this.currentSpotAreaIds.delete(robotId);
        this.announcedSpotTargets.delete(robotId);
        this.trails.delete(robotId);
        this.cleaningActive.delete(robotId);
        this.clearTrailFinishTimer(robotId);
        this.currentRooms.delete(robotId);
        this.runtimeStatuses.delete(robotId);
        this.clearAirDryingTimer(robotId);
        this.airDryingStartedAt.delete(robotId);
        this.airDryingDurations.delete(robotId);
      }),
      this.events.on("robot:connection", (event) =>
        this.runEvent("connection", () =>
          this.setConnection(event.robotId, event.state === "connected"),
        ),
      ),
      this.events.on("map:updated", ({ snapshot }) =>
        this.runEvent("map", () =>
          this.setMapSnapshot(snapshot.robotId, snapshot),
        ),
      ),
      this.events.on("robot:capabilities", ({ robotId, capabilities }) => {
        this.robotCapabilities.set(robotId, capabilities);
        this.runEvent("capabilities", async () => {
          if (!this.robotObjectIds.has(robotId)) {
            return;
          }
          await Promise.all([
            this.createCleaningSettings(robotId, capabilities),
            this.setControlsDetected(robotId, capabilities),
            ...(capabilities.customArea
              ? [this.createCustomAreaObjects(robotId)]
              : []),
          ]);
        });
      }),
      this.events.on("robot:setting", ({ robotId, setting, value }) =>
        this.runEvent("setting", () =>
          this.setRobotSetting(robotId, setting, value),
        ),
      ),
      this.events.on("robot:status", ({ robotId, status, source }) =>
        this.runEvent("status", () =>
          this.handleRobotStatus(robotId, status, source),
        ),
      ),
      this.events.on("robot:telemetry", ({ robotId, path, value }) =>
        this.runEvent("telemetry", () =>
          this.setRobotTelemetry(robotId, path, value),
        ),
      ),
      this.events.on("robot:deviceImage", ({ robotId, url }) =>
        this.runEvent("device image", () =>
          this.setDeviceImageUrl(robotId, url),
        ),
      ),
    );
  }

  private runEvent(scope: string, action: () => Promise<void>): void {
    if (this.stopping) {
      return;
    }
    const task: Promise<void> = action()
      .catch((error) => {
        if (!this.stopping) {
          this.adapter.log.warn(
            `Ignored ${scope} event: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })
      .finally(() => this.runningEvents.delete(task));
    this.runningEvents.add(task);
  }

  /**
   * Stops event processing and releases active resources.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
    for (const timer of this.trailFinishTimers.values()) {
      this.adapter.clearTimeout(timer);
    }
    this.trailFinishTimers.clear();
    for (const timer of this.airDryingTimers.values()) {
      this.adapter.clearInterval(timer);
    }
    this.airDryingTimers.clear();
    await Promise.allSettled([
      ...this.robotReady.values(),
      ...this.runningEvents,
    ]);
    this.runningEvents.clear();
    this.robotReady.clear();
    this.robotObjectIds.clear();
    this.usedObjectIds.clear();
    this.latestSnapshots.clear();
    this.floorSnapshots.clear();
    this.floorSignatures.clear();
    this.selectedFloorIds.clear();
    this.moppingActive.clear();
    this.autoEmptyActive.clear();
    this.autoEmptyEnabled.clear();
    this.inferredAutoEmpty.clear();
    this.returningActive.clear();
    this.sequentialCleaningPhase.clear();
    this.finalWaterDrainReported.clear();
    this.waterCycleActive.clear();
    this.commandedRoomIds.clear();
    this.currentSpotAreaIds.clear();
    this.announcedSpotTargets.clear();
    this.rotations.clear();
    this.robotCapabilities.clear();
    this.customAreas.clear();
    this.lastStatuses.clear();
    this.lastHistoryClasses.clear();
    this.terminalStatuses.clear();
    this.cleaningCompletedAt.clear();
    this.cleaningStartedAt.clear();
    this.lastCleaningSignalAt.clear();
    this.lastReturningAt.clear();
    this.lastCustomAreaStarts.clear();
    this.customAreaCoordinatesAt.clear();
    this.customAreaOriginRooms.clear();
    this.inferredCustomAreaRooms.clear();
    this.customAreaTargetReached.clear();
    this.appearances.clear();
    this.trails.clear();
    this.cleaningActive.clear();
    this.currentRooms.clear();
    this.runtimeStatuses.clear();
    this.airDryingStartedAt.clear();
    this.airDryingDurations.clear();
  }

  /**
   * Processes an incoming ioBroker state change.
   *
   * @param id - Identifier of the changed state.
   * @param state - New state value and acknowledgement information.
   */
  async handleStateChange(
    id: string,
    state: { val: unknown; ack: boolean } | null | undefined,
  ): Promise<void> {
    if (!state || state.ack) {
      return;
    }
    for (const [robotId, objectId] of this.robotObjectIds) {
      if (id.endsWith(`.devices.${objectId}.map.rotation`)) {
        const rotation = this.renderer.normalizeRotation(Number(state.val));
        this.rotations.set(robotId, rotation);
        await this.adapter.setStateAsync(
          `devices.${objectId}.map.rotation`,
          rotation,
          true,
        );
        const snapshot = this.displayedSnapshot(robotId);
        if (snapshot) {
          await this.writeSnapshot(
            robotId,
            snapshot,
            snapshot.isCurrentMap !== false,
          );
        }
        return;
      }
      if (id.endsWith(`.devices.${objectId}.map.multiFloor.selectedId`)) {
        await this.selectDisplayedFloor(
          robotId,
          objectId,
          typeof state.val === "string" || typeof state.val === "number"
            ? String(state.val).trim()
            : "",
        );
        return;
      }
      const floorPrefix = `.devices.${objectId}.map.floors.`;
      const floorIndex = id.lastIndexOf(floorPrefix);
      if (floorIndex >= 0 && id.endsWith(".name")) {
        const relativeId = id.slice(floorIndex + floorPrefix.length);
        const match = /^([^.]+)\.rooms\.([^.]+)\.name$/.exec(relativeId);
        if (match) {
          const floor = [
            ...(this.floorSnapshots.get(robotId)?.values() ?? []),
          ].find((candidate) => toDeviceObjectId(candidate.mapId) === match[1]);
          const room = floor?.rooms.find(
            (candidate) => toDeviceObjectId(candidate.id) === match[2],
          );
          const value =
            typeof state.val === "string" || typeof state.val === "number"
              ? String(state.val).trim()
              : "";
          if (!floor || !room || !value) {
            return;
          }
          room.displayName = value;
          await this.writeFloorSnapshot(
            robotId,
            floor,
            this.floorSnapshots.get(robotId)!,
            true,
          );
          if (
            (this.selectedFloorIds.get(robotId) ||
              this.latestSnapshots.get(robotId)?.mapId) === floor.mapId
          ) {
            await this.writeSnapshot(
              robotId,
              floor,
              floor.isCurrentMap !== false,
            );
          }
          return;
        }
      }
      if (floorIndex >= 0 && id.endsWith(".select")) {
        if (!this.isTrue(state.val)) {
          return;
        }
        const floorObjectId = id.slice(
          floorIndex + floorPrefix.length,
          -".select".length,
        );
        const floor = [
          ...(this.floorSnapshots.get(robotId)?.values() ?? []),
        ].find(
          (candidate) => toDeviceObjectId(candidate.mapId) === floorObjectId,
        );
        if (floor) {
          await this.selectDisplayedFloor(robotId, objectId, floor.mapId);
        }
        return;
      }
      const appearancePrefix = `.devices.${objectId}.appearance.`;
      const appearanceIndex = id.lastIndexOf(appearancePrefix);
      if (appearanceIndex >= 0) {
        await this.handleAppearanceChange(
          robotId,
          objectId,
          id.slice(appearanceIndex + appearancePrefix.length),
          state.val,
        );
        return;
      }
      const historyPrefix = `.devices.${objectId}.history.`;
      const historyIndex = id.lastIndexOf(historyPrefix);
      if (historyIndex >= 0) {
        await this.handleHistoryChange(
          objectId,
          id.slice(historyIndex + historyPrefix.length),
          state.val,
        );
        return;
      }
      const customPrefix = `.devices.${objectId}.customArea.`;
      const customIndex = id.lastIndexOf(customPrefix);
      if (customIndex >= 0) {
        await this.handleCustomAreaChange(
          robotId,
          objectId,
          id.slice(customIndex + customPrefix.length),
          state.val,
        );
        return;
      }
      const cleaningPrefix = `.devices.${objectId}.control.cleaning.`;
      const cleaningIndex = id.lastIndexOf(cleaningPrefix);
      if (cleaningIndex >= 0) {
        const setting = id.slice(
          cleaningIndex + cleaningPrefix.length,
        ) as RobotSettingName;
        if (
          [
            "cleanSpeed",
            "waterLevel",
            "cleanCount",
            "moppingMode",
            "cleaningMode",
          ].includes(setting)
        ) {
          await this.executeCommand(robotId, objectId, {
            type: "setSetting",
            setting,
            value: Number(state.val),
          });
        }
        return;
      }
      const controlPrefix = `.devices.${objectId}.control.`;
      const controlIndex = id.lastIndexOf(controlPrefix);
      if (controlIndex >= 0) {
        await this.handleControlChange(
          robotId,
          objectId,
          id.slice(controlIndex + controlPrefix.length),
          state.val,
        );
        return;
      }
      const roomPrefix = `.devices.${objectId}.rooms.`;
      const roomIndex = id.lastIndexOf(roomPrefix);
      const property = id.endsWith(".name")
        ? "name"
        : id.endsWith(".group")
          ? "group"
          : id.endsWith(".clean")
            ? "clean"
            : id.endsWith(".selected")
              ? "selected"
              : null;
      if (roomIndex < 0 || !property) {
        continue;
      }
      const roomObjectId = id.slice(
        roomIndex + roomPrefix.length,
        -`.${property}`.length,
      );
      const snapshot = this.displayedSnapshot(robotId);
      const room = snapshot?.rooms.find(
        (candidate) => toDeviceObjectId(candidate.id) === roomObjectId,
      );
      if (!snapshot || !room) {
        return;
      }
      if (property === "selected") {
        await this.adapter.setStateAsync(
          `devices.${objectId}.rooms.${roomObjectId}.selected`,
          this.isTrue(state.val),
          true,
        );
        const selectedRoomIds = await this.getSelectedRoomIds(
          `devices.${objectId}`,
          snapshot.rooms,
        );
        await this.adapter.setStateAsync(
          `devices.${objectId}.control.roomIds`,
          JSON.stringify(selectedRoomIds),
          true,
        );
        await this.writeSnapshot(
          robotId,
          snapshot,
          snapshot.isCurrentMap !== false,
        );
        return;
      }
      if (property === "clean") {
        if (!this.isTrue(state.val)) {
          return;
        }
        const roomIds = room.groupId
          ? snapshot.rooms
              .filter((candidate) => candidate.groupId === room.groupId)
              .map((candidate) => candidate.id)
          : [room.id];
        const targets = new Set(roomIds);
        await Promise.all(
          snapshot.rooms.map((candidate) =>
            this.adapter.setStateAsync(
              `devices.${objectId}.rooms.${toDeviceObjectId(candidate.id)}.selected`,
              targets.has(candidate.id),
              true,
            ),
          ),
        );
        await this.adapter.setStateAsync(
          `devices.${objectId}.control.roomIds`,
          JSON.stringify(roomIds),
          true,
        );
        await this.writeSnapshot(
          robotId,
          snapshot,
          snapshot.isCurrentMap !== false,
        );
        await this.executeCommand(robotId, objectId, {
          type: "cleanRooms",
          roomIds: [...new Set(roomIds)],
          repetitions: await this.getRepetitions(objectId),
        });
        await this.adapter.setStateAsync(
          `devices.${objectId}.rooms.${roomObjectId}.clean`,
          false,
          true,
        );
        return;
      }
      const value =
        typeof state.val === "string" || typeof state.val === "number"
          ? String(state.val).trim()
          : "";
      if (property === "name") {
        if (!value) {
          return;
        }
        room.displayName = value;
        const floor = this.floorSnapshots.get(robotId)?.get(snapshot.mapId);
        const floorRoom = floor?.rooms.find(
          (candidate) => candidate.id === room.id,
        );
        if (floorRoom) {
          floorRoom.displayName = value;
        }
        if (floor) {
          await this.writeFloorSnapshot(
            robotId,
            floor,
            this.floorSnapshots.get(robotId)!,
            true,
          );
        }
      } else {
        room.groupId = value || null;
      }
      await this.adapter.setStateAsync(
        `devices.${objectId}.rooms.${roomObjectId}.${property}`,
        value,
        true,
      );
      await this.writeSnapshot(
        robotId,
        snapshot,
        snapshot.isCurrentMap !== false,
      );
      return;
    }
  }

  private async setConnection(
    robotId: string,
    connected: boolean,
  ): Promise<void> {
    if (!this.robotObjectIds.has(robotId)) {
      return;
    }
    await this.robotReady.get(robotId);
    if (!this.robotObjectIds.has(robotId)) {
      return;
    }
    await this.adapter.setStateAsync(
      `devices.${this.requireObjectId(robotId)}.info.connection`,
      connected,
      true,
    );
  }

  private async setMapSnapshot(
    robotId: string,
    snapshot: MapSnapshot,
  ): Promise<void> {
    if (!this.robotObjectIds.has(robotId)) {
      return;
    }
    await this.robotReady.get(robotId);
    if (!this.robotObjectIds.has(robotId)) {
      return;
    }
    const floors =
      this.floorSnapshots.get(robotId) ?? new Map<string, MapSnapshot>();
    floors.set(snapshot.mapId, snapshot);
    this.floorSnapshots.set(robotId, floors);
    const signatures =
      this.floorSignatures.get(robotId) ?? new Map<string, string>();
    const signature = JSON.stringify([
      snapshot.mapName,
      snapshot.mapIndex,
      snapshot.mapStatus,
      snapshot.isCurrentMap,
      snapshot.isBuilt,
      snapshot.rooms,
    ]);
    if (signatures.get(snapshot.mapId) !== signature) {
      signatures.set(snapshot.mapId, signature);
      this.floorSignatures.set(robotId, signatures);
      await this.writeFloorSnapshot(robotId, snapshot, floors);
    }
    const selectedId = this.selectedFloorIds.get(robotId) ?? "";
    if (snapshot.isCurrentMap === false) {
      if (selectedId === snapshot.mapId) {
        await this.writeSnapshot(robotId, snapshot, false);
      }
      return;
    }
    if (this.cleaningActive.has(robotId) && snapshot.robotPosition) {
      this.addTrailPoint(robotId, snapshot.robotPosition);
    }
    this.latestSnapshots.set(robotId, snapshot);
    if (selectedId && selectedId !== snapshot.mapId) {
      return;
    }
    await this.writeSnapshot(robotId, snapshot);
  }

  private async writeFloorSnapshot(
    robotId: string,
    snapshot: MapSnapshot,
    floors: Map<string, MapSnapshot>,
    useCurrentNames = false,
  ): Promise<void> {
    const deviceBase = `devices.${this.requireObjectId(robotId)}`;
    const floorBase = `${deviceBase}.map.floors.${toDeviceObjectId(snapshot.mapId)}`;
    const rooms = useCurrentNames
      ? snapshot.rooms
      : await this.applyStoredFloorRoomConfiguration(floorBase, snapshot.rooms);
    snapshot.rooms = rooms;
    const effectiveSnapshot = { ...snapshot, rooms };
    const selectedId = this.selectedFloorIds.get(robotId);
    const displayed = selectedId
      ? selectedId === snapshot.mapId
      : snapshot.isCurrentMap !== false;
    const svg = this.renderer.render(
      effectiveSnapshot,
      this.rotations.get(robotId) ?? 0,
      {
        customArea:
          displayed && this.customAreas.has(robotId)
            ? {
                ...this.customAreas.get(robotId)!,
                stateId: `${this.adapter.namespace}.${deviceBase}.customArea.values`,
              }
            : undefined,
        robotSizePercent: this.appearances.get(robotId)?.robotSizePercent,
        robotImageUrl: this.appearances.get(robotId)?.robotImageUrl,
      },
    );
    const html = `<div class="ecovacs-map-widget" style="display:block;width:100%;height:100%;overflow:hidden">${svg}</div>`;
    await this.adapter.extendObjectAsync(floorBase, {
      type: "channel",
      common: {
        name: this.localizedName(
          snapshot.mapName || `Etage ${snapshot.mapIndex ?? snapshot.mapId}`,
        ),
        expert: true,
      },
      native: { mapId: snapshot.mapId },
    });
    for (const [id, name, type, role] of [
      ["id", "Karten-ID", "string", "text"],
      ["name", "Etagenname", "string", "text"],
      ["index", "Etagenindex", "number", "value"],
      ["active", "Aktive Etage", "boolean", "indicator"],
      ["built", "Karte vollständig erstellt", "boolean", "indicator"],
      ["snapshot", "Kartenschnappschuss der Etage", "string", "json"],
      ["svg", "SVG-Karte der Etage", "string", "html"],
      ["html", "HTML-Karte der Etage", "string", "html"],
    ] as Array<[string, string, "string" | "number" | "boolean", string]>) {
      await this.createReadonlyState(
        `${floorBase}.${id}`,
        name,
        type,
        role,
        true,
      );
    }
    // Older releases duplicated every room beneath floors. Preserve their names
    // in the floor snapshot, then remove that redundant object tree.
    if (await this.adapter.getObjectAsync(`${floorBase}.rooms`)) {
      await this.adapter.delObjectAsync(`${floorBase}.rooms`, {
        recursive: true,
      });
    }
    await this.adapter.extendObjectAsync(`${floorBase}.select`, {
      type: "state",
      common: {
        name: this.localizedName("Etage anzeigen"),
        type: "boolean",
        role: "button",
        read: true,
        write: true,
        def: false,
        expert: true,
      },
      native: {},
    });
    await this.adapter.extendObjectAsync(
      `${deviceBase}.map.multiFloor.selectedId`,
      {
        type: "state",
        common: {
          name: this.localizedName("Anzuzeigende Etage"),
          type: "string",
          role: "value",
          read: true,
          write: true,
          def: "",
          states: Object.fromEntries([
            ["", "Automatisch"],
            ...[...floors.values()].map((floor) => [
              floor.mapId,
              `Etage ${floor.mapIndex == null ? floor.mapId : floor.mapIndex + 1}${floor.mapName && floor.mapName !== "New" ? ` – ${floor.mapName}` : ""}`,
            ]),
          ]),
        },
        native: {},
      },
    );
    const activeFloor = [...floors.values()].find(
      (floor) => floor.isCurrentMap !== false,
    );
    await Promise.all([
      this.adapter.setStateAsync(`${floorBase}.id`, snapshot.mapId, true),
      this.adapter.setStateAsync(
        `${floorBase}.name`,
        snapshot.mapName ?? "",
        true,
      ),
      this.adapter.setStateAsync(
        `${floorBase}.index`,
        snapshot.mapIndex ?? 0,
        true,
      ),
      this.adapter.setStateAsync(
        `${floorBase}.active`,
        snapshot.isCurrentMap !== false,
        true,
      ),
      this.adapter.setStateAsync(
        `${floorBase}.built`,
        snapshot.isBuilt ?? true,
        true,
      ),
      this.adapter.setStateAsync(
        `${floorBase}.select`,
        this.selectedFloorIds.get(robotId) === snapshot.mapId,
        true,
      ),
      this.adapter.setStateAsync(
        `${floorBase}.snapshot`,
        JSON.stringify({ ...effectiveSnapshot, svg }),
        true,
      ),
      this.adapter.setStateAsync(`${floorBase}.svg`, svg, true),
      this.adapter.setStateAsync(`${floorBase}.html`, html, true),
      this.adapter.setStateAsync(
        `${deviceBase}.map.multiFloor.enabled`,
        snapshot.multiMapEnabled ?? floors.size > 1,
        true,
      ),
      this.adapter.setStateAsync(
        `${deviceBase}.map.multiFloor.activeId`,
        activeFloor?.mapId ?? "",
        true,
      ),
      this.adapter.setStateAsync(
        `${deviceBase}.map.multiFloor.activeName`,
        activeFloor?.mapName ?? "",
        true,
      ),
      this.adapter.setStateAsync(
        `${deviceBase}.map.multiFloor.count`,
        floors.size,
        true,
      ),
      this.adapter.setStateAsync(
        `${deviceBase}.map.multiFloor.list`,
        JSON.stringify(
          [...floors.values()].map((floor) => ({
            id: floor.mapId,
            name: floor.mapName ?? "",
            index: floor.mapIndex ?? 0,
            active: floor.isCurrentMap !== false,
            built: floor.isBuilt ?? true,
            status: floor.mapStatus ?? null,
          })),
        ),
        true,
      ),
    ]);
  }

  private async applyStoredFloorRoomConfiguration(
    floorBase: string,
    rooms: Room[],
  ): Promise<Room[]> {
    const cached = await this.adapter.getStateAsync(`${floorBase}.snapshot`);
    let previousRooms: Room[] = [];
    try {
      const parsed = JSON.parse(String(cached?.val ?? "{}"));
      previousRooms = Array.isArray(parsed?.rooms) ? parsed.rooms : [];
    } catch {
      /* no cached map */
    }
    return Promise.all(
      rooms.map(async (room) => {
        const objectId = `${floorBase}.rooms.${toDeviceObjectId(room.id)}.name`;
        const state = await this.adapter.getStateAsync(objectId);
        const storedName =
          typeof state?.val === "string" ? state.val.trim() : "";
        const previousName = previousRooms.find(
          (item) => item.id === room.id,
        )?.displayName;
        return {
          ...room,
          displayName:
            this.configuredRoomName(objectId) ||
            storedName ||
            previousName ||
            room.displayName,
        };
      }),
    );
  }

  private configuredRoomName(objectId: string): string {
    const config = (
      this.adapter.config as unknown as {
        roomNames?: Array<{ objectId?: string; name?: string }>;
      }
    ).roomNames;
    const row = config?.find((item) => item.objectId === objectId);
    return typeof row?.name === "string" ? row.name.trim() : "";
  }

  private async selectDisplayedFloor(
    robotId: string,
    objectId: string,
    requestedId: string,
  ): Promise<void> {
    const floors = this.floorSnapshots.get(robotId);
    const selected = requestedId
      ? floors?.get(requestedId)
      : this.latestSnapshots.get(robotId);
    if (requestedId && !selected) {
      await this.adapter.setStateAsync(
        `devices.${objectId}.map.multiFloor.selectedId`,
        this.selectedFloorIds.get(robotId) ?? "",
        true,
      );
      this.adapter.log.warn(`Unknown map ID ${requestedId} for ${objectId}`);
      return;
    }
    this.selectedFloorIds.set(robotId, requestedId);
    await this.adapter.setStateAsync(
      `devices.${objectId}.map.multiFloor.selectedId`,
      requestedId,
      true,
    );
    for (const floor of floors?.values() ?? []) {
      await this.adapter.setStateAsync(
        `devices.${objectId}.map.floors.${toDeviceObjectId(floor.mapId)}.select`,
        requestedId === floor.mapId,
        true,
      );
    }
    if (selected) {
      await this.writeSnapshot(robotId, selected, false);
    }
  }

  private displayedSnapshot(robotId: string): MapSnapshot | undefined {
    const id = this.selectedFloorIds.get(robotId);
    return (
      (id ? this.floorSnapshots.get(robotId)?.get(id) : undefined) ??
      this.latestSnapshots.get(robotId)
    );
  }

  private async writeSnapshot(
    robotId: string,
    snapshot: MapSnapshot,
    trackAsLatest = true,
  ): Promise<void> {
    const base = `devices.${this.requireObjectId(robotId)}`;
    const rooms = await this.applyStoredRoomConfiguration(
      base,
      snapshot.mapId,
      snapshot.rooms,
    );
    const effectiveSnapshot = { ...snapshot, rooms };
    if (trackAsLatest) {
      this.latestSnapshots.set(robotId, effectiveSnapshot);
    }
    await this.ensureRoomObjects(base, rooms);
    const selectedRoomIds = await this.getSelectedRoomIds(base, rooms);
    const svg = this.renderer.render(
      effectiveSnapshot,
      this.rotations.get(robotId) ?? 0,
      {
        selectedRoomIds,
        roomStateBase: `${this.adapter.namespace}.${base}.rooms`,
        customArea: this.customAreas.has(robotId)
          ? {
              ...this.customAreas.get(robotId)!,
              stateId: `${this.adapter.namespace}.${base}.customArea.values`,
            }
          : undefined,
        robotSizePercent: this.appearances.get(robotId)?.robotSizePercent,
        robotImageUrl: this.appearances.get(robotId)?.robotImageUrl,
        trail: this.trails.get(robotId),
      },
    );
    const html = `<div class="ecovacs-map-widget" style="display:block;width:100%;height:100%;overflow:hidden;color:inherit;font-family:inherit;font-style:inherit;font-variant:inherit;font-weight:inherit;font-size:inherit;line-height:inherit;letter-spacing:inherit;word-spacing:inherit;text-shadow:inherit">${svg}</div>`;
    const rotatedSnapshot = { ...effectiveSnapshot, svg };
    const displayedFloor = this.floorSnapshots
      .get(robotId)
      ?.get(snapshot.mapId);
    const floorBase = `${base}.map.floors.${toDeviceObjectId(snapshot.mapId)}`;
    await Promise.all([
      this.adapter.setStateAsync(`${base}.map.id`, snapshot.mapId, true),
      this.adapter.setStateAsync(
        `${base}.map.robotPosition`,
        JSON.stringify(snapshot.robotPosition),
        true,
      ),
      this.adapter.setStateAsync(
        `${base}.map.dockPosition`,
        JSON.stringify(snapshot.dockPosition),
        true,
      ),
      this.adapter.setStateAsync(
        `${base}.map.rooms`,
        JSON.stringify(rooms),
        true,
      ),
      this.adapter.setStateAsync(`${base}.map.svg`, svg, true),
      this.adapter.setStateAsync(`${base}.map.html`, html, true),
      this.adapter.setStateAsync(
        `${base}.map.trail`,
        JSON.stringify(this.trails.get(robotId) ?? []),
        true,
      ),
      ...(displayedFloor
        ? [
            this.adapter.setStateAsync(`${floorBase}.svg`, svg, true),
            this.adapter.setStateAsync(`${floorBase}.html`, html, true),
          ]
        : []),
    ]);
    await this.adapter.setStateAsync(
      `${base}.map.snapshot`,
      JSON.stringify(rotatedSnapshot),
      true,
    );
    if (trackAsLatest) {
      await this.updateMapStatus(robotId, base, effectiveSnapshot);
    }
  }

  private async applyStoredRoomConfiguration(
    base: string,
    mapId: string,
    rooms: Room[],
  ): Promise<Room[]> {
    return Promise.all(
      rooms.map(async (room) => {
        const roomBase = `${base}.rooms.${toDeviceObjectId(room.id)}`;
        const floorRoomBase = `${base}.map.floors.${toDeviceObjectId(mapId)}.rooms.${toDeviceObjectId(room.id)}`;
        const [floorNameState, nameState, groupState] = await Promise.all([
          this.adapter.getStateAsync(`${floorRoomBase}.name`),
          this.adapter.getStateAsync(`${roomBase}.name`),
          this.adapter.getStateAsync(`${roomBase}.group`),
        ]);
        const floorName =
          typeof floorNameState?.val === "string"
            ? floorNameState.val.trim()
            : "";
        const configuredName = this.configuredRoomName(`${floorRoomBase}.name`);
        const robotId = [...this.robotObjectIds].find(
          ([, objectId]) => base === `devices.${objectId}`,
        )?.[0];
        const floor = robotId
          ? this.floorSnapshots.get(robotId)?.get(mapId)
          : undefined;
        const cachedName = floor?.rooms.find(
          (item) => item.id === room.id,
        )?.displayName;
        const storedName =
          configuredName ||
          floorName ||
          cachedName ||
          (typeof nameState?.val === "string" ? nameState.val.trim() : "");
        const storedGroup =
          typeof groupState?.val === "string" ? groupState.val.trim() : "";
        return {
          ...room,
          displayName: storedName || room.displayName,
          groupId: storedGroup || room.groupId,
        };
      }),
    );
  }

  private async createRobot(robot: RobotDescriptor): Promise<void> {
    const id = this.requireObjectId(robot.id);
    const oldRawObjects = await this.adapter.getForeignObjectsAsync(
      `${this.adapter.namespace}.devices.${id}.info.*`,
      "state",
    );
    for (const fullId of Object.keys(oldRawObjects)) {
      if (fullId.endsWith(".raw")) {
        await this.adapter.delObjectAsync(
          fullId.slice(this.adapter.namespace.length + 1),
        );
      }
    }
    await this.adapter.extendObjectAsync(`devices.${id}`, {
      type: "device",
      common: { name: robot.name },
      native: {
        deviceId: robot.id,
        model: robot.model,
        modelCode: robot.modelCode,
        deviceClass: robot.deviceClass,
      },
    });
    await this.adapter.extendObjectAsync(`devices.${id}.info`, {
      type: "channel",
      common: { name: this.localizedName("Informationen") },
      native: {},
    });
    await this.adapter.extendObjectAsync(`devices.${id}.info.connection`, {
      type: "state",
      common: {
        name: this.localizedName("Verbindung"),
        type: "boolean",
        role: "indicator.connected",
        read: true,
        write: false,
      },
      native: {},
    });
    await this.adapter.extendObjectAsync(`devices.${id}.info.device`, {
      type: "channel",
      common: { name: this.localizedName("Geräteinformationen") },
      native: {},
    });
    await this.createReadonlyState(
      `devices.${id}.info.device.deviceImageURL`,
      "URL zum Gerätebild",
      "string",
      "text.url",
    );
    await this.adapter.setStateAsync(
      `devices.${id}.info.device.deviceImageURL`,
      this.deviceImageUrl(robot.raw),
      true,
    );
    await this.adapter.extendObjectAsync(`devices.${id}.map`, {
      type: "channel",
      common: { name: this.localizedName("Karte") },
      native: {},
    });
    await this.adapter.extendObjectAsync(`devices.${id}.map.multiFloor`, {
      type: "channel",
      common: { name: this.localizedName("Mehrgeschosskarten") },
      native: {},
    });
    await this.createReadonlyState(
      `devices.${id}.map.multiFloor.enabled`,
      "Mehrgeschosskarten aktiviert",
      "boolean",
      "indicator",
      true,
    );
    await this.createReadonlyState(
      `devices.${id}.map.multiFloor.activeId`,
      "ID der aktiven Etage",
      "string",
      "text",
      true,
    );
    await this.createReadonlyState(
      `devices.${id}.map.multiFloor.activeName`,
      "Name der aktiven Etage",
      "string",
      "text",
    );
    await this.createReadonlyState(
      `devices.${id}.map.multiFloor.count`,
      "Anzahl der Etagen",
      "number",
      "value",
      true,
    );
    await this.createReadonlyState(
      `devices.${id}.map.multiFloor.list`,
      "Liste der Etagen",
      "string",
      "json",
      true,
    );
    await this.adapter.extendObjectAsync(
      `devices.${id}.map.multiFloor.selectedId`,
      {
        type: "state",
        common: {
          name: this.localizedName("Anzuzeigende Etage"),
          type: "string",
          role: "value",
          read: true,
          write: true,
          def: "",
          states: { "": "Automatisch" },
        },
        native: {},
      },
    );
    const selectedFloorState = await this.adapter.getStateAsync(
      `devices.${id}.map.multiFloor.selectedId`,
    );
    this.selectedFloorIds.set(
      robot.id,
      typeof selectedFloorState?.val === "string"
        ? selectedFloorState.val.trim()
        : "",
    );
    if (!selectedFloorState) {
      await this.adapter.setStateAsync(
        `devices.${id}.map.multiFloor.selectedId`,
        "",
        true,
      );
    }
    await this.adapter.extendObjectAsync(`devices.${id}.map.floors`, {
      type: "channel",
      common: { name: this.localizedName("Etagenkarten"), expert: true },
      native: {},
    });
    await this.adapter.extendObjectAsync(`devices.${id}.map.snapshot`, {
      type: "state",
      common: {
        name: this.localizedName("Normalisierter Kartenschnappschuss"),
        type: "string",
        role: "json",
        read: true,
        write: false,
        expert: true,
      },
      native: {},
    });
    await this.createReadonlyState(
      `devices.${id}.map.id`,
      "Aktuelle Karten-ID",
      "string",
      "text",
    );
    await this.createReadonlyState(
      `devices.${id}.map.robotPosition`,
      "Roboterposition",
      "string",
      "json",
      true,
    );
    await this.createReadonlyState(
      `devices.${id}.map.dockPosition`,
      "Position der Ladestation",
      "string",
      "json",
      true,
    );
    await this.createReadonlyState(
      `devices.${id}.map.rooms`,
      "Räume",
      "string",
      "json",
      true,
    );
    await this.createReadonlyState(
      `devices.${id}.map.trail`,
      "Live-Fahrspur",
      "string",
      "json",
    );
    await this.createReadonlyState(
      `devices.${id}.map.svg`,
      "SVG-Karte",
      "string",
      "html",
    );
    await this.createReadonlyState(
      `devices.${id}.map.html`,
      "Interaktive HTML-Karte",
      "string",
      "html",
    );
    await this.adapter.extendObjectAsync(`devices.${id}.map.rotation`, {
      type: "state",
      common: {
        name: this.localizedName("Kartendrehung"),
        type: "number",
        role: "level",
        unit: "°",
        read: true,
        write: true,
        min: 0,
        max: 270,
        step: 90,
        def: 0,
      },
      native: {},
    });
    const rotationState = await this.adapter.getStateAsync(
      `devices.${id}.map.rotation`,
    );
    const rotation = this.renderer.normalizeRotation(
      Number(rotationState?.val ?? 0),
    );
    this.rotations.set(robot.id, rotation);
    if (!rotationState) {
      await this.adapter.setStateAsync(
        `devices.${id}.map.rotation`,
        rotation,
        true,
      );
    }
    await this.adapter.extendObjectAsync(`devices.${id}.rooms`, {
      type: "channel",
      common: { name: this.localizedName("Räume") },
      native: {},
    });
    await this.createControlObjects(id);
    await this.createHistoryObjects(id);
    await this.createDeviceInfoObjects(robot, id);
    await this.createStatusObjects(id);
    await this.createAppearanceObjects(robot, id);
    await this.restoreSnapshot(robot.id, id);
  }

  private async createAppearanceObjects(
    robot: RobotDescriptor,
    objectId: string,
  ): Promise<void> {
    const base = `devices.${objectId}.appearance`;
    await this.adapter.extendObjectAsync(base, {
      type: "channel",
      common: { name: this.localizedName("Darstellung") },
      native: {},
    });
    await this.adapter.extendObjectAsync(`${base}.robotSize`, {
      type: "state",
      common: {
        name: this.localizedName("Größe der Robotermarkierung"),
        type: "number",
        role: "level",
        unit: "%",
        read: true,
        write: true,
        min: 0.5,
        max: 10,
        step: 0.1,
        def: 1.8,
      },
      native: {},
    });
    await this.adapter.extendObjectAsync(`${base}.robotImageURL`, {
      type: "state",
      common: {
        name: this.localizedName("Bild-URL der Robotermarkierung"),
        type: "string",
        role: "text.url",
        read: true,
        write: true,
        def: "",
      },
      native: {},
    });
    const [sizeState, urlState] = await Promise.all([
      this.adapter.getStateAsync(`${base}.robotSize`),
      this.adapter.getStateAsync(`${base}.robotImageURL`),
    ]);
    const defaultUrl = this.deviceImageUrl(robot.raw);
    const robotSizePercent = this.normalizeRobotSize(sizeState?.val);
    const robotImageUrl =
      typeof urlState?.val === "string" ? urlState.val.trim() : defaultUrl;
    this.appearances.set(robot.id, { robotSizePercent, robotImageUrl });
    if (!sizeState) {
      await this.adapter.setStateAsync(
        `${base}.robotSize`,
        robotSizePercent,
        true,
      );
    }
    if (!urlState) {
      await this.adapter.setStateAsync(
        `${base}.robotImageURL`,
        robotImageUrl,
        true,
      );
    }
  }

  private async handleAppearanceChange(
    robotId: string,
    objectId: string,
    property: string,
    value: unknown,
  ): Promise<void> {
    const current = this.appearances.get(robotId) ?? {
      robotSizePercent: 1.8,
      robotImageUrl: "",
    };
    if (property === "robotSize") {
      current.robotSizePercent = this.normalizeRobotSize(value);
    } else if (property === "robotImageURL") {
      current.robotImageUrl =
        typeof value === "string" || typeof value === "number"
          ? String(value).trim()
          : "";
    } else {
      return;
    }
    this.appearances.set(robotId, current);
    await this.adapter.setStateAsync(
      `devices.${objectId}.appearance.${property}`,
      property === "robotSize"
        ? current.robotSizePercent
        : current.robotImageUrl,
      true,
    );
    const snapshot = this.latestSnapshots.get(robotId);
    if (snapshot) {
      await this.writeSnapshot(robotId, snapshot);
    }
  }

  private normalizeRobotSize(value: unknown): number {
    const size = Number(value);
    return Number.isFinite(size) ? Math.max(0.5, Math.min(10, size)) : 1.8;
  }

  private deviceImageUrl(raw: Record<string, unknown>): string {
    for (const key of [
      "deviceImageURL",
      "deviceImageUrl",
      "imageUrl",
      "imageURL",
    ]) {
      if (typeof raw[key] === "string" && raw[key].trim()) {
        return raw[key].trim();
      }
    }
    return "";
  }

  private async setDeviceImageUrl(robotId: string, url: string): Promise<void> {
    await this.robotReady.get(robotId);
    const objectId = this.requireObjectId(robotId);
    await this.adapter.setStateAsync(
      `devices.${objectId}.info.device.deviceImageURL`,
      url,
      true,
    );
  }

  private async setRobotTelemetry(
    robotId: string,
    path: string,
    value: string | number | boolean | Record<string, unknown> | unknown[],
  ): Promise<void> {
    await this.robotReady.get(robotId);
    if (!this.robotObjectIds.has(robotId) || !/^[A-Za-z0-9_.]+$/.test(path)) {
      return;
    }
    const objectId = this.requireObjectId(robotId);
    if (path === "supplies.moppingActive" && typeof value === "boolean") {
      this.moppingActive.set(robotId, value);
    }
    if (path === "cleaning.currentSpotAreas") {
      const roomIds = this.parseRoomIds(value);
      if (roomIds.length) {
        this.currentSpotAreaIds.set(robotId, roomIds);
      } else {
        this.currentSpotAreaIds.delete(robotId);
      }
    }
    if (path === "cleaning.currentCustomAreaValues") {
      const coordinates = this.parseCoordinates(value);
      if (coordinates) {
        this.customAreaCoordinatesAt.set(robotId, Date.now());
        await this.activateCustomArea(robotId, coordinates);
      }
    }
    if (
      (path === "station.autoEmptyEnabled" ||
        path === "station.autoEmpty.autoEmptyEnabled") &&
      typeof value === "boolean"
    ) {
      if (value) {
        this.autoEmptyEnabled.add(robotId);
      } else {
        this.autoEmptyEnabled.delete(robotId);
      }
    }
    if (
      path === "station.autoEmpty.stationActive" &&
      typeof value === "boolean"
    ) {
      const wasActive = this.autoEmptyActive.has(robotId);
      if (value) {
        this.autoEmptyActive.add(robotId);
        // Publish one auto-empty event per station cycle. Some stations keep
        // this bit set while the following waste-water drain is already
        // running; repeatedly treating it as authoritative would mislabel
        // that drain as another dust-bin emptying.
        if (!wasActive && !this.inferredAutoEmpty.has(robotId)) {
          this.inferredAutoEmpty.add(robotId);
          await this.updateRobotStatus(robotId, "emptying");
        }
      } else if (wasActive) {
        this.autoEmptyActive.delete(robotId);
        const runtime = this.runtimeStatuses.get(robotId) ?? {};
        // Some OMNI stations expose auto-empty through the generic "washing"
        // station flag. Clear that stale flag when auto-empty ends so the
        // following charging/drying state can become visible.
        if (
          this.classifyStatus(String(runtime.station ?? "")) === "washing" &&
          (await this.cleaningActivity(robotId)) === "Saugt"
        ) {
          runtime.station = "";
        }
        const effective = this.effectiveRuntimeStatus(
          runtime,
          "charge",
          this.cleaningActive.has(robotId),
        );
        if (effective) {
          await this.updateRobotStatus(robotId, effective);
        }
      }
    }
    if (
      this.hiddenTelemetryPaths.has(path) ||
      path === "raw" ||
      path.endsWith(".raw")
    ) {
      const hiddenId = `devices.${objectId}.info.${path}`;
      if (await this.adapter.getObjectAsync(hiddenId)) {
        await this.adapter.delObjectAsync(hiddenId);
      }
      return;
    }
    if (
      path === "station.autoEmptyEnabled" ||
      path === "station.autoEmpty.stationStatus"
    ) {
      const base = `devices.${objectId}.info.consumables`;
      await this.adapter.extendObjectAsync(base, {
        type: "channel",
        common: { name: this.localizedName("Verbrauchsmaterialien") },
        native: {},
      });
      await this.createReadonlyState(
        `${base}.dustBagFull`,
        "Staubbeutel voll",
        "boolean",
        "indicator",
      );
    }
    const segments = path.split(".");
    let parent = `devices.${objectId}.info`;
    for (const segment of segments.slice(0, -1)) {
      parent += `.${segment}`;
      await this.adapter.extendObjectAsync(parent, {
        type: "channel",
        common: {
          name: this.localizedName(this.telemetryChannelName(segment)),
        },
        native: {},
      });
    }
    const scalar =
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean";
    const consumablePercent =
      path.startsWith("consumables.") &&
      typeof value === "number" &&
      Number.isFinite(value);
    const stateValue = consumablePercent
      ? Math.round(value)
      : scalar
        ? value
        : JSON.stringify(value);
    const type = scalar
      ? (typeof value as "string" | "number" | "boolean")
      : "string";
    const role =
      path === "battery"
        ? "value.battery"
        : scalar
          ? type === "boolean"
            ? "indicator"
            : type === "number"
              ? "value"
              : "text"
          : "json";
    const id = `devices.${objectId}.info.${path}`;
    const states: Record<string, string> | undefined =
      path === "extended.cleaningStation.state"
        ? { 0: "Inaktiv", 1: "Station arbeitet" }
        : path === "extended.cleaningStation.type"
          ? {
              0: "Keine Funktion",
              1: "Modellabhängige Funktion",
              2: "Trocknung",
              3: "Selbstreinigung",
            }
          : path === "extended.cleaningStation.operationCode"
            ? {
                0: "Inaktiv",
                1: "Station arbeitet",
                2: "Trocknung",
                3: "Selbstreinigung",
              }
            : undefined;
    const minutes = [
      "extended.airDryingDuration",
      "extended.airDryingActiveTime",
      "extended.airDryingRemainingTime",
    ].includes(path);
    const firmwareProgress = path === "device.firmware.progress";
    const percent = consumablePercent;
    const squareMeters =
      path === "statistics.current.cleanedArea" ||
      path === "statistics.lastCleaning.squareMeters";
    const seconds = path === "statistics.current.cleanedSeconds";
    const expert = path === "extended.airDryingStartTimestamp";
    if (type !== "number") {
      await this.removeNumericLimits(id);
    }
    await this.adapter.extendObjectAsync(id, {
      type: "state",
      common: {
        name: this.localizedName(this.telemetryStateName(path)),
        type,
        role,
        read: true,
        write: false,
        ...(states ? { states } : {}),
        ...(minutes ? { unit: "min" } : {}),
        ...(percent || firmwareProgress ? { unit: "%", min: 0, max: 100 } : {}),
        ...(percent ? { step: 1 } : {}),
        ...(squareMeters ? { unit: "m²" } : {}),
        ...(seconds ? { unit: "s" } : {}),
        ...(expert ? { expert: true as const } : {}),
        ...(path === "battery" ? { unit: "%", min: 0, max: 100 } : {}),
      },
      native: {},
    });
    await this.adapter.setStateAsync(id, stateValue, true);
    if (
      path === "extended.airDryingDuration" &&
      typeof value === "number" &&
      value > 0
    ) {
      this.airDryingDurations.set(robotId, value);
      if (this.airDryingStartedAt.has(robotId)) {
        await this.writeAirDryingTimes(robotId);
      }
    }
    if (path === "extended.airDryingActive" && typeof value === "boolean") {
      await this.handleAirDryingTiming(robotId, value);
      if (!value) {
        const runtime = this.runtimeStatuses.get(robotId);
        if (
          runtime &&
          this.classifyStatus(String(runtime.station ?? "")) === "drying"
        ) {
          runtime.station = "";
          runtime.clean = "idle";
          const next = this.effectiveRuntimeStatus(
            runtime,
            "charge",
            this.cleaningActive.has(robotId),
          );
          if (next) {
            await this.updateRobotStatus(robotId, next);
          }
        }
      }
    }
  }

  private async removeNumericLimits(id: string): Promise<void> {
    const object = await this.adapter.getObjectAsync(id);
    if (!object || object.type !== "state") {
      return;
    }
    const common = object.common as ioBroker.StateCommon & {
      min?: number;
      max?: number;
      step?: number;
    };
    if (
      common.min === undefined &&
      common.max === undefined &&
      common.step === undefined
    ) {
      return;
    }
    delete common.min;
    delete common.max;
    delete common.step;
    await this.adapter.setObjectAsync(id, object);
  }

  private async handleAirDryingTiming(
    robotId: string,
    active: boolean,
  ): Promise<void> {
    const objectId = this.requireObjectId(robotId);
    const startPath = `devices.${objectId}.info.extended.airDryingStartTimestamp`;
    if (!active) {
      this.clearAirDryingTimer(robotId);
      this.airDryingStartedAt.delete(robotId);
      await Promise.all([
        this.setRobotTelemetry(robotId, "extended.airDryingActiveTime", 0),
        this.setRobotTelemetry(robotId, "extended.airDryingRemainingTime", 0),
        this.setRobotTelemetry(robotId, "extended.airDryingStartTimestamp", 0),
      ]);
      return;
    }
    if (!this.airDryingStartedAt.has(robotId)) {
      const stored = Number((await this.adapter.getStateAsync(startPath))?.val);
      const startedAt =
        Number.isFinite(stored) && stored > 0 ? stored : Date.now();
      this.airDryingStartedAt.set(robotId, startedAt);
      if (!(stored > 0)) {
        await this.setRobotTelemetry(
          robotId,
          "extended.airDryingStartTimestamp",
          startedAt,
        );
      }
    }
    await this.writeAirDryingTimes(robotId);
    if (!this.airDryingTimers.has(robotId)) {
      const timer = this.adapter.setInterval(
        () => void this.writeAirDryingTimes(robotId),
        60_000,
      );
      if (timer !== undefined) {
        this.airDryingTimers.set(robotId, timer);
      }
    }
  }

  private async writeAirDryingTimes(robotId: string): Promise<void> {
    const startedAt = this.airDryingStartedAt.get(robotId);
    if (!startedAt || !this.robotObjectIds.has(robotId)) {
      return;
    }
    const duration = this.airDryingDurations.get(robotId) ?? 120;
    const activeTime = Math.max(
      0,
      Math.floor((Date.now() - startedAt) / 60_000),
    );
    await Promise.all([
      this.setRobotTelemetry(
        robotId,
        "extended.airDryingActiveTime",
        activeTime,
      ),
      this.setRobotTelemetry(
        robotId,
        "extended.airDryingRemainingTime",
        Math.max(0, duration - activeTime),
      ),
    ]);
  }

  private clearAirDryingTimer(robotId: string): void {
    const timer = this.airDryingTimers.get(robotId);
    if (timer) {
      this.adapter.clearInterval(timer);
    }
    this.airDryingTimers.delete(robotId);
  }

  private isAirDryingActive(robotId: string): boolean {
    const startedAt = this.airDryingStartedAt.get(robotId);
    if (!startedAt) {
      return false;
    }
    const durationMinutes = this.airDryingDurations.get(robotId) ?? 0;
    return (
      durationMinutes <= 0 || Date.now() - startedAt < durationMinutes * 60_000
    );
  }

  private telemetryChannelName(segment: string): string {
    const names: Record<string, string> = {
      extended: "Erweiterte Informationen",
      cleaningStation: "Reinigungsstation",
      cleaning: "Aktuelle Reinigung",
      consumables: "Verbrauchsmaterialien",
      statistics: "Reinigungsstatistik",
      current: "Aktuelle Reinigung",
      lastCleaning: "Letzte Reinigung",
      supplies: "Behälter und Wischsystem",
      station: "Station",
      autoEmpty: "Automatische Entleerung",
      settings: "Einstellungen",
      sensors: "Sensoren und Erkennung",
      device: "Geräteinformationen",
      firmware: "Firmware",
      network: "Netzwerk",
      system: "Systeminformationen",
    };
    return names[segment] ?? segment;
  }

  private telemetryStateName(path: string): string {
    const names: Record<string, string> = {
      battery: "Akkustand",
      chargeStatus: "Ladestatus",
      cleanStatus: "Reinigungsstatus",
      "extended.currentSchedule": "Aktuelle Zeitpläne",
      "extended.washInterval": "Waschintervall",
      "extended.airDryingState": "Trocknungsstatus",
      "extended.airDryingActive": "Trocknung aktiv",
      "extended.airDryingDuration": "Trocknungsdauer",
      "extended.airDryingActiveTime": "Bisherige Trocknungszeit",
      "extended.airDryingRemainingTime": "Verbleibende Trocknungszeit",
      "extended.airDryingStartTimestamp": "Startzeitpunkt der Trocknung",
      "extended.cleaningStationActive": "Reinigungsstation aktiv",
      "extended.selfCleaningActive": "Selbstreinigung aktiv",
      "extended.particleRemoval": "Partikelentfernung aktiv",
      "extended.petPoopAvoidance": "Tierkot-Erkennung aktiv",
      "extended.cleaningStation.state": "Stationsaktivität",
      "extended.cleaningStation.type": "Typ des Stationsvorgangs",
      "extended.cleaningStation.operationCode": "Stationsvorgang als Zahl",
      "extended.cleaningStation.operation": "Stationsvorgang als Text",
      "extended.cleaningStation.infoState":
        "Informationsstatus der Reinigungsstation",
      "extended.cleaningStation.name": "Name der Reinigungsstation",
      "extended.cleaningStation.model": "Modell der Reinigungsstation",
      "extended.cleaningStation.serialNumber":
        "Seriennummer der Reinigungsstation",
      "extended.cleaningStation.firmwareVersion":
        "Firmwareversion der Reinigungsstation",
      "extended.waterStatus": "Wasserstatus",
      "extended.errorCode": "Fehlercode",
      "extended.errorMessage": "Fehlermeldung",
      "extended.freshWaterEmpty": "Frischwassertank leer",
      "extended.wasteWaterFull": "Schmutzwassertank voll",
      "extended.batteryLow": "Akkustand niedrig",
      "consumables.mainBrush": "Hauptbürste verbleibend",
      "consumables.sideBrush": "Seitenbürste verbleibend",
      "consumables.filter": "Filter verbleibend",
      "consumables.unitCare": "Roboterwartung verbleibend",
      "consumables.roundMop": "Wischmopps verbleibend",
      "consumables.dustBagFull": "Staubbeutel voll",
      "consumables.freshWaterEmpty": "Frischwassertank leer",
      "consumables.wasteWaterFull": "Schmutzwassertank voll",
      "consumables.airFreshener": "Lufterfrischer verbleibend",
      "statistics.cleaningLog": "Reinigungsprotokoll",
      "supplies.waterTankInstalled": "Wasserbehälter eingesetzt",
      "supplies.moppingType": "Wischsystemtyp",
      "supplies.moppingActive": "Wischsystem eingesetzt",
      "cleaning.currentSpotAreas": "Aktuell ausgewählte Raum-IDs",
      "device.firmware.autoSwitch": "Automatische Firmware-Aktualisierung",
      "device.firmware.isForce": "Erzwungenes Firmware-Update",
      "device.firmware.progress": "Fortschritt der Firmware-Aktualisierung",
      "device.firmware.result": "Firmware-Ergebniscode",
      "device.firmware.resultText": "Firmware-Ergebnis",
      "device.firmware.status": "Status der Firmware-Aktualisierung",
      "device.firmware.supportAuto": "Automatische Aktualisierung unterstützt",
      "device.firmware.ver": "Firmwareversion",
      "device.firmware.raw": "Firmware-Rohdaten",
      "supplies.scrubbingType": "Wischmuster",
      "supplies.dustBinInstalled": "Staubbehälter eingesetzt",
      "station.autoEmptyEnabled": "Automatische Entleerung aktiviert",
      "station.autoEmpty.stationStatus": "Status der automatischen Entleerung",
      "station.autoEmpty.stationActive": "Automatische Entleerung läuft",
      "station.autoEmpty.dustBagFull": "Staubbeutel voll",
      "statistics.current.cleanedArea": "Aktuell gereinigte Fläche",
      "statistics.current.cleanedSeconds": "Aktuelle Reinigungsdauer",
      "statistics.current.cleanType": "Aktuelle Reinigungsart",
      "statistics.lastCleaning.timestamp": "Zeitpunkt der letzten Reinigung",
      "statistics.lastCleaning.squareMeters": "Fläche der letzten Reinigung",
      "statistics.lastCleaning.totalTime": "Dauer der letzten Reinigung",
      "statistics.lastCleaning.totalTimeFormatted":
        "Formatierte Dauer der letzten Reinigung",
      "statistics.lastCleaning.imageUrl": "Kartenbild der letzten Reinigung",
      "device.network.ip": "IP-Adresse",
      "device.network.mac": "MAC-Adresse",
      "device.network.wifiSSID": "WLAN-Name",
      "device.network.wifiSignal": "WLAN-Signalstärke",
      "settings.childLock": "Kindersicherung",
      "settings.doNotDisturbEnabled": "Nicht-stören aktiviert",
      "settings.doNotDisturbTime": "Nicht-stören-Zeitraum",
      "sensors.carpetBoost": "Saugkraftanhebung auf Teppichen",
      "sensors.carpetStrategy": "Teppichstrategie",
      "sensors.obstacleDetection": "Hinderniserkennung",
    };
    return names[path] ?? path.split(".").at(-1) ?? path;
  }

  private async restoreSnapshot(
    robotId: string,
    objectId: string,
  ): Promise<void> {
    const state = await this.adapter.getStateAsync(
      `devices.${objectId}.map.snapshot`,
    );
    if (typeof state?.val !== "string" || !state.val.trim()) {
      return;
    }
    try {
      const value = JSON.parse(state.val) as Partial<MapSnapshot>;
      if (!value || typeof value !== "object" || !Array.isArray(value.rooms)) {
        return;
      }
      const snapshot: MapSnapshot = {
        robotId,
        mapId: typeof value.mapId === "string" ? value.mapId : "restored",
        revision: Number.isFinite(Number(value.revision))
          ? Number(value.revision)
          : 0,
        rooms: value.rooms,
        robotPosition: value.robotPosition ?? null,
        dockPosition: value.dockPosition ?? null,
        svg: typeof value.svg === "string" ? value.svg : "",
        updatedAt:
          typeof value.updatedAt === "string"
            ? value.updatedAt
            : new Date().toISOString(),
      };
      this.latestSnapshots.set(robotId, snapshot);
      await this.writeSnapshot(robotId, snapshot);
      this.adapter.log.debug(`Restored cached map for ${objectId}`);
    } catch (error) {
      this.adapter.log.warn(
        `Cannot restore cached map for ${objectId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async ensureRoomObjects(base: string, rooms: Room[]): Promise<void> {
    for (const room of rooms) {
      const id = toDeviceObjectId(room.id);
      const path = `${base}.rooms.${id}`;
      await this.adapter.extendObjectAsync(path, {
        type: "channel",
        common: { name: room.displayName },
        native: { roomId: room.id },
      });
      await this.adapter.extendObjectAsync(`${path}.name`, {
        type: "state",
        common: {
          name: this.localizedName("Raumname"),
          type: "string",
          role: "text",
          read: true,
          write: true,
        },
        native: {},
      });
      await this.adapter.extendObjectAsync(`${path}.group`, {
        type: "state",
        common: {
          name: this.localizedName("Raumgruppe"),
          type: "string",
          role: "text",
          read: true,
          write: true,
          def: "",
        },
        native: {},
      });
      await this.createButton(`${path}.clean`, "Raum reinigen");
      await this.adapter.extendObjectAsync(`${path}.selected`, {
        type: "state",
        common: {
          name: this.localizedName("Für Raumreinigung ausgewählt"),
          type: "boolean",
          role: "switch",
          read: true,
          write: true,
          def: false,
        },
        native: {},
      });
      await this.createReadonlyState(
        `${path}.ecovacsName`,
        "Ecovacs-Raumname",
        "string",
        "text",
        true,
      );
      await this.createReadonlyState(
        `${path}.polygon`,
        "Raumumriss",
        "string",
        "json",
        true,
      );
      await this.createReadonlyState(
        `${path}.center`,
        "Raummittelpunkt",
        "string",
        "json",
        true,
      );
      await this.createReadonlyState(
        `${path}.groupId`,
        "Raumgruppe",
        "string",
        "text",
        true,
      );
      await Promise.all([
        this.adapter.setStateAsync(`${path}.name`, room.displayName, true),
        this.adapter.setStateAsync(`${path}.group`, room.groupId ?? "", true),
        this.adapter.setStateAsync(
          `${path}.ecovacsName`,
          room.ecovacsName,
          true,
        ),
        this.adapter.setStateAsync(
          `${path}.polygon`,
          JSON.stringify(room.polygon),
          true,
        ),
        this.adapter.setStateAsync(
          `${path}.center`,
          JSON.stringify(room.center),
          true,
        ),
        this.adapter.setStateAsync(`${path}.groupId`, room.groupId ?? "", true),
      ]);
    }
  }

  private async handleControlChange(
    robotId: string,
    objectId: string,
    property: string,
    value: unknown,
  ): Promise<void> {
    if (property === "roomIds") {
      const snapshot = this.displayedSnapshot(robotId);
      if (!snapshot) {
        return;
      }
      const selected = new Set(this.parseRoomIds(value));
      await Promise.all(
        snapshot.rooms.map((room) =>
          this.adapter.setStateAsync(
            `devices.${objectId}.rooms.${toDeviceObjectId(room.id)}.selected`,
            selected.has(room.id),
            true,
          ),
        ),
      );
      await this.adapter.setStateAsync(
        `devices.${objectId}.control.roomIds`,
        JSON.stringify([...selected]),
        true,
      );
      await this.writeSnapshot(
        robotId,
        snapshot,
        snapshot.isCurrentMap !== false,
      );
      return;
    }
    if (
      property === "repetitions" ||
      property === "lastCommand" ||
      property === "lastError"
    ) {
      return;
    }
    if (!this.isTrue(value)) {
      return;
    }
    let command: RobotCommand;
    if (property === "cleanRooms" || property === "cleanMarkedSpotAreas") {
      const roomIdsState = await this.adapter.getStateAsync(
        `devices.${objectId}.control.roomIds`,
      );
      command = {
        type: "cleanRooms",
        roomIds: this.parseRoomIds(roomIdsState?.val),
        repetitions: await this.getRepetitions(objectId),
      };
    } else if (
      ["cleanAll", "pause", "resume", "stop", "charge"].includes(property)
    ) {
      command = {
        type: property as "cleanAll" | "pause" | "resume" | "stop" | "charge",
      };
    } else {
      return;
    }
    await this.executeCommand(robotId, objectId, command);
    await this.adapter.setStateAsync(
      `devices.${objectId}.control.${property}`,
      false,
      true,
    );
  }

  private async getSelectedRoomIds(
    base: string,
    rooms: Room[],
  ): Promise<string[]> {
    const selected = await Promise.all(
      rooms.map(async (room) => ({
        id: room.id,
        state: await this.adapter.getStateAsync(
          `${base}.rooms.${toDeviceObjectId(room.id)}.selected`,
        ),
      })),
    );
    return selected
      .filter((item) => this.isTrue(item.state?.val))
      .map((item) => item.id);
  }

  private async clearSelectedRooms(robotId: string): Promise<void> {
    const snapshot = this.displayedSnapshot(robotId);
    if (!snapshot || !this.robotObjectIds.has(robotId)) {
      return;
    }
    const base = `devices.${this.requireObjectId(robotId)}`;
    const selected = await this.getSelectedRoomIds(base, snapshot.rooms);
    if (!selected.length) {
      return;
    }
    await Promise.all(
      selected.map((id) =>
        this.adapter.setStateAsync(
          `${base}.rooms.${toDeviceObjectId(id)}.selected`,
          false,
          true,
        ),
      ),
    );
    await this.adapter.setStateAsync(`${base}.control.roomIds`, "[]", true);
    await this.writeSnapshot(
      robotId,
      snapshot,
      snapshot.isCurrentMap !== false,
    );
  }

  private async executeCommand(
    robotId: string,
    objectId: string,
    command: RobotCommand,
  ): Promise<boolean> {
    try {
      if (command.type === "cleanRooms") {
        this.commandedRoomIds.set(robotId, [...command.roomIds]);
      } else if (
        ["cleanAll", "cleanCustomArea", "stop", "charge"].includes(command.type)
      ) {
        this.commandedRoomIds.delete(robotId);
      }
      this.events.emit("robot:command", { robotId, command });
      if (command.type === "cleanRooms" || command.type === "cleanAll") {
        await this.startLocalCleaningRun(
          robotId,
          command.type === "cleanRooms" ? "spot_area" : "cleaning",
        );
      }
      if (command.type === "charge") {
        await this.clearSelectedRooms(robotId);
      }
      await this.adapter.setStateAsync(
        `devices.${objectId}.control.lastCommand`,
        JSON.stringify(command),
        true,
      );
      await this.adapter.setStateAsync(
        `devices.${objectId}.control.lastError`,
        "",
        true,
      );
      return true;
    } catch (error) {
      if (command.type === "cleanRooms") {
        this.commandedRoomIds.delete(robotId);
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.adapter.setStateAsync(
        `devices.${objectId}.control.lastError`,
        message,
        true,
      );
      this.adapter.log.warn(`Command failed for ${objectId}: ${message}`);
      return false;
    }
  }

  private parseRoomIds(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    const text =
      typeof value === "string" || typeof value === "number"
        ? String(value).trim()
        : "";
    if (!text) {
      return [];
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch {
      /* Accept comma-separated room IDs too. */
    }
    return text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private async getRepetitions(objectId: string): Promise<1 | 2> {
    const state = await this.adapter.getStateAsync(
      `devices.${objectId}.control.repetitions`,
    );
    return Number(state?.val) === 2 ? 2 : 1;
  }

  private isTrue(value: unknown): boolean {
    return value === true || value === 1 || value === "1" || value === "true";
  }

  private async createControlObjects(objectId: string): Promise<void> {
    const base = `devices.${objectId}.control`;
    await this.adapter.extendObjectAsync(base, {
      type: "channel",
      common: { name: this.localizedName("Steuerung") },
      native: {},
    });
    await this.createButton(`${base}.cleanAll`, "Alles reinigen");
    await this.createButton(`${base}.cleanRooms`, "Ausgewählte Räume reinigen");
    await this.createButton(
      `${base}.cleanMarkedSpotAreas`,
      "Markierte Räume reinigen",
    );
    await this.createButton(`${base}.pause`, "Pausieren");
    await this.createButton(`${base}.resume`, "Fortsetzen");
    await this.createButton(`${base}.stop`, "Stoppen");
    await this.createButton(`${base}.charge`, "Zur Ladestation zurückkehren");
    await this.adapter.extendObjectAsync(`${base}.roomIds`, {
      type: "state",
      common: {
        name: this.localizedName("Raum-IDs"),
        type: "string",
        role: "json",
        read: true,
        write: true,
        def: "[]",
        expert: true,
      },
      native: {},
    });
    await this.adapter.extendObjectAsync(`${base}.repetitions`, {
      type: "state",
      common: {
        name: this.localizedName("Reinigungswiederholungen"),
        type: "number",
        role: "level",
        read: true,
        write: true,
        min: 1,
        max: 2,
        step: 1,
        def: 1,
      },
      native: {},
    });
    await this.createReadonlyState(
      `${base}.lastCommand`,
      "Letzter Befehl",
      "string",
      "json",
      true,
    );
    await this.createReadonlyState(
      `${base}.lastError`,
      "Letzter Befehlsfehler",
      "string",
      "text",
      true,
    );
  }

  private async createCleaningSettings(
    robotId: string,
    capabilities: RobotCapabilities,
  ): Promise<void> {
    await this.robotReady.get(robotId);
    const base = `devices.${this.requireObjectId(robotId)}.control.cleaning`;
    await this.adapter.extendObjectAsync(base, {
      type: "channel",
      common: { name: this.localizedName("Reinigungseinstellungen") },
      native: {},
    });
    const definitions: Record<
      RobotSettingName,
      { name: string; min: number; max: number; states: Record<string, string> }
    > = {
      cleanCount: {
        name: "Anzahl der Reinigungsdurchgänge",
        min: 1,
        max: 2,
        states: { 1: "einmal", 2: "zweimal" },
      },
      cleanSpeed: {
        name: "Saugstärke",
        min: 1,
        max: 4,
        states: { 1: "niedrig", 2: "normal", 3: "hoch", 4: "maximal" },
      },
      moppingMode: {
        name: "Wischmodus",
        min: 0,
        max: 2,
        states: { 0: "Standard", 1: "gründlich", 2: "intensiv" },
      },
      waterLevel: {
        name: "Wassermenge",
        min: 1,
        max: 4,
        states: {
          1: "niedrig",
          2: "mittel",
          3: "hoch",
          4: "sehr hoch",
        },
      },
      cleaningMode: {
        name: "Reinigungsmodus",
        min: 0,
        max: 3,
        states: {
          0: "Saugen und Wischen",
          1: "nur Saugen",
          2: "nur Wischen",
          3: "Wischen nach dem Saugen",
        },
      },
    };
    for (const setting of Object.keys(definitions) as RobotSettingName[]) {
      if (!capabilities[setting]) {
        continue;
      }
      const definition = definitions[setting];
      await this.adapter.extendObjectAsync(`${base}.${setting}`, {
        type: "state",
        common: {
          name: this.localizedName(definition.name),
          type: "number",
          role: "level",
          read: true,
          write: true,
          min: definition.min,
          max: definition.max,
          step: 1,
          states: definition.states,
        },
        native: {},
      });
    }
  }

  private async setRobotSetting(
    robotId: string,
    setting: RobotSettingName,
    value: number,
  ): Promise<void> {
    if (!this.robotObjectIds.has(robotId)) {
      return;
    }
    await this.robotReady.get(robotId);
    if (!this.robotObjectIds.has(robotId)) {
      return;
    }
    const capabilities = this.robotCapabilities.get(robotId) ?? {
      cleanSpeed: false,
      waterLevel: false,
      cleanCount: false,
      moppingMode: false,
      cleaningMode: false,
      customArea: false,
    };
    capabilities[setting] = true;
    this.robotCapabilities.set(robotId, capabilities);
    await this.createCleaningSettings(robotId, capabilities);
    await this.adapter.setStateAsync(
      `devices.${this.requireObjectId(robotId)}.control.cleaning.${setting}`,
      value,
      true,
    );
  }

  private async createHistoryObjects(objectId: string): Promise<void> {
    const base = `devices.${objectId}.history`;
    await this.adapter.extendObjectAsync(base, {
      type: "channel",
      common: { name: this.localizedName("Verlauf und Live-Bericht") },
      native: {},
    });
    await this.createButton(`${base}.clear`, "Reinigungsverlauf löschen");
    await this.createReadonlyState(
      `${base}.count`,
      "Anzahl gespeicherter Verlaufsereignisse",
      "number",
      "value",
    );
    await this.createReadonlyState(
      `${base}.events`,
      "Reinigungsverlauf",
      "string",
      "json",
    );
    await this.adapter.extendObjectAsync(`${base}.maxEntries`, {
      type: "state",
      common: {
        name: this.localizedName("Maximale Anzahl der Verlaufsereignisse"),
        type: "number",
        role: "level",
        read: true,
        write: true,
        def: 100,
        min: 10,
        max: 500,
        step: 10,
      },
      native: {},
    });
    await this.createReadonlyState(
      `${base}.current`,
      "Aktueller Live-Bericht",
      "string",
      "text",
    );
    await this.createReadonlyState(
      `${base}.lastEvent`,
      "Letztes Berichtsereignis",
      "string",
      "text",
    );
    await this.createReadonlyState(
      `${base}.lastEventTime`,
      "Zeitpunkt des letzten Berichtsereignisses",
      "number",
      "date",
    );
    await this.createReadonlyState(
      `${base}.sequence`,
      "Laufende Nummer des Berichtsereignisses",
      "number",
      "value",
      true,
    );
    const [events, maximum] = await Promise.all([
      this.adapter.getStateAsync(`${base}.events`),
      this.adapter.getStateAsync(`${base}.maxEntries`),
    ]);
    if (!events) {
      await this.adapter.setStateAsync(`${base}.events`, "[]", true);
    }
    if (!maximum) {
      await this.adapter.setStateAsync(`${base}.maxEntries`, 100, true);
    }
    const parsed = this.parseHistory(events?.val);
    await this.adapter.setStateAsync(`${base}.count`, parsed.length, true);
    const [
      current,
      lastEvent,
      lastEventTime,
      sequence,
      oldCurrent,
      oldLastEvent,
      oldLastEventTime,
      oldSequence,
    ] = await Promise.all([
      this.adapter.getStateAsync(`${base}.current`),
      this.adapter.getStateAsync(`${base}.lastEvent`),
      this.adapter.getStateAsync(`${base}.lastEventTime`),
      this.adapter.getStateAsync(`${base}.sequence`),
      this.adapter.getStateAsync(`devices.${objectId}.report.current`),
      this.adapter.getStateAsync(`devices.${objectId}.report.lastEvent`),
      this.adapter.getStateAsync(`devices.${objectId}.report.lastEventTime`),
      this.adapter.getStateAsync(`devices.${objectId}.report.sequence`),
    ]);
    const initializers: Array<Promise<unknown>> = [];
    if (!current) {
      initializers.push(
        this.adapter.setStateAsync(
          `${base}.current`,
          oldCurrent?.val ?? "",
          true,
        ),
      );
    }
    if (!lastEvent) {
      initializers.push(
        this.adapter.setStateAsync(
          `${base}.lastEvent`,
          oldLastEvent?.val ?? "",
          true,
        ),
      );
    }
    if (!lastEventTime) {
      initializers.push(
        this.adapter.setStateAsync(
          `${base}.lastEventTime`,
          oldLastEventTime?.val ?? 0,
          true,
        ),
      );
    }
    if (!sequence) {
      initializers.push(
        this.adapter.setStateAsync(
          `${base}.sequence`,
          oldSequence?.val ?? 0,
          true,
        ),
      );
    }
    await Promise.all(initializers);
    if (await this.adapter.getObjectAsync(`devices.${objectId}.report`)) {
      await this.adapter.delObjectAsync(`devices.${objectId}.report`, {
        recursive: true,
      });
    }
  }

  private async createDeviceInfoObjects(
    robot: RobotDescriptor,
    objectId: string,
  ): Promise<void> {
    const infoBase = `devices.${objectId}.info`;
    await this.createReadonlyState(
      `${infoBase}.robotState`,
      "Roboterstatus",
      "string",
      "text",
    );
    await this.adapter.extendObjectAsync(`${infoBase}.device`, {
      type: "channel",
      common: { name: this.localizedName("Geräteinformationen") },
      native: {},
    });
    await this.createReadonlyState(
      `${infoBase}.device.deviceName`,
      "Erkannter Gerätename",
      "string",
      "text",
    );
    await this.createReadonlyState(
      `${infoBase}.device.model`,
      "Robotermodell",
      "string",
      "text",
    );
    const legacyState = await this.adapter.getStateAsync(
      `devices.${objectId}.status.state`,
    );
    await Promise.all([
      this.adapter.setStateAsync(
        `${infoBase}.device.deviceName`,
        robot.name,
        true,
      ),
      this.adapter.setStateAsync(
        `${infoBase}.device.model`,
        robot.model || "Unbekannt",
        true,
      ),
      this.adapter.setStateAsync(
        `${infoBase}.robotState`,
        legacyState?.val ?? "unknown",
        true,
      ),
    ]);
    for (const path of [
      "device.modelCode",
      "device.deviceClass",
      "consumables.main_brush",
      "consumables.side_brush",
      "consumables.unit_care",
      "consumables.round_mop",
      "consumables.air_freshener",
      "station.autoEmpty.dustBagFull",
      "extended.freshWaterEmpty",
      "extended.wasteWaterFull",
      ...this.hiddenTelemetryPaths,
    ]) {
      const id = `${infoBase}.${path}`;
      if (await this.adapter.getObjectAsync(id)) {
        await this.adapter.delObjectAsync(id);
      }
    }
    if (await this.adapter.getObjectAsync(`${infoBase}.deviceName`)) {
      await this.adapter.delObjectAsync(`${infoBase}.deviceName`);
    }
    if (await this.adapter.getObjectAsync(`${infoBase}.deviceImageURL`)) {
      await this.adapter.delObjectAsync(`${infoBase}.deviceImageURL`);
    }
  }

  private async createStatusObjects(objectId: string): Promise<void> {
    const base = `devices.${objectId}.status`;
    await this.adapter.extendObjectAsync(base, {
      type: "channel",
      common: { name: this.localizedName("Status") },
      native: {},
    });
    for (const [id, name, type, role, expert] of [
      ["compatibility", "Kompatibilitätsstatus", "string", "text", true],
      ["mapId", "Karten-ID", "string", "text", true],
      ["position", "Aktueller Raum", "string", "text", false],
      ["rawPosition", "Unverarbeitete Roboterposition", "string", "text", true],
      ["roomsDetected", "Erkannte Räume", "number", "value", true],
      ["mapDetected", "Kartenbildquelle erkannt", "boolean", "indicator", true],
      [
        "geometryDetected",
        "Raumgeometrie erkannt",
        "boolean",
        "indicator",
        true,
      ],
      [
        "positionDetected",
        "Live-Roboterposition erkannt",
        "boolean",
        "indicator",
        true,
      ],
      [
        "controlsDetected",
        "Reinigungssteuerung erkannt",
        "boolean",
        "indicator",
        true,
      ],
    ] as Array<
      [string, string, "string" | "number" | "boolean", string, boolean]
    >) {
      await this.createReadonlyState(`${base}.${id}`, name, type, role, expert);
    }
    await this.adapter.setStateAsync(`${base}.compatibility`, "ready", true);
    for (const legacyId of ["deviceName", "state"]) {
      if (await this.adapter.getObjectAsync(`${base}.${legacyId}`)) {
        await this.adapter.delObjectAsync(`${base}.${legacyId}`);
      }
    }
  }

  private async createCustomAreaObjects(robotId: string): Promise<void> {
    await this.robotReady.get(robotId);
    const objectId = this.requireObjectId(robotId);
    const base = `devices.${objectId}.customArea`;
    await this.adapter.extendObjectAsync(base, {
      type: "channel",
      common: { name: this.localizedName("Benutzerdefinierter Bereich") },
      native: {},
    });
    await this.adapter.extendObjectAsync(`${base}.active`, {
      type: "state",
      common: {
        name: this.localizedName("Benutzerdefinierten Bereich anzeigen"),
        type: "boolean",
        role: "switch",
        read: true,
        write: true,
        def: false,
      },
      native: {},
    });
    await this.adapter.extendObjectAsync(`${base}.values`, {
      type: "state",
      common: {
        name: this.localizedName(
          "Koordinaten des benutzerdefinierten Bereichs",
        ),
        type: "string",
        role: "text",
        read: true,
        write: true,
        def: "",
      },
      native: {},
    });
    await this.createButton(
      `${base}.start`,
      "Reinigung des benutzerdefinierten Bereichs starten",
    );
    const [active, values, status] = await Promise.all([
      this.adapter.getStateAsync(`${base}.active`),
      this.adapter.getStateAsync(`${base}.values`),
      this.adapter.getStateAsync(`devices.${objectId}.info.robotState`),
    ]);
    const current = {
      active: this.isTrue(active?.val),
      values: String(values?.val ?? ""),
    };
    if (
      current.active &&
      status?.val === "charging" &&
      this.isRobotAtDock(robotId)
    ) {
      current.active = false;
    }
    this.customAreas.set(robotId, current);
    if (!active || this.isTrue(active.val) !== current.active) {
      await this.adapter.setStateAsync(`${base}.active`, current.active, true);
    }
    if (!values) {
      await this.adapter.setStateAsync(`${base}.values`, "", true);
    }
  }

  private async handleCustomAreaChange(
    robotId: string,
    objectId: string,
    property: string,
    value: unknown,
  ): Promise<void> {
    const current = this.customAreas.get(robotId) ?? {
      active: false,
      values: "",
    };
    if (property === "active") {
      current.active = this.isTrue(value);
      if (current.active && !this.parseCoordinates(current.values)) {
        const snapshot = this.latestSnapshots.get(robotId);
        if (snapshot) {
          current.values = this.defaultCustomArea(snapshot);
        }
      }
    } else if (property === "values") {
      const coordinates = this.parseCoordinates(value);
      if (!coordinates) {
        return;
      }
      current.values = coordinates;
    } else if (property === "start") {
      if (!this.isTrue(value)) {
        return;
      }
      const coordinates = this.parseCoordinates(current.values);
      if (coordinates) {
        const now = Date.now();
        const previous = this.lastCustomAreaStarts.get(robotId);
        if (
          previous?.coordinates === coordinates &&
          now - previous.at < 3_000
        ) {
          await this.adapter.setStateAsync(
            `devices.${objectId}.customArea.start`,
            false,
            true,
          );
          return;
        }
        // Store before awaiting the cloud command so two nearly simultaneous
        // VIS writes cannot both start the same custom-area run.
        this.lastCustomAreaStarts.set(robotId, { coordinates, at: now });
        const started = await this.executeCommand(robotId, objectId, {
          type: "cleanCustomArea",
          coordinates,
          repetitions: await this.getRepetitions(objectId),
        });
        if (started) {
          await this.startLocalCleaningRun(robotId, "custom_area");
        } else {
          this.lastCustomAreaStarts.delete(robotId);
        }
      } else {
        await this.adapter.setStateAsync(
          `devices.${objectId}.control.lastError`,
          "Custom area requires four numeric coordinates",
          true,
        );
      }
      await this.adapter.setStateAsync(
        `devices.${objectId}.customArea.start`,
        false,
        true,
      );
      return;
    } else {
      return;
    }
    this.customAreas.set(robotId, current);
    await this.adapter.setStateAsync(
      `devices.${objectId}.customArea.${property}`,
      property === "active" ? current.active : current.values,
      true,
    );
    if (property === "active" && current.active && current.values) {
      await this.adapter.setStateAsync(
        `devices.${objectId}.customArea.values`,
        current.values,
        true,
      );
    }
    const snapshot = this.latestSnapshots.get(robotId);
    if (snapshot) {
      await this.writeSnapshot(robotId, snapshot);
    }
  }

  private async startLocalCleaningRun(
    robotId: string,
    status: string,
  ): Promise<void> {
    this.clearTrailFinishTimer(robotId);
    this.terminalStatuses.delete(robotId);
    this.cleaningStartedAt.set(robotId, Date.now());
    this.lastCleaningSignalAt.set(robotId, Date.now());
    this.lastReturningAt.delete(robotId);
    this.cleaningActive.add(robotId);
    this.trails.set(robotId, []);
    this.currentRooms.delete(robotId);
    this.announcedSpotTargets.delete(robotId);
    this.inferredAutoEmpty.delete(robotId);
    this.returningActive.delete(robotId);
    this.sequentialCleaningPhase.delete(robotId);
    this.finalWaterDrainReported.delete(robotId);
    this.waterCycleActive.delete(robotId);
    await this.initializeCleaningPhase(robotId);
    const snapshotBeforeStart = this.latestSnapshots.get(robotId);
    const wasCharging =
      this.classifyStatus(
        String(this.runtimeStatuses.get(robotId)?.charge ?? ""),
      ) === "charging";
    const position = wasCharging
      ? (snapshotBeforeStart?.dockPosition ??
        snapshotBeforeStart?.robotPosition)
      : (snapshotBeforeStart?.robotPosition ??
        snapshotBeforeStart?.dockPosition);
    if (position) {
      this.addTrailPoint(robotId, position);
    }
    const runtime = this.runtimeStatuses.get(robotId) ?? {};
    runtime.clean = status;
    runtime.charge = "";
    this.runtimeStatuses.set(robotId, runtime);
    await this.updateRobotStatus(robotId, status);
    const snapshot = this.latestSnapshots.get(robotId);
    if (snapshot) {
      await this.writeSnapshot(robotId, snapshot);
    }
  }

  private async activateCustomArea(
    robotId: string,
    coordinates?: string | null,
    clearStale = false,
  ): Promise<void> {
    const objectId = this.requireObjectId(robotId);
    const current = this.customAreas.get(robotId) ?? {
      active: false,
      values: "",
    };
    const wasActive = current.active;
    current.active = true;
    if (coordinates) {
      current.values = coordinates;
    } else if (clearStale) {
      current.values = "";
    }
    if (!wasActive) {
      const room = this.currentRobotRoom(robotId) || this.dockRoom(robotId);
      if (room) {
        this.customAreaOriginRooms.set(robotId, room);
      } else {
        this.customAreaOriginRooms.delete(robotId);
      }
      this.inferredCustomAreaRooms.delete(robotId);
      this.customAreaTargetReached.delete(robotId);
    }
    this.customAreas.set(robotId, current);
    const updates = [
      this.adapter.setStateAsync(
        `devices.${objectId}.customArea.active`,
        true,
        true,
      ),
    ];
    if (coordinates || clearStale) {
      updates.push(
        this.adapter.setStateAsync(
          `devices.${objectId}.customArea.values`,
          current.values,
          true,
        ),
      );
    }
    await Promise.all(updates);
    const snapshot = this.latestSnapshots.get(robotId);
    if (snapshot) {
      await this.writeSnapshot(robotId, snapshot);
    }
  }

  private defaultCustomArea(snapshot: MapSnapshot): string {
    const points = snapshot.rooms.flatMap((room) => room.polygon);
    if (!points.length) {
      return "";
    }
    const xs = points.map((point) => point.x),
      ys = points.map((point) => point.y);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const width = maxX - minX,
      height = maxY - minY;
    return [
      minX + width * 0.375,
      minY + height * 0.375,
      minX + width * 0.625,
      minY + height * 0.625,
    ]
      .map((value) => Number(value.toFixed(2)))
      .join(",");
  }

  private parseCoordinates(value: unknown): string | null {
    const text =
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : "";
    const values = text.replace(/\s+/g, "").split(",").map(Number);
    return values.length === 4 && values.every(Number.isFinite)
      ? values.join(",")
      : null;
  }

  private async handleHistoryChange(
    objectId: string,
    property: string,
    value: unknown,
  ): Promise<void> {
    const base = `devices.${objectId}.history`;
    if (property === "clear" && this.isTrue(value)) {
      await Promise.all([
        this.adapter.setStateAsync(`${base}.events`, "[]", true),
        this.adapter.setStateAsync(`${base}.count`, 0, true),
        this.adapter.setStateAsync(`${base}.clear`, false, true),
      ]);
    } else if (property === "maxEntries") {
      const maximum = Math.max(10, Math.min(500, Number(value) || 100));
      const events = this.parseHistory(
        (await this.adapter.getStateAsync(`${base}.events`))?.val,
      ).slice(-maximum);
      await Promise.all([
        this.adapter.setStateAsync(`${base}.maxEntries`, maximum, true),
        this.adapter.setStateAsync(
          `${base}.events`,
          JSON.stringify(events),
          true,
        ),
        this.adapter.setStateAsync(`${base}.count`, events.length, true),
      ]);
    }
  }

  private parseHistory(
    value: unknown,
  ): Array<{ timestamp: string; event: string }> {
    try {
      const parsed = JSON.parse(
        typeof value === "string" || typeof value === "number"
          ? String(value)
          : "[]",
      );
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.map((item) => {
        const timestamp = String(item?.timestamp ?? "");
        const parsedDate = timestamp.endsWith("Z") ? new Date(timestamp) : null;
        return {
          timestamp:
            parsedDate && Number.isFinite(parsedDate.getTime())
              ? this.localTimestamp(parsedDate)
              : timestamp,
          event: String(item?.event ?? ""),
        };
      });
    } catch {
      return [];
    }
  }

  private async updateRobotStatus(
    robotId: string,
    status: string,
    updateDeviceState = true,
    recordHistory = true,
  ): Promise<void> {
    if (
      !this.robotObjectIds.has(robotId) ||
      typeof status !== "string" ||
      !status.trim()
    ) {
      return;
    }
    // Charge-state echoes arrive throughout dust extraction. They must not
    // alternate the live report and history with the active station process.
    if (
      this.autoEmptyActive.has(robotId) &&
      this.classifyStatus(status) === "charging"
    ) {
      return;
    }
    await this.robotReady.get(robotId);
    if (!this.robotObjectIds.has(robotId)) {
      return;
    }
    const displayStatus = await this.readableStatus(robotId, status);
    if (
      this.classifyStatus(status) === "idle" &&
      this.cleaningActive.has(robotId) &&
      this.sequentialCleaningPhase.get(robotId) === "vacuum" &&
      !this.returningActive.has(robotId)
    ) {
      return;
    }
    if (this.lastStatuses.get(robotId) === displayStatus) {
      return;
    }
    this.lastStatuses.set(robotId, displayStatus);
    const rawClass = this.classifyStatus(status);
    const historyClass =
      rawClass === "cleaning" &&
      this.classifyStatus(displayStatus) === "navigating"
        ? "navigating"
        : rawClass;
    const shouldRecordHistory =
      recordHistory &&
      (historyClass === "traversing" ||
        this.lastHistoryClasses.get(robotId) !== historyClass);
    if (shouldRecordHistory) {
      this.lastHistoryClasses.set(robotId, historyClass);
    }
    const objectId = this.requireObjectId(robotId);
    const base = `devices.${objectId}`;
    const now = Date.now();
    const sequence =
      Number(
        (await this.adapter.getStateAsync(`${base}.history.sequence`))?.val ??
          0,
      ) + 1;
    const updates = [
      this.adapter.setStateAsync(
        `${base}.history.current`,
        displayStatus,
        true,
      ),
      this.adapter.setStateAsync(
        `${base}.history.lastEvent`,
        displayStatus,
        true,
      ),
      this.adapter.setStateAsync(`${base}.history.lastEventTime`, now, true),
      this.adapter.setStateAsync(`${base}.history.sequence`, sequence, true),
    ];
    // info.robotState exposes the stable internal class while the live report/history use
    // the human-readable text. This normalizes model-specific values such as
    // CustomArea, custom-area and custom_area to "cleaning".
    if (updateDeviceState) {
      updates.push(
        this.adapter.setStateAsync(
          `${base}.info.robotState`,
          this.classifyStatus(status),
          true,
        ),
      );
    }
    await Promise.all(updates);
    if (!shouldRecordHistory) {
      return;
    }
    const historyBase = `${base}.history`;
    const events = this.parseHistory(
      (await this.adapter.getStateAsync(`${historyBase}.events`))?.val,
    );
    // Persisted history is the final authority for deduplication. Runtime
    // sources can briefly alternate between charging and a station function,
    // and the in-memory class cache is empty after an adapter restart.
    if (events.at(-1)?.event === displayStatus) {
      return;
    }
    const maximum = Math.max(
      10,
      Math.min(
        500,
        Number(
          (await this.adapter.getStateAsync(`${historyBase}.maxEntries`))?.val,
        ) || 100,
      ),
    );
    events.push({
      timestamp: this.localTimestamp(new Date(now)),
      event: displayStatus,
    });
    const limited = events.slice(-maximum);
    await Promise.all([
      this.adapter.setStateAsync(
        `${historyBase}.events`,
        JSON.stringify(limited),
        true,
      ),
      this.adapter.setStateAsync(`${historyBase}.count`, limited.length, true),
    ]);
  }

  private async readableStatus(
    robotId: string,
    status: string,
  ): Promise<string> {
    const normalized = status.trim().toLowerCase();
    const compact = normalized.replace(/[^a-z0-9]/g, "");
    const classification = this.classifyStatus(status);
    if (classification === "traversing") {
      return status.trim();
    }
    if (classification === "emptying") {
      return "Entleert den Staubbehälter an der Ladestation";
    }
    if (classification === "washing") {
      const returnedAt = this.lastReturningAt.get(robotId) ?? 0;
      return returnedAt && Date.now() - returnedAt < 5 * 60_000
        ? "Entleert den Wassertank an der Ladestation"
        : "Nimmt Wasser an der Ladestation auf";
    }
    if (classification === "drying") {
      return "Trocknet die Wischmopps an der Ladestation";
    }
    if (classification === "returning") {
      return "Fährt zur Ladestation zurück";
    }
    if (classification === "charging") {
      return "An der Ladestation angekommen – lädt";
    }
    if (classification === "paused") {
      return "Reinigung pausiert";
    }
    if (classification === "idle") {
      return "Reinigung beendet";
    }
    if (classification === "unknown") {
      return "Status unbekannt";
    }
    const activity = await this.cleaningActivity(robotId);
    if (
      classification === "cleaning" &&
      this.customAreas.get(robotId)?.active &&
      this.cleaningActive.has(robotId)
    ) {
      this.inferCustomAreaRoomAfterTravel(robotId);
      const room = this.customAreaRoom(robotId);
      if (!this.robotInsideCustomArea(robotId)) {
        return `Fährt zu benutzerdefiniertem Bereich${room ? ` im ${room}` : ""}`;
      }
      this.customAreaTargetReached.add(robotId);
      return `${activity}: Benutzerdefinierter Bereich${room ? ` im ${room}` : ""}`;
    }
    if (compact.includes("customarea")) {
      this.inferCustomAreaRoomAfterTravel(robotId);
      const room = this.customAreaRoom(robotId);
      if (!this.robotInsideCustomArea(robotId)) {
        return `Fährt zu benutzerdefiniertem Bereich${room ? ` im ${room}` : ""}`;
      }
      this.customAreaTargetReached.add(robotId);
      return `${activity}: Benutzerdefinierter Bereich${room ? ` im ${room}` : ""}`;
    }
    if (!normalized.includes("spot_area")) {
      if (
        /(auto|area|edge|clean|sweep|mop|entrust|freeclean|qcclean)/.test(
          normalized,
        )
      ) {
        return activity;
      }
      return status;
    }
    const snapshot = this.latestSnapshots.get(robotId);
    if (!snapshot) {
      return status;
    }
    const selectedIds = new Set(
      this.commandedRoomIds.get(robotId) ??
        this.currentSpotAreaIds.get(robotId) ??
        [],
    );
    const selectedNames = snapshot.rooms
      .filter((room) => selectedIds.has(room.id))
      .map((room) => room.displayName);
    const current = snapshot.currentRoomId
      ? snapshot.rooms.find((room) => room.id === snapshot.currentRoomId)
      : undefined;
    const roomName = current?.displayName || snapshot.currentRoomName;
    if (selectedNames.length) {
      if (current && selectedIds.has(current.id)) {
        return `${activity}: ${current.displayName}`;
      }
      if (roomName) {
        return `Durchquert ${roomName}`;
      }
      return `Fährt zu ${[...new Set(selectedNames)].join(", ")}`;
    }
    return roomName ? `${activity}: ${roomName}` : activity;
  }

  private classifyStatus(status: string): string {
    const normalized = String(status ?? "")
      .trim()
      .toLowerCase();
    if (!normalized) {
      return "unknown";
    }
    if (normalized.startsWith("durchquert ")) {
      return "traversing";
    }
    if (
      normalized.startsWith("fährt zu ") ||
      normalized.startsWith("faehrt zu ")
    ) {
      return "navigating";
    }
    if (/(emptying|auto[ _-]?empty|dust[ _-]?collect)/.test(normalized)) {
      return "emptying";
    }
    if (
      /(return|returning|go[ _-]?home|homing|back[ _-]?to[ _-]?charge)/.test(
        normalized,
      )
    ) {
      return "returning";
    }
    if (normalized.includes("washing")) {
      return "washing";
    }
    if (normalized.includes("drying")) {
      return "drying";
    }
    if (/(charg|dock)/.test(normalized)) {
      return "charging";
    }
    if (normalized.includes("pause")) {
      return "paused";
    }
    if (/(idle|standby|stop|finish|complete)/.test(normalized)) {
      return "idle";
    }
    if (
      /(clean|spot|auto|edge|saugt|wischt|reinigt)/.test(normalized) ||
      normalized.replace(/[^a-z0-9]/g, "").includes("customarea")
    ) {
      return "cleaning";
    }
    return "unknown";
  }

  private async cleaningActivity(robotId: string): Promise<string> {
    if (!this.robotObjectIds.has(robotId)) {
      return "Reinigt";
    }
    if (this.sequentialCleaningPhase.get(robotId) === "mop") {
      return "Wischt";
    }
    const objectId = this.requireObjectId(robotId);
    const mode = Number(
      (
        await this.adapter.getStateAsync(
          `devices.${objectId}.control.cleaning.cleaningMode`,
        )
      )?.val,
    );
    if (mode === 0) {
      return "Saugt und wischt";
    }
    if (mode === 1) {
      return "Saugt";
    }
    if (mode === 2) {
      return "Wischt";
    }
    if (mode === 3) {
      return this.sequentialCleaningPhase.get(robotId) === "mop"
        ? "Wischt"
        : "Saugt";
    }
    // An installed mop/water tank does not establish the current cleaning mode.
    return "Reinigt";
  }

  private async initializeCleaningPhase(robotId: string): Promise<void> {
    if (
      this.sequentialCleaningPhase.has(robotId) ||
      !this.robotObjectIds.has(robotId)
    ) {
      return;
    }
    const objectId = this.requireObjectId(robotId);
    const mode = Number(
      (
        await this.adapter.getStateAsync(
          `devices.${objectId}.control.cleaning.cleaningMode`,
        )
      )?.val,
    );
    if (mode === 3) {
      this.sequentialCleaningPhase.set(robotId, "vacuum");
    }
  }

  private customAreaRoom(robotId: string): string {
    const coordinates = this.parseCoordinates(
      this.customAreas.get(robotId)?.values,
    );
    const snapshot = this.latestSnapshots.get(robotId);
    if (!coordinates || !snapshot) {
      return this.inferredCustomAreaRooms.get(robotId) ?? "";
    }
    const [x1, y1, x2, y2] = coordinates.split(",").map(Number);
    const center = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    return (
      snapshot.rooms.find((room) => this.pointInPolygon(center, room.polygon))
        ?.displayName ?? ""
    );
  }

  private robotInsideCustomArea(robotId: string): boolean {
    const coordinates = this.parseCoordinates(
      this.customAreas.get(robotId)?.values,
    );
    const position = this.latestSnapshots.get(robotId)?.robotPosition;
    if (!coordinates || !position) {
      const inferredRoom = this.inferredCustomAreaRooms.get(robotId);
      return Boolean(
        inferredRoom && this.currentRobotRoom(robotId) === inferredRoom,
      );
    }
    const targetRoom = this.customAreaRoom(robotId);
    if (targetRoom && this.currentRobotRoom(robotId) === targetRoom) {
      return true;
    }
    const [x1, y1, x2, y2] = coordinates.split(",").map(Number);
    return (
      position.x >= Math.min(x1, x2) &&
      position.x <= Math.max(x1, x2) &&
      position.y >= Math.min(y1, y2) &&
      position.y <= Math.max(y1, y2)
    );
  }

  private currentRobotRoom(robotId: string): string {
    const snapshot = this.latestSnapshots.get(robotId);
    if (!snapshot) {
      return this.currentRooms.get(robotId) ?? "";
    }
    const native = snapshot.currentRoomId
      ? snapshot.rooms.find((room) => room.id === snapshot.currentRoomId)
          ?.displayName
      : undefined;
    const geometric = snapshot.robotPosition
      ? snapshot.rooms.find((room) =>
          this.pointInPolygon(snapshot.robotPosition!, room.polygon),
        )?.displayName
      : undefined;
    return (
      native ||
      snapshot.currentRoomName ||
      geometric ||
      this.currentRooms.get(robotId) ||
      ""
    );
  }

  private inferCustomAreaRoomAfterTravel(robotId: string): void {
    if (
      this.parseCoordinates(this.customAreas.get(robotId)?.values) ||
      this.inferredCustomAreaRooms.has(robotId)
    ) {
      return;
    }
    const currentRoom = this.currentRobotRoom(robotId);
    const originRoom =
      this.customAreaOriginRooms.get(robotId) || this.dockRoom(robotId);
    if (currentRoom && originRoom && currentRoom !== originRoom) {
      this.inferredCustomAreaRooms.set(robotId, currentRoom);
    }
  }

  private dockRoom(robotId: string): string {
    const snapshot = this.latestSnapshots.get(robotId);
    const dock = snapshot?.dockPosition;
    if (!snapshot || !dock) {
      return "";
    }
    return (
      snapshot.rooms.find((room) => this.pointInPolygon(dock, room.polygon))
        ?.displayName ?? ""
    );
  }

  private localTimestamp(date: Date): string {
    const number = (value: number): string => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${number(date.getMonth() + 1)}-${number(date.getDate())} ${number(date.getHours())}:${number(date.getMinutes())}:${number(date.getSeconds())}`;
  }

  private async handleRobotStatus(
    robotId: string,
    status: string,
    source: "clean" | "charge" | "station",
  ): Promise<void> {
    if (
      !this.robotObjectIds.has(robotId) ||
      typeof status !== "string" ||
      !status.trim()
    ) {
      return;
    }
    if (!(["clean", "charge", "station"] as string[]).includes(source)) {
      source = "clean";
    }
    let newTargetIds: string[] = [];
    let customAreaCoordinates: string | null = null;
    if (source === "clean" && status.includes("|")) {
      const [baseStatus, areaValues] = status.split("|", 2);
      if (/spot[_-]?area/i.test(baseStatus)) {
        const roomIds = this.parseRoomIds(areaValues);
        if (roomIds.length) {
          this.currentSpotAreaIds.set(robotId, roomIds);
          newTargetIds = roomIds;
        }
      }
      if (/custom[_-]?area/i.test(baseStatus)) {
        customAreaCoordinates = this.parseCoordinates(areaValues);
      }
      status = baseStatus;
    }
    const normalized = status.toLowerCase();
    const isCustomArea = /custom[_-]?area/.test(normalized);
    let classification = this.classifyStatus(status);
    const cleaningWasActive = this.cleaningActive.has(robotId);
    // Model-specific transient replies such as setLocation/alert carry no
    // useful runtime state and must not replace the last valid live report.
    if (classification === "unknown") {
      return;
    }
    if (classification === "charging" && this.isAirDryingActive(robotId)) {
      return;
    }
    if (
      source === "clean" &&
      classification === "paused" &&
      (this.returningActive.has(robotId) || this.isRobotAtDock(robotId))
    ) {
      return;
    }
    // The cloud may echo the previous charging state after the robot has
    // already left the station. Position is stronger evidence in this case.
    const livePosition = this.latestSnapshots.get(robotId)?.robotPosition;
    if (
      source === "charge" &&
      classification === "charging" &&
      livePosition &&
      !this.isRobotAtDock(robotId)
    ) {
      return;
    }
    if (classification === "washing") {
      const objectId = this.requireObjectId(robotId);
      const modeState = await this.adapter.getStateAsync(
        `devices.${objectId}.control.cleaning.cleaningMode`,
      );
      const mode = modeState?.val == null ? NaN : Number(modeState.val);
      // Generic station washing is also emitted during dust extraction on
      // OMNI models. Never derive a mop phase from it during vacuum-only runs.
      if (![0, 2, 3].includes(mode)) {
        if (this.autoEmptyActive.has(robotId)) {
          await this.updateRobotStatus(robotId, "emptying");
        }
        return;
      }
      if (livePosition && !this.isRobotAtDock(robotId)) {
        return;
      }
    }
    if (
      classification === "cleaning" &&
      isCustomArea &&
      this.customAreaTargetReached.has(robotId)
    ) {
      const currentRoom = this.currentRobotRoom(robotId);
      const originRoom =
        this.customAreaOriginRooms.get(robotId) || this.dockRoom(robotId);
      const targetRoom = this.customAreaRoom(robotId);
      if (
        currentRoom &&
        originRoom &&
        currentRoom === originRoom &&
        currentRoom !== targetRoom
      ) {
        this.lastReturningAt.set(robotId, Date.now());
        this.returningActive.add(robotId);
        await this.updateRobotStatus(robotId, "returning");
        if (this.isRobotAtDock(robotId) && this.autoEmptyEnabled.has(robotId)) {
          this.inferredAutoEmpty.add(robotId);
          await this.updateRobotStatus(robotId, "emptying");
        }
        return;
      }
    }
    if (classification === "washing" && this.airDryingStartedAt.has(robotId)) {
      return;
    }
    if (classification === "cleaning" && this.returningActive.has(robotId)) {
      return;
    }
    if (classification === "cleaning") {
      this.lastCleaningSignalAt.set(robotId, Date.now());
    }
    if (classification === "cleaning") {
      await this.initializeCleaningPhase(robotId);
    }
    if (classification === "cleaning" && isCustomArea) {
      const completedAt = this.cleaningCompletedAt.get(robotId) ?? 0;
      // Ecovacs can echo the previous CustomArea state while the robot is
      // already returning. It belongs to the completed run and must not
      // create a new navigation event with the old coordinates.
      if (
        cleaningWasActive &&
        completedAt &&
        Date.now() - completedAt < 2 * 60_000
      ) {
        return;
      }
      if (customAreaCoordinates) {
        this.customAreaCoordinatesAt.set(robotId, Date.now());
        await this.activateCustomArea(robotId, customAreaCoordinates);
      } else {
        const coordinatesAreFresh =
          Date.now() - (this.customAreaCoordinatesAt.get(robotId) ?? 0) < 5_000;
        const coordinates = coordinatesAreFresh
          ? this.parseCoordinates(this.customAreas.get(robotId)?.values)
          : null;
        await this.activateCustomArea(
          robotId,
          coordinates,
          !coordinatesAreFresh && !cleaningWasActive,
        );
      }
      this.inferCustomAreaRoomAfterTravel(robotId);
      if (cleaningWasActive && !this.robotInsideCustomArea(robotId)) {
        return;
      }
    }
    if (classification === "cleaning" && !this.cleaningActive.has(robotId)) {
      this.cleaningCompletedAt.delete(robotId);
      this.announcedSpotTargets.delete(robotId);
      this.inferredAutoEmpty.delete(robotId);
      this.returningActive.delete(robotId);
      this.sequentialCleaningPhase.delete(robotId);
      this.finalWaterDrainReported.delete(robotId);
    }
    if (
      classification === "washing" &&
      this.cleaningActive.has(robotId) &&
      this.sequentialCleaningPhase.get(robotId) !== "mop"
    ) {
      if (
        this.sequentialCleaningPhase.get(robotId) === "vacuum" &&
        this.isRobotAtDock(robotId) &&
        this.autoEmptyEnabled.has(robotId) &&
        !this.inferredAutoEmpty.has(robotId)
      ) {
        this.inferredAutoEmpty.add(robotId);
        await this.updateRobotStatus(robotId, "emptying");
      }
      this.waterCycleActive.add(robotId);
      this.sequentialCleaningPhase.set(robotId, "mop");
      if (this.inferredAutoEmpty.has(robotId)) {
        this.lastReturningAt.delete(robotId);
      }
    }
    const repeatedReturnAtDock =
      classification === "returning" &&
      this.returningActive.has(robotId) &&
      this.isRobotAtDock(robotId);
    if (repeatedReturnAtDock) {
      if (this.waterCycleActive.has(robotId)) {
        status = "washing";
        classification = "washing";
        this.finalWaterDrainReported.add(robotId);
      }
    }
    if (classification === "returning") {
      if (!this.returningActive.has(robotId)) {
        await this.clearSelectedRooms(robotId);
      }
      this.lastReturningAt.set(robotId, Date.now());
      this.returningActive.add(robotId);
    }
    const startedAt = this.cleaningStartedAt.get(robotId) ?? 0;
    const lastCleaningSignalAt = this.lastCleaningSignalAt.get(robotId) ?? 0;
    if (
      classification === "idle" &&
      lastCleaningSignalAt &&
      Date.now() - lastCleaningSignalAt < 60_000
    ) {
      return;
    }
    if (
      classification === "idle" &&
      this.cleaningActive.has(robotId) &&
      Date.now() - startedAt < 20_000
    ) {
      return;
    }
    if (
      (classification === "washing" || classification === "drying") &&
      this.cleaningActive.has(robotId) &&
      Date.now() - startedAt < 30_000
    ) {
      return;
    }
    // Some stations keep their previous drying/washing flag set while the
    // robot is already cleaning away from the dock. Never let that stale
    // station state replace the current cleaning or completion report.
    if (
      source === "station" &&
      (classification === "washing" || classification === "drying") &&
      this.cleaningActive.has(robotId) &&
      !this.isRobotAtDock(robotId)
    ) {
      return;
    }
    const active =
      classification === "cleaning" ||
      (/(area|sweep|mop|entrust|freeclean|qcclean)/.test(normalized) &&
        classification !== "idle");
    if (source === "clean" && active && this.terminalStatuses.has(robotId)) {
      const previousRuntime = this.runtimeStatuses.get(robotId);
      if (this.isRobotAtDock(robotId)) {
        return;
      }
      this.terminalStatuses.delete(robotId);
      if (previousRuntime) {
        previousRuntime.charge = "";
      }
    }
    if (source === "clean" && active && newTargetIds.length) {
      await this.announceSpotTargets(
        robotId,
        this.commandedRoomIds.get(robotId) ?? newTargetIds,
      );
    }
    if (
      source === "charge" &&
      classification === "charging" &&
      this.cleaningActive.has(robotId) &&
      !this.returningActive.has(robotId) &&
      Date.now() - startedAt < 90_000
    ) {
      return;
    }
    const previousRuntime = this.runtimeStatuses.get(robotId) ?? {};
    const startingMopPhase =
      source === "station" &&
      classification === "washing" &&
      this.cleaningActive.has(robotId) &&
      this.isRobotAtDock(robotId) &&
      this.sequentialCleaningPhase.get(robotId) !== "mop" &&
      !this.returningActive.has(robotId);
    if (startingMopPhase) {
      if (this.autoEmptyEnabled.has(robotId)) {
        this.inferredAutoEmpty.add(robotId);
        await this.updateRobotStatus(robotId, "emptying");
      }
      this.sequentialCleaningPhase.set(robotId, "mop");
      this.returningActive.delete(robotId);
      this.lastReturningAt.delete(robotId);
    }
    if (
      source === "station" &&
      (classification === "washing" || classification === "drying") &&
      this.returningActive.has(robotId) &&
      this.isRobotAtDock(robotId)
    ) {
      this.returningActive.delete(robotId);
      if (this.sequentialCleaningPhase.get(robotId) === "vacuum") {
        await this.updateRobotStatus(robotId, "emptying");
        this.sequentialCleaningPhase.set(robotId, "mop");
        this.lastReturningAt.delete(robotId);
        status = "washing";
        classification = "washing";
      } else if (
        this.sequentialCleaningPhase.get(robotId) === "mop" &&
        classification === "drying" &&
        !this.finalWaterDrainReported.has(robotId)
      ) {
        this.finalWaterDrainReported.add(robotId);
        status = "washing";
        classification = "washing";
      }
    }
    const returnedAfterCleaning =
      this.classifyStatus(String(previousRuntime.clean ?? "")) === "returning";
    if (
      source === "clean" &&
      classification === "paused" &&
      this.cleaningActive.has(robotId) &&
      this.isRobotAtDock(robotId)
    ) {
      return;
    }
    if (
      source === "clean" &&
      classification === "idle" &&
      this.cleaningActive.has(robotId)
    ) {
      this.cleaningCompletedAt.set(robotId, Date.now());
      this.scheduleDelayedCleaningFinish(robotId);
      return;
    }
    if (
      source === "charge" &&
      classification === "charging" &&
      this.cleaningActive.has(robotId) &&
      !returnedAfterCleaning
    ) {
      this.scheduleDelayedCleaningFinish(robotId, "charging");
      return;
    }
    if (
      source === "charge" &&
      classification === "charging" &&
      this.cleaningActive.has(robotId)
    ) {
      // Charging is already reported while an OMNI station is still about to
      // auto-empty or drain water. Keep it pending until the station sequence
      // has settled instead of inserting premature charging events.
      const runtime = previousRuntime;
      runtime.charge = status;
      runtime.clean = "idle";
      this.runtimeStatuses.set(robotId, runtime);
      this.terminalStatuses.add(robotId);
      this.scheduleDelayedCleaningFinish(robotId, "charging");
      return;
    }
    if (classification === "returning" && this.cleaningActive.has(robotId)) {
      this.clearTrailFinishTimer(robotId);
      if (
        this.sequentialCleaningPhase.get(robotId) !== "vacuum" &&
        this.classifyStatus(String(previousRuntime.clean ?? "")) !== "returning"
      ) {
        await this.updateRobotStatus(robotId, "idle");
      }
    }
    if (
      ["charging", "washing", "drying", "emptying"].includes(classification)
    ) {
      await this.announceDockRoomTraversal(robotId);
    }
    const runtime = previousRuntime;
    runtime[source] = status;
    if (source === "charge" && classification === "charging") {
      runtime.clean = "idle";
      this.terminalStatuses.add(robotId);
    }
    this.runtimeStatuses.set(robotId, runtime);
    const wasCleaning = this.cleaningActive.has(robotId);
    let effectiveStatus = this.effectiveRuntimeStatus(
      runtime,
      source,
      wasCleaning,
    );
    const stationClass = this.classifyStatus(String(runtime.station ?? ""));
    if (
      (stationClass === "washing" || stationClass === "drying") &&
      this.isRobotAtDock(robotId) &&
      classification !== "returning"
    ) {
      effectiveStatus = String(runtime.station);
    }
    if (
      this.autoEmptyActive.has(robotId) &&
      !active &&
      classification !== "returning"
    ) {
      effectiveStatus = "emptying";
    }
    if (this.classifyStatus(effectiveStatus) === "washing") {
      const returnedAt = this.lastReturningAt.get(robotId) ?? 0;
      if (
        !this.inferredAutoEmpty.has(robotId) &&
        returnedAt &&
        Date.now() - returnedAt < 5 * 60_000 &&
        (await this.cleaningActivity(robotId)) === "Saugt"
      ) {
        this.inferredAutoEmpty.add(robotId);
        effectiveStatus = "emptying";
      }
    }
    // A stale model-specific part-status must never turn a valid current
    // update into the visible fallback "Status unbekannt".
    if (this.classifyStatus(effectiveStatus) === "unknown") {
      effectiveStatus = status;
    }
    const effectiveClass = this.classifyStatus(effectiveStatus);
    await this.updateRobotStatus(
      robotId,
      effectiveStatus,
      true,
      effectiveClass !== "idle" || wasCleaning,
    );
    if (
      effectiveClass === "drying" &&
      this.cleaningActive.has(robotId) &&
      this.isRobotAtDock(robotId)
    ) {
      // Drying is a post-cleaning station process. At this point the cleaned
      // custom area and its trail must disappear, while the drying report
      // itself remains the visible current status.
      await this.finishTrail(robotId);
      return;
    }
    if (
      effectiveClass === "washing" &&
      this.autoEmptyEnabled.has(robotId) &&
      !this.inferredAutoEmpty.has(robotId)
    ) {
      const returnedAt = this.lastReturningAt.get(robotId) ?? 0;
      const activity = await this.cleaningActivity(robotId);
      if (
        returnedAt &&
        Date.now() - returnedAt < 5 * 60_000 &&
        activity.includes("Saugt")
      ) {
        this.inferredAutoEmpty.add(robotId);
        await this.updateRobotStatus(robotId, "emptying");
      }
    }
    if (source === "charge") {
      const customAreaVisible = this.customAreas.get(robotId)?.active === true;
      if (
        classification === "charging" &&
        customAreaVisible &&
        this.cleaningActive.has(robotId) &&
        (returnedAfterCleaning || this.isRobotAtDock(robotId))
      ) {
        await this.finishTrail(robotId);
        return;
      }
      if (
        classification === "charging" &&
        this.cleaningActive.has(robotId) &&
        returnedAfterCleaning
      ) {
        await this.finishTrail(robotId);
        return;
      }
      if (
        classification === "charging" &&
        this.cleaningActive.has(robotId) &&
        !this.trailFinishTimers.has(robotId)
      ) {
        const timer = this.adapter.setTimeout(
          () => void this.finishTrail(robotId),
          45_000,
        );
        if (timer !== undefined) {
          this.trailFinishTimers.set(robotId, timer);
        }
      }
      return;
    }
    const finished = classification === "idle";
    // Washing/drying at the station can be an intermediate phase of
    // "vacuum first, then mop" and must not clear or restart the current trail.
    if (/(washing|drying|cleaningcloth)/.test(normalized)) {
      this.clearTrailFinishTimer(robotId);
      return;
    }
    if (active) {
      this.clearTrailFinishTimer(robotId);
      if (!this.cleaningActive.has(robotId)) {
        this.cleaningActive.add(robotId);
        this.cleaningStartedAt.set(robotId, Date.now());
        this.trails.set(robotId, []);
        this.currentRooms.delete(robotId);
        const snapshotAtStart = this.latestSnapshots.get(robotId);
        const position =
          snapshotAtStart?.robotPosition ?? snapshotAtStart?.dockPosition;
        if (position) {
          this.addTrailPoint(robotId, position);
        }
      }
      return;
    }
    if (
      finished &&
      this.cleaningActive.has(robotId) &&
      !this.trailFinishTimers.has(robotId)
    ) {
      this.scheduleDelayedCleaningFinish(robotId);
    }
  }

  private scheduleDelayedCleaningFinish(
    robotId: string,
    finalStatus?: "charging",
  ): void {
    if (this.trailFinishTimers.has(robotId)) {
      return;
    }
    const timer = this.adapter.setTimeout(() => {
      void (async () => {
        this.trailFinishTimers.delete(robotId);
        if (!this.cleaningActive.has(robotId)) {
          return;
        }
        if (
          this.sequentialCleaningPhase.get(robotId) === "vacuum" &&
          !this.returningActive.has(robotId)
        ) {
          return;
        }
        // An idle/charging echo between water intake and the following mop
        // phase is not the end of the cleaning job.
        if (
          this.waterCycleActive.has(robotId) &&
          !this.finalWaterDrainReported.has(robotId)
        ) {
          return;
        }
        await this.updateRobotStatus(robotId, "idle");
        if (finalStatus) {
          await this.updateRobotStatus(robotId, finalStatus);
        }
        await this.finishTrail(robotId);
      })();
    }, 45_000);
    if (timer !== undefined) {
      this.trailFinishTimers.set(robotId, timer);
    }
  }

  private isRobotAtDock(robotId: string): boolean {
    const snapshot = this.latestSnapshots.get(robotId);
    const robot = snapshot?.robotPosition;
    const dock = snapshot?.dockPosition;
    if (!snapshot || !robot || !dock) {
      return false;
    }
    const roomPoints = snapshot.rooms.flatMap((room) => room.polygon);
    const xs = roomPoints.map((point) => point.x),
      ys = roomPoints.map((point) => point.y);
    const diagonal =
      xs.length && ys.length
        ? Math.hypot(
            Math.max(...xs) - Math.min(...xs),
            Math.max(...ys) - Math.min(...ys),
          )
        : 0;
    const tolerance = Math.max(10, diagonal * 0.04);
    return Math.hypot(robot.x - dock.x, robot.y - dock.y) <= tolerance;
  }

  private effectiveRuntimeStatus(
    runtime: Partial<Record<"clean" | "charge" | "station", string>>,
    changedSource: "clean" | "charge" | "station",
    cleaningSessionActive = false,
  ): string {
    const clean = String(runtime.clean ?? "");
    const charge = String(runtime.charge ?? "");
    const station = String(runtime.station ?? "");
    if (
      changedSource === "station" &&
      /(washing|cleaningcloth|drying)/i.test(station)
    ) {
      return station;
    }
    const cleanActive =
      /(auto|spot|area|edge|clean|sweep|mop|entrust|freeclean|qcclean|pause)/i.test(
        clean,
      ) && !/(complete|finished|idle|standby|stop|cleaningcloth)/i.test(clean);
    if (cleanActive) {
      return clean;
    }
    if (/returning/i.test(clean)) {
      return clean;
    }
    // Charging and an active station operation are reported at the same time.
    // Keep washing/drying authoritative until the station itself reports that
    // the operation ended, otherwise every polling cycle alternates history
    // between "charging" and the station activity.
    if (/(washing|cleaningcloth|drying)/i.test(station)) {
      return station;
    }
    if (/(washing|cleaningcloth|drying)/i.test(clean)) {
      return clean;
    }
    if (
      cleaningSessionActive &&
      /(complete|finished|idle|standby|stop)/i.test(clean)
    ) {
      return clean;
    }
    // Periodic polling often returns clean=idle and charge=charging one after
    // another. Outside an active cleaning session, charging is authoritative
    // so the history cannot oscillate once per polling cycle.
    if (/(charging|charge|dock)/i.test(charge)) {
      return charge;
    }
    if (
      changedSource === "clean" &&
      /(complete|finished|idle|standby|stop)/i.test(clean)
    ) {
      return clean;
    }
    if (changedSource === "charge" && /returning/i.test(charge)) {
      return charge;
    }
    return changedSource === "station" ? station : clean || charge || station;
  }

  private addTrailPoint(robotId: string, point: Point): void {
    const trail = this.trails.get(robotId) ?? [];
    const last = trail[trail.length - 1];
    if (!last || Math.hypot(last.x - point.x, last.y - point.y) >= 1) {
      trail.push({ ...point });
    }
    if (trail.length > 1500) {
      trail.splice(0, trail.length - 1500);
    }
    this.trails.set(robotId, trail);
  }

  private clearTrailFinishTimer(robotId: string): void {
    const timer = this.trailFinishTimers.get(robotId);
    if (timer) {
      this.adapter.clearTimeout(timer);
    }
    this.trailFinishTimers.delete(robotId);
  }

  private async finishTrail(robotId: string): Promise<void> {
    this.clearTrailFinishTimer(robotId);
    await this.clearSelectedRooms(robotId);
    this.cleaningActive.delete(robotId);
    this.cleaningStartedAt.delete(robotId);
    this.lastCleaningSignalAt.delete(robotId);
    this.cleaningCompletedAt.delete(robotId);
    this.customAreaOriginRooms.delete(robotId);
    this.inferredCustomAreaRooms.delete(robotId);
    this.customAreaTargetReached.delete(robotId);
    this.commandedRoomIds.delete(robotId);
    this.currentSpotAreaIds.delete(robotId);
    this.announcedSpotTargets.delete(robotId);
    this.inferredAutoEmpty.delete(robotId);
    this.returningActive.delete(robotId);
    this.sequentialCleaningPhase.delete(robotId);
    this.finalWaterDrainReported.delete(robotId);
    this.waterCycleActive.delete(robotId);
    this.trails.delete(robotId);
    this.currentRooms.delete(robotId);
    if (this.robotObjectIds.has(robotId)) {
      const customArea = this.customAreas.get(robotId) ?? {
        active: false,
        values: "",
      };
      customArea.active = false;
      this.customAreas.set(robotId, customArea);
      await this.adapter.setStateAsync(
        `devices.${this.requireObjectId(robotId)}.customArea.active`,
        false,
        true,
      );
    }
    const snapshot = this.latestSnapshots.get(robotId);
    if (snapshot) {
      await this.writeSnapshot(robotId, snapshot);
    }
  }

  private async setControlsDetected(
    robotId: string,
    capabilities: RobotCapabilities,
  ): Promise<void> {
    await this.robotReady.get(robotId);
    await this.adapter.setStateAsync(
      `devices.${this.requireObjectId(robotId)}.status.controlsDetected`,
      Object.values(capabilities).some(Boolean),
      true,
    );
  }

  private async announceSpotTargets(
    robotId: string,
    roomIds: string[],
  ): Promise<void> {
    const signature = [...new Set(roomIds)].sort().join(",");
    if (!signature || this.announcedSpotTargets.get(robotId) === signature) {
      return;
    }
    const snapshot = this.latestSnapshots.get(robotId);
    if (!snapshot) {
      return;
    }
    const selected = new Set(roomIds);
    const names = [
      ...new Set(
        snapshot.rooms
          .filter((room) => selected.has(room.id))
          .map((room) => room.displayName),
      ),
    ];
    if (!names.length) {
      return;
    }
    this.announcedSpotTargets.set(robotId, signature);
    await this.updateRobotStatus(
      robotId,
      `Fährt zu ${names.join(", ")}`,
      false,
      true,
    );
  }

  private async announceDockRoomTraversal(robotId: string): Promise<void> {
    if (
      !this.cleaningActive.has(robotId) ||
      this.returningActive.has(robotId)
    ) {
      return;
    }
    const snapshot = this.latestSnapshots.get(robotId);
    const dock = snapshot?.dockPosition;
    if (!snapshot || !dock) {
      return;
    }
    const room = snapshot.rooms.find((candidate) =>
      this.pointInPolygon(dock, candidate.polygon),
    );
    if (!room || this.currentRooms.get(robotId) === room.displayName) {
      return;
    }
    this.currentRooms.set(robotId, room.displayName);
    await this.updateRobotStatus(
      robotId,
      `Durchquert ${room.displayName}`,
      false,
      true,
    );
  }

  private async updateMapStatus(
    robotId: string,
    base: string,
    snapshot: MapSnapshot,
  ): Promise<void> {
    const position = snapshot.robotPosition;
    const nativeRoom = snapshot.currentRoomId
      ? snapshot.rooms.find(
          (candidate) => candidate.id === snapshot.currentRoomId,
        )
      : undefined;
    const geometricRoom = position
      ? snapshot.rooms.find((candidate) =>
          this.pointInPolygon(position, candidate.polygon),
        )
      : undefined;
    const roomName =
      nativeRoom?.displayName ||
      snapshot.currentRoomName ||
      geometricRoom?.displayName ||
      "";
    await Promise.all([
      this.adapter.setStateAsync(`${base}.status.mapId`, snapshot.mapId, true),
      this.adapter.setStateAsync(
        `${base}.status.mapDetected`,
        Boolean(snapshot.mapId),
        true,
      ),
      this.adapter.setStateAsync(
        `${base}.status.geometryDetected`,
        snapshot.rooms.some((item) => item.polygon.length >= 3),
        true,
      ),
      this.adapter.setStateAsync(
        `${base}.status.positionDetected`,
        Boolean(position),
        true,
      ),
      this.adapter.setStateAsync(
        `${base}.status.rawPosition`,
        position ? `${position.x},${position.y}` : "",
        true,
      ),
      this.adapter.setStateAsync(`${base}.status.position`, roomName, true),
      this.adapter.setStateAsync(
        `${base}.status.roomsDetected`,
        snapshot.rooms.length,
        true,
      ),
    ]);
    if (
      roomName &&
      this.cleaningActive.has(robotId) &&
      this.currentRooms.get(robotId) !== roomName
    ) {
      this.currentRooms.set(robotId, roomName);
      if (
        this.returningActive.has(robotId) ||
        roomName === this.dockRoom(robotId) ||
        roomName === this.customAreaOriginRooms.get(robotId)
      ) {
        return;
      }
      const targetIds = new Set(
        this.commandedRoomIds.get(robotId) ??
          this.currentSpotAreaIds.get(robotId) ??
          [],
      );
      const currentRoomId = nativeRoom?.id ?? geometricRoom?.id;
      const customRoom = this.customAreas.get(robotId)?.active
        ? this.customAreaRoom(robotId)
        : "";
      if (
        customRoom &&
        roomName === customRoom &&
        this.robotInsideCustomArea(robotId)
      ) {
        this.customAreaTargetReached.add(robotId);
      }
      const event =
        customRoom && roomName === customRoom
          ? this.robotInsideCustomArea(robotId)
            ? `${await this.cleaningActivity(robotId)}: Benutzerdefinierter Bereich im ${roomName}`
            : `Durchquert ${roomName}`
          : currentRoomId && targetIds.has(currentRoomId)
            ? `${await this.cleaningActivity(robotId)}: ${roomName}`
            : `Durchquert ${roomName}`;
      await this.updateRobotStatus(robotId, event, false, true);
    } else if (roomName) {
      this.currentRooms.set(robotId, roomName);
    }
  }

  private pointInPolygon(
    point: { x: number; y: number },
    polygon: Array<{ x: number; y: number }>,
  ): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i],
        b = polygon[j];
      if (
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      ) {
        inside = !inside;
      }
    }
    return inside;
  }

  private localizedName(german: string): ioBroker.StringOrTranslated {
    const english: Record<string, string> = {
      Informationen: "Information",
      Verbindung: "Connection",
      "URL zum Gerätebild": "Device image URL",
      Karte: "Map",
      "Normalisierter Kartenschnappschuss": "Normalized map snapshot",
      "Aktuelle Karten-ID": "Current map ID",
      Roboterposition: "Robot position",
      "Position der Ladestation": "Dock position",
      Räume: "Rooms",
      "Live-Fahrspur": "Live cleaning trail",
      "SVG-Karte": "SVG map",
      "Interaktive HTML-Karte": "Interactive HTML map",
      Kartendrehung: "Map rotation",
      Mehrgeschosskarten: "Multi-floor maps",
      "Mehrgeschosskarten aktiviert": "Multi-floor maps enabled",
      "ID der aktiven Etage": "Active floor ID",
      "Name der aktiven Etage": "Active floor name",
      "Anzahl der Etagen": "Number of floors",
      "Liste der Etagen": "Floor list",
      "Anzuzeigende Etagen-ID (leer = automatisch)":
        "Displayed floor ID (empty = automatic)",
      Etagenkarten: "Floor maps",
      Etagenname: "Floor name",
      Etagenindex: "Floor index",
      "Aktive Etage": "Active floor",
      "Karte vollständig erstellt": "Map completely built",
      "Räume der Etage": "Floor rooms",
      "Kartenschnappschuss der Etage": "Floor map snapshot",
      "SVG-Karte der Etage": "Floor SVG map",
      "HTML-Karte der Etage": "Floor HTML map",
      "Etage anzeigen": "Display floor",
      Darstellung: "Appearance",
      "Größe der Robotermarkierung": "Robot marker size",
      "Bild-URL der Robotermarkierung": "Robot marker image URL",
      "Erweiterte Informationen": "Extended information",
      Reinigungsstation: "Cleaning station",
      Akkustand: "Battery level",
      Ladestatus: "Charge status",
      Reinigungsstatus: "Cleaning status",
      "Aktuelle Zeitpläne": "Current schedules",
      Waschintervall: "Wash interval",
      Trocknungsstatus: "Drying status",
      "Trocknung aktiv": "Drying active",
      Trocknungsdauer: "Drying duration",
      "Bisherige Trocknungszeit": "Active drying time",
      "Verbleibende Trocknungszeit": "Remaining drying time",
      "Startzeitpunkt der Trocknung": "Drying start timestamp",
      Verbrauchsmaterialien: "Consumables",
      Reinigungsstatistik: "Cleaning statistics",
      "Aktuelle Reinigung": "Current cleaning",
      "Letzte Reinigung": "Last cleaning",
      "Behälter und Wischsystem": "Tanks and mopping system",
      Station: "Station",
      "Automatische Entleerung": "Auto-empty",
      Einstellungen: "Settings",
      "Sensoren und Erkennung": "Sensors and detection",
      Geräteinformationen: "Device information",
      Robotermodell: "Robot model",
      "Technische Modellkennung": "Technical model code",
      "Ecovacs-Geräteklasse": "Ecovacs device class",
      Firmware: "Firmware",
      "Automatische Firmware-Aktualisierung": "Automatic firmware updates",
      "Erzwungenes Firmware-Update": "Forced firmware update",
      "Fortschritt der Firmware-Aktualisierung": "Firmware update progress",
      "Firmware-Ergebniscode": "Firmware result code",
      "Firmware-Ergebnis": "Firmware result",
      "Status der Firmware-Aktualisierung": "Firmware update status",
      "Automatische Aktualisierung unterstützt": "Automatic updates supported",
      Firmwareversion: "Firmware version",
      "Firmware-Rohdaten": "Firmware raw data",
      Netzwerk: "Network",
      Systeminformationen: "System information",
      "Akkustand niedrig": "Battery low",
      "Hauptbürste verbleibend": "Main brush remaining",
      "Seitenbürste verbleibend": "Side brush remaining",
      "Filter verbleibend": "Filter remaining",
      "Roboterwartung verbleibend": "Robot maintenance remaining",
      "Wischmopps verbleibend": "Mop pads remaining",
      "Lufterfrischer verbleibend": "Air freshener remaining",
      Reinigungsprotokoll: "Cleaning log",
      "Wasserbehälter eingesetzt": "Water tank installed",
      Wischsystemtyp: "Mopping system type",
      "Wischsystem eingesetzt": "Mopping system installed",
      Wischmuster: "Scrubbing pattern",
      "Staubbehälter eingesetzt": "Dust bin installed",
      "Automatische Entleerung aktiviert": "Auto-empty enabled",
      "Status der automatischen Entleerung": "Auto-empty status",
      "Automatische Entleerung läuft": "Auto-empty active",
      "Staubbeutel voll": "Dust bag full",
      "Aktuell gereinigte Fläche": "Currently cleaned area",
      "Aktuelle Reinigungsdauer": "Current cleaning duration",
      "Aktuelle Reinigungsart": "Current cleaning type",
      "Zeitpunkt der letzten Reinigung": "Last cleaning time",
      "Fläche der letzten Reinigung": "Last cleaning area",
      "Dauer der letzten Reinigung": "Last cleaning duration",
      "Formatierte Dauer der letzten Reinigung":
        "Formatted last cleaning duration",
      "Kartenbild der letzten Reinigung": "Last cleaning map image",
      "IP-Adresse": "IP address",
      "MAC-Adresse": "MAC address",
      "WLAN-Name": "Wi-Fi name",
      "WLAN-Signalstärke": "Wi-Fi signal strength",
      Kindersicherung: "Child lock",
      "Nicht-stören aktiviert": "Do not disturb enabled",
      "Nicht-stören-Zeitraum": "Do not disturb time",
      "Saugkraftanhebung auf Teppichen": "Carpet auto-boost",
      Teppichstrategie: "Carpet strategy",
      Hinderniserkennung: "Obstacle detection",
      "Reinigungsstation aktiv": "Cleaning station active",
      "Selbstreinigung aktiv": "Self-cleaning active",
      "Partikelentfernung aktiv": "Particle removal active",
      "Tierkot-Erkennung aktiv": "Pet waste detection active",
      "Status der Reinigungsstation": "Cleaning station status",
      Stationsaktivität: "Station activity",
      "Typ des Stationsvorgangs": "Station operation type",
      "Stationsvorgang als Zahl": "Station operation code",
      "Stationsvorgang als Text": "Station operation text",
      "Informationsstatus der Reinigungsstation":
        "Cleaning station information status",
      "Name der Reinigungsstation": "Cleaning station name",
      "Modell der Reinigungsstation": "Cleaning station model",
      "Seriennummer der Reinigungsstation": "Cleaning station serial number",
      "Firmwareversion der Reinigungsstation":
        "Cleaning station firmware version",
      Wasserstatus: "Water status",
      Fehlercode: "Error code",
      Fehlermeldung: "Error message",
      "Frischwassertank leer": "Fresh water tank empty",
      "Schmutzwassertank voll": "Waste water tank full",
      Raumname: "Room name",
      Raumgruppe: "Room group",
      "Raum reinigen": "Clean room",
      "Für Raumreinigung ausgewählt": "Selected for room cleaning",
      "Ecovacs-Raumname": "Ecovacs room name",
      Raumumriss: "Room polygon",
      Raummittelpunkt: "Room center",
      Steuerung: "Control",
      "Alles reinigen": "Clean all",
      "Ausgewählte Räume reinigen": "Clean selected rooms",
      "Markierte Räume reinigen": "Clean marked rooms",
      Pausieren: "Pause",
      Fortsetzen: "Resume",
      Stoppen: "Stop",
      "Zur Ladestation zurückkehren": "Return to charger",
      "Raum-IDs": "Room IDs",
      Reinigungswiederholungen: "Cleaning repetitions",
      "Letzter Befehl": "Last command",
      "Letzter Befehlsfehler": "Last command error",
      Reinigungseinstellungen: "Cleaning settings",
      "Anzahl der Reinigungsdurchgänge": "Number of cleaning passes",
      Saugstärke: "Suction power",
      Wischmodus: "Mopping mode",
      Wassermenge: "Water level",
      Reinigungsmodus: "Cleaning mode",
      Verlauf: "History",
      "Verlauf und Live-Bericht": "History and live report",
      "Reinigungsverlauf löschen": "Clear cleaning history",
      "Anzahl gespeicherter Verlaufsereignisse":
        "Number of stored history events",
      Reinigungsverlauf: "Cleaning history",
      "Maximale Anzahl der Verlaufsereignisse":
        "Maximum number of history events",
      "Live-Bericht": "Live report",
      "Aktueller Live-Bericht": "Current live report",
      "Letztes Berichtsereignis": "Last report event",
      "Zeitpunkt des letzten Berichtsereignisses": "Last report event time",
      "Laufende Nummer des Berichtsereignisses": "Report event sequence number",
      Status: "Status",
      Kompatibilitätsstatus: "Compatibility status",
      "Erkannter Gerätename": "Detected device name",
      Roboterstatus: "Robot status",
      "Karten-ID": "Map ID",
      "Aktueller Raum": "Current room",
      "Unverarbeitete Roboterposition": "Raw robot position",
      "Erkannte Räume": "Detected rooms",
      "Kartenbildquelle erkannt": "Map image source detected",
      "Raumgeometrie erkannt": "Room geometry detected",
      "Live-Roboterposition erkannt": "Live robot position detected",
      "Reinigungssteuerung erkannt": "Cleaning controls detected",
      "Benutzerdefinierter Bereich": "Custom area",
      "Benutzerdefinierten Bereich anzeigen": "Show custom area",
      "Koordinaten des benutzerdefinierten Bereichs": "Custom area coordinates",
      "Reinigung des benutzerdefinierten Bereichs starten":
        "Start custom area cleaning",
    };
    return english[german] ? { de: german, en: english[german] } : german;
  }

  private async createButton(id: string, name: string): Promise<void> {
    await this.adapter.extendObjectAsync(id, {
      type: "state",
      common: {
        name: this.localizedName(name),
        type: "boolean",
        role: "button",
        read: false,
        write: true,
        def: false,
      },
      native: {},
    });
    await this.adapter.setStateAsync(id, false, true);
  }

  private async createReadonlyState(
    id: string,
    name: string,
    type: "string" | "number" | "boolean",
    role: string,
    expert = false,
  ): Promise<void> {
    await this.adapter.extendObjectAsync(id, {
      type: "state",
      common: {
        name: this.localizedName(name),
        type,
        role,
        read: true,
        write: false,
        ...(expert ? { expert: true as const } : {}),
      },
      native: {},
    });
  }

  private allocateObjectId(robot: RobotDescriptor): string {
    const current = this.robotObjectIds.get(robot.id);
    if (current) {
      return current;
    }
    const base = toDeviceObjectId(robot.name);
    const id = this.usedObjectIds.has(base)
      ? `${base}_${createHash("sha1").update(robot.id).digest("hex").slice(0, 6)}`
      : base;
    this.usedObjectIds.add(id);
    return id;
  }

  private requireObjectId(robotId: string): string {
    const id = this.robotObjectIds.get(robotId);
    if (!id) {
      throw new Error(`No ioBroker object ID allocated for robot ${robotId}`);
    }
    return id;
  }
}

/**
 * Converts a robot name into a valid ioBroker object identifier.
 *
 * @param name - Value of name.
 */
export function toDeviceObjectId(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return normalized || "Robot";
}
