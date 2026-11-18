/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import type { AdapterLogger, CloudCredentials, CloudSession, CloudSessionFactory, RobotDescriptor } from "../domain/types";

export interface SessionConfig {
  username: string;
  password: string;
  country: string;
  continent: string;
  deviceId: string;
  verificationCode?: string;
  authUserId?: string;
  authToken?: string;
}

export class VerificationRequiredError extends Error {
  constructor(message: string, public readonly code = "1013") {
    super(message);
    this.name = "VerificationRequiredError";
  }
}

export class SessionManager {
  private session: CloudSession | null = null;
  private loginPromise: Promise<void> | null = null;

  constructor(
    private readonly factory: CloudSessionFactory,
    private readonly logger: AdapterLogger,
  ) {}

  async login(config: SessionConfig): Promise<void> {
    if (this.session) return;
    if (this.loginPromise) return this.loginPromise;

    this.loginPromise = this.open(config);
    try {
      await this.loginPromise;
    } finally {
      this.loginPromise = null;
    }
  }

  private async open(config: SessionConfig): Promise<void> {
    this.validate(config);
    const candidate = this.factory.create({
      deviceId: config.deviceId,
      country: config.country.toLowerCase(),
      continent: config.continent.toLowerCase(),
    });

    try {
      const cachedCredentials = !config.verificationCode?.trim() && config.authUserId?.trim() && config.authToken?.trim()
        ? { userId: config.authUserId.trim(), token: config.authToken.trim() }
        : undefined;
      await candidate.login(config.username.trim(), config.password, config.verificationCode?.trim(), cachedCredentials);
      this.session = candidate;
      this.logger.info("Ecovacs session initialized; device access has not yet been confirmed");
    } catch (error) {
      await candidate.close().catch(() => undefined);
      if (error instanceof VerificationRequiredError) throw error;
      if (this.isVerificationError(error)) {
        throw new VerificationRequiredError(
          "Ecovacs rejected the login with code 1013. Account verification or an updated authentication provider is required.",
        );
      }
      throw error;
    }
  }

  async getDevices(): Promise<RobotDescriptor[]> {
    if (!this.session) throw new Error("Session is not logged in");
    return this.session.listRobots();
  }

  async refreshAuthentication(config: SessionConfig): Promise<void> {
    if (!this.session?.refreshAuthentication) throw new Error("Session does not support authentication renewal");
    await this.session.refreshAuthentication(config.username.trim(), config.password);
  }

  get current(): CloudSession {
    if (!this.session) throw new Error("Session is not logged in");
    return this.session;
  }

  get authCredentials(): CloudCredentials | null {
    return this.session?.authCredentials?.() ?? null;
  }

  async close(): Promise<void> {
    const active = this.session;
    this.session = null;
    if (active) await active.close();
  }

  private validate(config: SessionConfig): void {
    if (!config.username.trim()) throw new Error("Ecovacs username is missing");
    if (!config.password) throw new Error("Ecovacs password is missing");
    if (!/^[a-z]{2}$/i.test(config.country)) throw new Error("Country must be a two-letter code");
    if (!config.deviceId.trim()) throw new Error("A stable client device ID is required");
  }

  private isVerificationError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const candidate = error as Error & { code?: string | number; response?: { data?: { code?: string | number } } };
    return String(candidate.code ?? candidate.response?.data?.code ?? "") === "1013" || /\b1013\b/.test(error.message);
  }
}
