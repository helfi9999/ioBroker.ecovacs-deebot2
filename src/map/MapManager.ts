/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import type {
  MapSnapshot,
  Point,
  RobotMapSourceUpdate,
  Room,
} from "../domain/types";
import type { EventBus } from "../events/EventBus";
import { SvgRenderer } from "./SvgRenderer";

/** Normalized map information received from a robot. */
export interface MapUpdate {
  robotId: string;
  mapId: string;
  mapName?: string | null;
  mapIndex?: number | null;
  mapStatus?: string | number | null;
  isCurrentMap?: boolean;
  isBuilt?: boolean;
  multiMapEnabled?: boolean | null;
  rooms?: Room[];
  robotPosition?: Point | null;
  dockPosition?: Point | null;
  currentRoomId?: string | null;
  currentRoomName?: string | null;
}

/** Maintains robot map snapshots and generates their SVG representations. */
export class MapManager {
  private readonly maps = new Map<string, MapSnapshot>();

  /**
   * Creates a map manager.
   *
   * @param events - Event bus for publishing map updates.
   * @param renderer - SVG renderer used to visualize maps.
   */
  constructor(
    private readonly events: EventBus,
    private readonly renderer = new SvgRenderer(),
  ) {}

  /**
   * Converts Ecovacs map data into normalized map updates.
   *
   * @param robotId - Identifier of the robot.
   * @param source - Raw map information from the robot.
   * @returns Normalized updates for the available maps.
   */
  normalizeEcovacs(robotId: string, source: RobotMapSourceUpdate): MapUpdate[] {
    const maps = Array.isArray(source.maps) ? source.maps : [];
    return maps.flatMap((value, index) => {
      if (!this.isObject(value)) {
        return [];
      }
      const mapId =
        this.stringValue(value, "mapID", "mapId", "id") ||
        source.currentMapId ||
        `map-${index}`;
      const mapName =
        this.stringValue(value, "mapName", "name") ||
        (mapId === source.currentMapId
          ? (source.currentMapName ?? null)
          : null);
      const mapIndexValue = Number(
        value.mapIndex ??
          (mapId === source.currentMapId ? source.currentMapIndex : index),
      );
      const explicitCurrent = value.mapIsCurrentMap;
      // CurrentMapMID changes immediately when the robot recognizes another
      // floor. Cached mapIsCurrentMap flags may remain stale until GetMaps is
      // refreshed, so the live ID must be authoritative whenever available.
      const isCurrentMap = source.currentMapId
        ? mapId === source.currentMapId
        : explicitCurrent === true ||
          explicitCurrent === 1 ||
          explicitCurrent === "1";
      const rawRooms = Array.isArray(value.mapSpotAreas)
        ? value.mapSpotAreas
        : [];
      const rooms: Room[] = rawRooms.flatMap((rawRoom, roomIndex) => {
        if (!this.isObject(rawRoom)) {
          return [];
        }
        const id =
          this.stringValue(rawRoom, "mapSpotAreaID", "id") || String(roomIndex);
        const ecovacsName =
          this.stringValue(rawRoom, "mapSpotAreaName", "name") || id;
        const polygon = this.parsePolygon(rawRoom.mapSpotAreaBoundaries);
        return [
          {
            id,
            ecovacsName,
            displayName: ecovacsName,
            polygon,
            center: this.center(polygon),
            groupId: null,
          },
        ];
      });
      return [
        {
          robotId,
          mapId,
          mapName,
          mapIndex: Number.isFinite(mapIndexValue) ? mapIndexValue : null,
          mapStatus:
            typeof value.mapStatus === "string" ||
            typeof value.mapStatus === "number"
              ? value.mapStatus
              : null,
          isCurrentMap,
          isBuilt:
            value.mapIsBuilt === undefined
              ? undefined
              : value.mapIsBuilt === true ||
                value.mapIsBuilt === 1 ||
                value.mapIsBuilt === "1",
          multiMapEnabled: source.multiMapEnabled,
          rooms,
          robotPosition: isCurrentMap ? source.robotPosition : null,
          dockPosition: isCurrentMap ? source.dockPosition : null,
          currentRoomId: isCurrentMap ? source.currentRoomId : null,
          currentRoomName: isCurrentMap ? source.currentRoomName : null,
        },
      ];
    });
  }

