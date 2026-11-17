/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import { EventEmitter } from "node:events";
import type { MapSnapshot, RobotCapabilities, RobotCommand, RobotConnectionState, RobotDescriptor, RobotMapSourceUpdate, RobotSettingName, RobotTelemetryValue, Room } from "../domain/types";

export interface AdapterEvents {
  "robot:added": { robot: RobotDescriptor };
  "robot:removed": { robotId: string };
  "robot:connection": { robotId: string; state: RobotConnectionState; error?: string };
  "robot:map": { robotId: string; update: RobotMapSourceUpdate };
  "robot:command": { robotId: string; command: RobotCommand };
  "robot:capabilities": { robotId: string; capabilities: RobotCapabilities };
  "robot:setting": { robotId: string; setting: RobotSettingName; value: number };
  "robot:status": { robotId: string; status: string; source: "clean" | "charge" | "station" };
  "robot:telemetry": { robotId: string; path: string; value: RobotTelemetryValue };
  "robot:deviceImage": { robotId: string; url: string };
  "map:updated": { snapshot: MapSnapshot };
  "room:updated": { robotId: string; room: Room };
  error: { scope: string; error: Error };
}

export class EventBus {
  private readonly emitter = new EventEmitter();

  on<K extends keyof AdapterEvents>(event: K, listener: (payload: AdapterEvents[K]) => void): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  once<K extends keyof AdapterEvents>(event: K, listener: (payload: AdapterEvents[K]) => void): void {
    this.emitter.once(event, listener);
  }

  emit<K extends keyof AdapterEvents>(event: K, payload: AdapterEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
