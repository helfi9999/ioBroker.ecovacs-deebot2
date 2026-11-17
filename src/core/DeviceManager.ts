/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import type { CloudSession, RobotCommand, RobotDescriptor } from "../domain/types";
import { Robot } from "../devices/Robot";
import { EventBus } from "../events/EventBus";

export interface ReconcileResult {
  added: string[];
  removed: string[];
  retained: string[];
}

export class DeviceManager {
  private readonly devices = new Map<string, Robot>();

  constructor(private readonly session: CloudSession, private readonly events: EventBus) {}

  get(id: string): Robot | undefined { return this.devices.get(id); }
  all(): Robot[] { return [...this.devices.values()]; }
  get size(): number { return this.devices.size; }

  execute(robotId: string, command: RobotCommand): void {
    const robot = this.devices.get(robotId);
    if (!robot) throw new Error(`Unknown robot ${robotId}`);
    robot.execute(command);
  }

  async reconcile(descriptors: RobotDescriptor[]): Promise<ReconcileResult> {
    const unique = new Map(descriptors.map(device => [device.id, device]));
    if (unique.size !== descriptors.length) throw new Error("Ecovacs returned duplicate device IDs");

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
      const robot = new Robot(descriptor, this.session.createTransport(descriptor), this.events);
      this.devices.set(descriptor.id, robot);
      result.added.push(descriptor.id);
      this.events.emit("robot:added", { robot: descriptor });
    }

    await Promise.all(result.added.map(id => this.devices.get(id)!.connect()));
    return result;
  }

  async disconnectAll(): Promise<void> {
    const robots = this.all();
    this.devices.clear();
    await Promise.allSettled(robots.map(robot => robot.disconnect()));
  }
}
