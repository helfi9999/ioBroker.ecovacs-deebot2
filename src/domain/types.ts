/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

/** Logging interface used by the adapter's domain services. */
export interface AdapterLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Identifies a robot discovered through an Ecovacs cloud session. */
export interface RobotDescriptor {
  id: string;
  name: string;
  model: string;
  modelCode?: string;
  deviceClass: string;
  company?: string;
  raw: Record<string, unknown>;
}

export type RobotConnectionState =
  "disconnected" | "connecting" | "connected" | "error";

export type RobotCommand =
  | { type: "cleanAll" }
  | { type: "cleanRooms"; roomIds: string[]; repetitions: 1 | 2 }
  | { type: "pause" | "resume" | "stop" | "charge" }
  | { type: "cleanCustomArea"; coordinates: string; repetitions: 1 | 2 }
  | { type: "setSetting"; setting: RobotSettingName; value: number };

export type RobotSettingName =
  "cleanSpeed" | "waterLevel" | "cleanCount" | "moppingMode" | "cleaningMode";
export type RobotCapabilities = Record<RobotSettingName, boolean> & {
  customArea: boolean;
};
export type RobotTelemetryValue =
  string | number | boolean | Record<string, unknown> | unknown[];

/** Defines the connection, commands, and event subscriptions for a robot. */
export interface RobotTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMapUpdate?(listener: (update: RobotMapSourceUpdate) => void): () => void;
  requestMap?(): void;
  execute?(command: RobotCommand): void;
  capabilities?(): RobotCapabilities;
  onSettingUpdate?(
    listener: (setting: RobotSettingName, value: number) => void,
  ): () => void;
  requestSettings?(): void;
  onStatusUpdate?(
    listener: (status: string, source: "clean" | "charge" | "station") => void,
  ): () => void;
  onTelemetryUpdate?(
    listener: (path: string, value: RobotTelemetryValue) => void,
  ): () => void;
  requestTelemetry?(): void;
  deviceImageUrl?(): string;
}

/** Contains raw map and position updates received from a robot. */
export interface RobotMapSourceUpdate {
  maps: unknown;
  currentMapId: string | null;
  currentMapName?: string | null;
  currentMapIndex?: number | null;
  multiMapEnabled?: boolean | null;
  robotPosition: Point | null;
  dockPosition: Point | null;
  currentRoomId?: string | null;
  currentRoomName?: string | null;
}

/** Defines authentication, robot discovery, and transport creation. */
export interface CloudSession {
  login(
    account: string,
    password: string,
    verificationCode?: string,
    cachedCredentials?: CloudCredentials,
  ): Promise<void>;
  refreshAuthentication?(account: string, password: string): Promise<void>;
  authCredentials?(): CloudCredentials | null;
  listRobots(): Promise<RobotDescriptor[]>;
  createTransport(robot: RobotDescriptor): RobotTransport;
  close(): Promise<void>;
}

/** Contains the user identifier and token for an authenticated cloud session. */
export interface CloudCredentials {
  userId: string;
  token: string;
}

/** Creates cloud sessions for a selected device and region. */
export interface CloudSessionFactory {
  create(options: {
    deviceId: string;
    country: string;
    continent: string;
  }): CloudSession;
}

/** Represents a two-dimensional coordinate on a robot map. */
export interface Point {
  x: number;
  y: number;
}

/** Describes a mapped room, including its geometry and group assignment. */
export interface Room {
  id: string;
  ecovacsName: string;
  displayName: string;
  polygon: Point[];
  center: Point | null;
  groupId: string | null;
}

/** Represents a group of rooms used for cleaning selections. */
export interface RoomGroup {
  id: string;
  name: string;
  roomIds: string[];
}

/** Represents a normalized snapshot of a robot's map. */
export interface MapSnapshot {
  robotId: string;
  mapId: string;
  mapName?: string | null;
  mapIndex?: number | null;
  mapStatus?: string | number | null;
  isCurrentMap?: boolean;
  isBuilt?: boolean;
  multiMapEnabled?: boolean | null;
  revision: number;
  rooms: Room[];
  robotPosition: Point | null;
  dockPosition: Point | null;
  currentRoomId?: string | null;
  currentRoomName?: string | null;
  svg: string;
  updatedAt: string;
}
