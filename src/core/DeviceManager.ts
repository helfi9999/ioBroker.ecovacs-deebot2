/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import type {
  CloudSession,
  RobotCommand,
  RobotDescriptor,
} from "../domain/types";
import { Robot } from "../devices/Robot";
import type { EventBus } from "../events/EventBus";

/** Lists robots added, removed, or retained during reconciliation. */
export interface ReconcileResult {
  added: string[];
  removed: string[];
  retained: string[];
}

/** Manages robot instances and synchronizes them with cloud discovery. */
export class DeviceManager {
  private readonly devices = new Map<string, Robot>();

  /**
   * Creates a device manager.
   *
   * @param session - Cloud session used to create robot transports.
   * @param events - Event bus for robot lifecycle notifications.
   */
  constructor(
    private readonly session: CloudSession,
    private readonly events: EventBus,
  ) {}

  /**
   * Finds a robot by its identifier.
   *
   * @param id - Robot identifier.
   * @returns Robot instance, or undefined if not found.
   */
  get(id: string): Robot | undefined {
    return this.devices.get(id);
  }
  /**
   * Returns all currently managed robots.
   *
   * @returns Array of robot instances.
   */
  all(): Robot[] {
    return [...this.devices.values()];
  }
  /** Returns the number of currently managed robots. */
  get size(): number {
    return this.devices.size;
  }

  /**
   * Sends a command to a managed robot.
   *
   * @param robotId - Identifier of the target robot.
   * @param command - Command to execute.
   */
  execute(robotId: string, command: RobotCommand): void {
    const robot = this.devices.get(robotId);
    if (!robot) {
      throw new Error(`Unknown robot ${robotId}`);
    }
    robot.execute(command);
  }

  /**
   * Synchronizes managed robots with the latest cloud discovery results.
   *
   * @param descriptors - Robots currently reported by the cloud.
   * @returns Identifiers of added, removed, and retained robots.
   */
  async reconcile(descriptors: RobotDescriptor[]): Promise<ReconcileResult> {
    const unique = new Map(descriptors.map((device) => [device.id, device]));
    if (unique.size !== descriptors.length) {
      throw new Error("Ecovacs returned duplicate device IDs");
    }

    const result: ReconcileResult = { added: [], removed: [], retained: [] };

    for (const [id, robot] of this.devices) {
      if (!unique.has(id)) {
        await robot.disconnect();
        this.devices.delete(id);
        result.removed.push(id);
        this.events.emit("robot:removed", { robotId: id });
      }
    }

    for (const descriptor of unique.values()) {
      const current = this.devices.get(descriptor.id);
      if (current) {
        result.retained.push(descriptor.id);
        current.refreshMap();
        current.refreshTelemetry();
        continue;
      }
      const robot = new Robot(
        descriptor,
        this.session.createTransport(descriptor),
        this.events,
      );
      this.devices.set(descriptor.id, robot);
      result.added.push(descriptor.id);
      this.events.emit("robot:added", { robot: descriptor });
    }

    await Promise.all(
      result.added.map((id) => this.devices.get(id)!.connect()),
    );
    return result;
  }

  /** Disconnects all managed robots and clears the device registry. */
  async disconnectAll(): Promise<void> {
    const robots = this.all();
    this.devices.clear();
    await Promise.allSettled(robots.map((robot) => robot.disconnect()));
  }
}