  /**
   * Updates a stored map and publishes its rendered snapshot.
   *
   * @param input - Map information to store.
   * @returns Independent copy of the updated snapshot.
   */
  update(input: MapUpdate): MapSnapshot {
    const key = `${input.robotId}:${input.mapId}`;
    const previous = this.maps.get(key);
    const snapshot: MapSnapshot = {
      robotId: input.robotId,
      mapId: input.mapId,
      mapName:
        input.mapName === undefined
          ? (previous?.mapName ?? null)
          : input.mapName,
      mapIndex:
        input.mapIndex === undefined
          ? (previous?.mapIndex ?? null)
          : input.mapIndex,
      mapStatus:
        input.mapStatus === undefined
          ? (previous?.mapStatus ?? null)
          : input.mapStatus,
      isCurrentMap:
        input.isCurrentMap === undefined
          ? previous?.isCurrentMap
          : input.isCurrentMap,
      isBuilt: input.isBuilt === undefined ? previous?.isBuilt : input.isBuilt,
      multiMapEnabled:
        input.multiMapEnabled === undefined
          ? (previous?.multiMapEnabled ?? null)
          : input.multiMapEnabled,
      revision: (previous?.revision ?? 0) + 1,
      rooms: input.rooms
        ? structuredClone(input.rooms)
        : structuredClone(previous?.rooms ?? []),
      robotPosition:
        input.robotPosition === undefined
          ? (previous?.robotPosition ?? null)
          : input.robotPosition,
      dockPosition:
        input.dockPosition === undefined
          ? (previous?.dockPosition ?? null)
          : input.dockPosition,
      currentRoomId:
        input.currentRoomId === undefined
          ? (previous?.currentRoomId ?? null)
          : input.currentRoomId,
      currentRoomName:
        input.currentRoomName === undefined
          ? (previous?.currentRoomName ?? null)
          : input.currentRoomName,
      svg: "",
      updatedAt: new Date().toISOString(),
    };
    snapshot.svg = this.renderer.render(snapshot);
    this.maps.set(key, snapshot);
    this.events.emit("map:updated", { snapshot: structuredClone(snapshot) });
    return structuredClone(snapshot);
  }

  /**
   * Retrieves a stored map snapshot.
   *
   * @param robotId - Identifier of the robot.
   * @param mapId - Identifier of the map.
   * @returns Map snapshot, or undefined if not found.
   */
  get(robotId: string, mapId: string): MapSnapshot | undefined {
    const value = this.maps.get(`${robotId}:${mapId}`);
    return value ? structuredClone(value) : undefined;
  }

  /**
   * Lists the stored map snapshots for a robot.
   *
   * @param robotId - Identifier of the robot.
   * @returns Independent copies of the robot's map snapshots.
   */
  list(robotId: string): MapSnapshot[] {
    return [...this.maps.values()]
      .filter((map) => map.robotId === robotId)
      .map((map) => structuredClone(map));
  }

  private parsePolygon(value: unknown): Point[] {
    if (Array.isArray(value)) {
      return value.flatMap((point) =>
        this.isObject(point) &&
        Number.isFinite(Number(point.x)) &&
        Number.isFinite(Number(point.y))
          ? [{ x: Number(point.x), y: Number(point.y) }]
          : [],
      );
    }
    if (typeof value !== "string") {
      return [];
    }
    return value.split(";").flatMap((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
    });
  }

  private center(points: Point[]): Point | null {
    if (!points.length) {
      return null;
    }
    const sum = points.reduce(
      (result, point) => ({ x: result.x + point.x, y: result.y + point.y }),
      { x: 0, y: 0 },
    );
    return { x: sum.x / points.length, y: sum.y / points.length };
  }

  private stringValue(
    value: Record<string, unknown>,
    ...keys: string[]
  ): string {
    for (const key of keys) {
      const candidate = value[key];
      if (
        (typeof candidate === "string" || typeof candidate === "number") &&
        String(candidate).trim()
      ) {
        return String(candidate);
      }
    }
    return "";
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
