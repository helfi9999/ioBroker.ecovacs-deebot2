/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import type {
  RobotCommand,
  RobotConnectionState,
  RobotDescriptor,
  RobotTransport,
} from "../domain/types";
import type { EventBus } from "../events/EventBus";

/** Represents a robot and manages its transport connection and events. */
export class Robot {
  private stateValue: RobotConnectionState = "disconnected";
  private readonly unsubscribeMap?: () => void;
  private readonly unsubscribeSettings?: () => void;
  private readonly unsubscribeStatus?: () => void;
  private readonly unsubscribeTelemetry?: () => void;

  /**
   * Creates a robot and subscribes to transport updates.
   *
   * @param descriptor - Information identifying the robot.
   * @param transport - Transport used to communicate with the robot.
   * @param events - Event bus for publishing robot updates.
   */
  constructor(
    public readonly descriptor: RobotDescriptor,
    private readonly transport: RobotTransport,
    private readonly events: EventBus,
  ) {
    this.unsubscribeMap = this.transport.onMapUpdate?.((update) => {
      this.events.emit("robot:map", { robotId: this.id, update });
    });
    this.unsubscribeSettings = this.transport.onSettingUpdate?.(
      (setting, value) => {
        this.events.emit("robot:setting", { robotId: this.id, setting, value });
      },
    );
    this.unsubscribeStatus = this.transport.onStatusUpdate?.(
      (status, source) => {
        this.events.emit("robot:status", { robotId: this.id, status, source });
      },
    );
    this.unsubscribeTelemetry = this.transport.onTelemetryUpdate?.(
      (path, value) => {
        this.events.emit("robot:telemetry", { robotId: this.id, path, value });
      },
    );
  }

  /** Returns the robot's unique identifier. */
  get id(): string {
    return this.descriptor.id;
  }
  /** Returns the robot's display name. */
  get name(): string {
    return this.descriptor.name;
  }
  /** Returns the current connection state. */
  get state(): RobotConnectionState {
    return this.stateValue;
  }

  /** Requests fresh map information when connected. */
  refreshMap(): void {
    if (this.stateValue === "connected") {
      this.transport.requestMap?.();
    }
  }

  /** Requests fresh telemetry information when connected. */
  refreshTelemetry(): void {
    if (this.stateValue === "connected") {
      this.transport.requestTelemetry?.();
    }
  }

  /**
   * Sends a command to the connected robot.
   *
   * @param command - Command to execute.
   */
  execute(command: RobotCommand): void {
    if (this.stateValue !== "connected") {
      throw new Error(`Robot ${this.name} is not connected`);
    }
    if (!this.transport.execute) {
      throw new Error(`Robot ${this.name} does not support commands`);
    }
    this.transport.execute(command);
  }

  /** Connects the robot and initializes its available information. */
  async connect(): Promise<void> {
    if (this.stateValue === "connected" || this.stateValue === "connecting") {
      return;
    }
    this.setState("connecting");
    try {
      await this.transport.connect();
      this.setState("connected");
      const deviceImageUrl = this.transport.deviceImageUrl?.().trim();
      if (deviceImageUrl) {
        this.events.emit("robot:deviceImage", {
          robotId: this.id,
          url: deviceImageUrl,
        });
      }
      this.transport.requestMap?.();
      this.events.emit("robot:capabilities", {
        robotId: this.id,
        capabilities: this.transport.capabilities?.() ?? {
          cleanSpeed: false,
          waterLevel: false,
          cleanCount: false,
          moppingMode: false,
          cleaningMode: false,
          customArea: false,
        },
      });
      this.transport.requestSettings?.();
      this.transport.requestTelemetry?.();
    } catch (error) {
      this.setState("error", error);
      throw error;
    }
  }

  /** Disconnects the robot and removes transport subscriptions. */
  async disconnect(): Promise<void> {
    try {
      await this.transport.disconnect();
    } finally {
      this.unsubscribeMap?.();
      this.unsubscribeSettings?.();
      this.unsubscribeStatus?.();
      this.unsubscribeTelemetry?.();
      this.setState("disconnected");
    }
  }

  private setState(state: RobotConnectionState, error?: unknown): void {
    this.stateValue = state;
    this.events.emit("robot:connection", {
      robotId: this.id,
      state,
      ...(error
        ? {
            error:
              error instanceof Error
                ? error.message
                : typeof error === "string"
                  ? error
                  : typeof error === "number" ||
                      typeof error === "boolean" ||
                      typeof error === "bigint" ||
                      typeof error === "symbol"
                    ? String(error)
                    : Object.prototype.toString.call(error),
          }
        : {}),
    });
  }
}
