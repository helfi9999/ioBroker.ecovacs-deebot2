/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import { EventEmitter } from "node:events";
import type {
  MapSnapshot,
  RobotCapabilities,
  RobotCommand,
  RobotConnectionState,
  RobotDescriptor,
  RobotMapSourceUpdate,
  RobotSettingName,
  RobotTelemetryValue,
  Room,
} from "../domain/types";

/** Defines the event names and their associated payload types. */
export interface AdapterEvents {
  "robot:added": { robot: RobotDescriptor };
  "robot:removed": { robotId: string };
  "robot:connection": {
    robotId: string;
    state: RobotConnectionState;
    error?: string;
  };
  "robot:map": { robotId: string; update: RobotMapSourceUpdate };
  "robot:command": { robotId: string; command: RobotCommand };
  "robot:capabilities": { robotId: string; capabilities: RobotCapabilities };
  "robot:setting": {
    robotId: string;
    setting: RobotSettingName;
    value: number;
  };
  "robot:status": {
    robotId: string;
    status: string;
    source: "clean" | "charge" | "station";
  };
  "robot:telemetry": {
    robotId: string;
    path: string;
    value: RobotTelemetryValue;
  };
  "robot:deviceImage": { robotId: string; url: string };
  "map:updated": { snapshot: MapSnapshot };
  "room:updated": { robotId: string; room: Room };
  error: { scope: string; error: Error };
}

/** Provides type-safe communication between adapter components. */
export class EventBus {
  private readonly emitter = new EventEmitter();

  /**
   * Subscribes to an event and returns a function to unsubscribe.
   *
   * @param event - Name of the event to subscribe to.
   * @param listener - Callback receiving the event payload.
   * @returns Function that removes this listener.
   */
  on<K extends keyof AdapterEvents>(
    event: K,
    listener: (payload: AdapterEvents[K]) => void,
  ): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  /**
   * Registers a listener that runs only for the next matching event.
   *
   * @param event - Name of the event to observe.
   * @param listener - Callback invoked once with the event payload.
   */
  once<K extends keyof AdapterEvents>(
    event: K,
    listener: (payload: AdapterEvents[K]) => void,
  ): void {
    this.emitter.once(event, listener);
  }

  /**
   * Delivers an event payload to its registered listeners.
   *
   * @param event - Name of the event to emit.
   * @param payload - Data delivered to the event listeners.
   */
  emit<K extends keyof AdapterEvents>(
    event: K,
    payload: AdapterEvents[K],
  ): void {
    this.emitter.emit(event, payload);
  }

  /** Removes all registered event listeners. */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
