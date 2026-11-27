/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import {
  constants as cryptoConstants,
  createHash,
  createPublicKey,
  publicEncrypt,
} from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { VerificationRequiredError } from "../auth/SessionManager";
import type { TimerService } from "./TimerService";
import type {
  CloudCredentials,
  CloudSession,
  CloudSessionFactory,
  Point,
  RobotCapabilities,
  RobotCommand,
  RobotDescriptor,
  RobotMapSourceUpdate,
  RobotSettingName,
  RobotTelemetryValue,
  RobotTransport,
} from "../domain/types";

const loadVendorModule = createRequire(__filename);

type RawDevice = Record<string, unknown>;
type JsonObject = Record<string, unknown>;

function apiValueToString(value: unknown, fallback = ""): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

interface VacBotLike {
  timerService?: TimerService;
  ecovacs?: {
    handleMessage?: (topic: string, payload: unknown, type?: string) => void;
    disconnect?: () => unknown;
    on?: (event: string, listener: () => void) => void;
    removeListener?: (event: string, listener: () => void) => void;
    client?: { end(force?: boolean): unknown };
  };
  deviceImageURL?: string;
  currentSpotAreas?: unknown;
  currentCustomAreaValues?: unknown;
  connect?: () => void | Promise<void>;
  disconnect?: () => void | Promise<void>;
  disconnectAsync?: () => Promise<void>;
  on(name: string, listener: (value?: unknown) => void): void;
  removeListener?: (name: string, listener: (value?: unknown) => void) => void;
  run(command: string, ...args: unknown[]): void;
  hasMappingCapabilities?: () => boolean;
  hasSpotAreaCleaningMode?: () => boolean;
  hasCustomAreaCleaningMode?: () => boolean;
  hasMoppingSystem?: () => boolean;
  hasVacuumPowerAdjustment?: () => boolean;
  hasMainBrush?: () => boolean;
  hasSideBrush?: () => boolean;
  hasFilter?: () => boolean;
  hasUnitCareInfo?: () => boolean;
  hasRoundMopInfo?: () => boolean;
  hasAutoEmptyStation?: () => boolean;
  is950type?: () => boolean;
  getProtocol?: () => string;
}

interface EcoVacsApiLike {
  uid: string;
  user_access_token: string;
  devices(): Promise<RawDevice[] | Record<string, RawDevice>>;
  getVacBotObj(device: RawDevice): VacBotLike;
}

interface EcoVacsModule {
  EcoVacsAPI: new (
    deviceId: string,
    country: string,
    continent?: string,
  ) => EcoVacsApiLike;
}

interface Credentials {
  userId: string;
  token: string;
}

/**
 * Represents an error returned by the Ecovacs authentication API.
 */
export class EcovacsAuthApiError extends Error {
  /**
   * Creates an authentication error with its API error code.
   *
   * @param code - Error code reported by the API.
   * @param message - Description of the error.
   */
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EcovacsAuthApiError";
  }
}

/**
 * Handles modern Ecovacs account and device authentication.
 */
export class ModernEcovacsAuthenticator {
  private static readonly clientKey = "1520391301804";
  private static readonly clientSecret = "6c319b2a5cd3e66e39159c2e28f2fce9";
  private static readonly authClientKey = "1520391491841";
  private static readonly authClientSecret = "77ef58ce3afbe337da74aa8c5ab963a9";
  private static readonly meta = {
    lang: "EN",
    appCode: "global_e",
    appVersion: "3.14.0",
    channel: "google_play",
    deviceType: "1",
  } as const;

  private publicKey: ReturnType<typeof createPublicKey> | null = null;

  /**
   * Creates an authenticator using the supplied API configuration.
   *
   * @param options - Configuration options.
   * @param options.deviceId - Stable client device identifier.
   * @param options.country - Two-letter country code.
   * @param options.continent - Ecovacs server region.
   * @param fetcher - Value of fetcher.
   */
  constructor(
    private readonly options: {
      deviceId: string;
      country: string;
      continent: string;
    },
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /**
   * Authenticates an Ecovacs account.
   *
   * @param account - Ecovacs account identifier.
   * @param password - Ecovacs account password.
   */
  async login(account: string, password: string): Promise<Credentials> {
    const data = await this.callPrivate("user/login", {
      account,
      password: this.md5(password),
    });
    return this.completeLogin(data);
  }

  /**
   * Requests an email verification code for the account.
   *
   * @param account - Ecovacs account identifier.
   */
  async requestVerificationCode(account: string): Promise<void> {
    await this.callPrivate("user/sendEmailVerifyCode", {
      encryptEmail: await this.encryptAccount(account),
      verifyType: "EMAIL_VERIFY_DEVICE",
      supportChar: "N",
      isForce: "N",
    });
  }

  /**
   * Verifies a device using the received verification code.
   *
   * @param account - Ecovacs account identifier.
   * @param verificationCode - Code received during device verification.
   */
  async verifyDevice(
    account: string,
    verificationCode: string,
  ): Promise<Credentials> {
    const data = await this.callPrivate("user/verifyDevice", {
      encryptAccount: await this.encryptAccount(account),
      backUpEmail: "",
      verifyCode: verificationCode.trim(),
      model: "Pixel 7",
      system: "Android 14",
    });
    return this.completeLogin(data);
  }

  private async completeLogin(value: unknown): Promise<Credentials> {
    const data = this.expectObject(value, "Invalid Ecovacs login response");
    const uid =
      typeof data.uid === "string" || typeof data.uid === "number"
        ? String(data.uid)
        : "";
    const accessToken =
      typeof data.accessToken === "string" ||
      typeof data.accessToken === "number"
        ? String(data.accessToken)
        : "";
    if (!uid || !accessToken) {
      throw new Error("Ecovacs login response contains no credentials");
    }
    return this.loginByItToken(uid, await this.getAuthCode(uid, accessToken));
  }

  private async callPrivate(
    endpoint: string,
    params: Record<string, string | number>,
  ): Promise<unknown> {
    const country = this.options.country.toLowerCase();
    const meta = {
      ...ModernEcovacsAuthenticator.meta,
      country,
      deviceId: this.options.deviceId,
    };
    const path = `/v1/private/${country}/${meta.lang}/${meta.deviceId}/${meta.appCode}/${meta.appVersion}/${meta.channel}/${meta.deviceType}/${endpoint}`;
    const now = Date.now();
    const query = this.sign(
      {
        ...params,
        requestId: this.md5(String(now / 1000)),
        authTimespan: now,
        authTimeZone: "GMT-8",
      },
      meta,
      ModernEcovacsAuthenticator.clientKey,
      ModernEcovacsAuthenticator.clientSecret,
    );
    const url = new URL(path, `https://gl-${country}-api.ecovacs.com`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
    return this.getAuthResponse(url);
  }

  private async getAuthCode(uid: string, accessToken: string): Promise<string> {
    const params = this.sign(
      {
        uid,
        accessToken,
        bizType: "ECOVACS_IOT",
        deviceId: this.options.deviceId,
        authTimespan: Date.now(),
      },
      { openId: "global" },
      ModernEcovacsAuthenticator.authClientKey,
      ModernEcovacsAuthenticator.authClientSecret,
    );
    const country = this.options.country.toLowerCase();
    const url = new URL(
      "/v1/global/auth/getAuthCode",
      `https://gl-${country}-openapi.ecovacs.com`,
    );
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
    const data = this.expectObject(
      await this.getAuthResponse(url),
      "Invalid Ecovacs auth-code response",
    );
    const code =
      typeof data.authCode === "string" || typeof data.authCode === "number"
        ? String(data.authCode)
        : "";
    if (!code) {
      throw new Error("Ecovacs auth-code response is empty");
    }
    return code;
  }

  private async loginByItToken(
    userId: string,
    authCode: string,
  ): Promise<Credentials> {
    const url = new URL(
      "/api/users/user.do",
      `https://portal-${this.options.continent.toLowerCase()}.ecouser.net`,
    );
    const body = {
      edition: "ECOGLOBLE",
      userId,
      token: authCode,
      realm: "ecouser.net",
      resource: this.options.deviceId,
      org: "ECOWW",
      last: "",
      country: this.options.country.toUpperCase(),
      todo: "loginByItToken",
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`Ecovacs portal returned HTTP ${response.status}`);
      }
      const data = this.expectObject(
        await response.json(),
        "Invalid Ecovacs portal response",
      );
      if (data.result === "ok") {
        const token =
          typeof data.token === "string" || typeof data.token === "number"
            ? String(data.token)
            : "";
        const returnedUserId =
          typeof data.userId === "string" || typeof data.userId === "number"
            ? String(data.userId)
            : userId;
        if (!token) {
          throw new Error("Ecovacs portal response contains no token");
        }
        return { userId: returnedUserId, token };
      }
      if (!(data.result === "fail" && data.error === "set token error.")) {
        throw new Error(
          `Ecovacs portal login failed: ${apiValueToString(data.error, "unknown error")}`,
        );
      }
    }
    throw new Error("Ecovacs portal token login failed after three attempts");
  }

  private async getAuthResponse(url: URL): Promise<unknown> {
    const response = await this.fetcher(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(
        `Ecovacs authentication returned HTTP ${response.status}`,
      );
    }
    const result = this.expectObject(
      await response.json(),
      "Invalid Ecovacs authentication response",
    );
    const code = apiValueToString(result.code);
    if (code === "0000") {
      return result.data;
    }
    throw new EcovacsAuthApiError(
      code,
      apiValueToString(result.msg, `Ecovacs authentication failed (${code})`),
    );
  }

  private async encryptAccount(account: string): Promise<string> {
    return publicEncrypt(
      {
        key: await this.getPublicKey(),
        padding: cryptoConstants.RSA_PKCS1_PADDING,
      },
      Buffer.from(account, "utf8"),
    ).toString("base64");
  }

  private async getPublicKey(): Promise<ReturnType<typeof createPublicKey>> {
    if (this.publicKey) {
      return this.publicKey;
    }
    const value = await this.callPrivate("common/getConfig", {
      keys: "PUBLIC.KEY.CONFIG",
    });
    if (!Array.isArray(value)) {
      throw new Error("Invalid Ecovacs public-key response");
    }
    const entry = value.find(
      (item) => this.isObject(item) && item.key === "PUBLIC.KEY.CONFIG",
    );
    if (!entry || !this.isObject(entry) || typeof entry.value !== "string") {
      throw new Error("Ecovacs public key is missing");
    }
    const config = this.expectObject(
      JSON.parse(entry.value),
      "Invalid Ecovacs public-key configuration",
    );
    if (typeof config.publicKey !== "string") {
      throw new Error("Invalid Ecovacs public key");
    }
    this.publicKey = createPublicKey({
      key: Buffer.from(config.publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    return this.publicKey;
  }

  private sign(
    params: Record<string, string | number>,
    additional: Record<string, string | number>,
    key: string,
    secret: string,
  ): Record<string, string | number> {
    const signData = { ...additional, ...params };
    const text =
      key +
      Object.keys(signData)
        .sort()
        .map((name) => `${name}=${signData[name]}`)
        .join("") +
      secret;
    return { ...params, authSign: this.md5(text), authAppkey: key };
  }

  private md5(value: string): string {
    return createHash("md5").update(value).digest("hex");
  }

  private expectObject(value: unknown, message: string): JsonObject {
    if (!this.isObject(value)) {
      throw new Error(message);
    }
    return value;
  }

  private isObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}

/**
 * Connects to a robot and translates protocol events and commands.
 */
export class VacBotTransport implements RobotTransport {
  private readonly warn: (message: string) => void;
  private readonly listeners = new Set<
    (update: RobotMapSourceUpdate) => void
  >();
  private maps: unknown = [];
  private currentMapId: string | null = null;
  private currentMapName: string | null = null;
  private currentMapIndex: number | null = null;
  private multiMapEnabled: boolean | null = null;
  private robotPosition: Point | null = null;
  private dockPosition: Point | null = null;
  private currentRoomId: string | null = null;
  private currentRoomName: string | null = null;
  private readonly handlers: Array<{
    event: string;
    listener: (value?: unknown) => void;
  }> = [];
  private readonly mapRetryTimers = new Set<ioBroker.Timeout>();
  private positionPollingTimer: ioBroker.Interval | undefined;
  private runtimePollingTimer: ioBroker.Interval | undefined;
  private positionPollingStopTimer: ioBroker.Timeout | undefined;
  private settingsRefreshTimer: ioBroker.Timeout | undefined;
  private readonly settingListeners = new Set<
    (setting: RobotSettingName, value: number) => void
  >();
  private waterLevel = 1;
  private readonly detectedCapabilities = new Set<RobotSettingName>();
  private readonly statusListeners = new Set<
    (status: string, source: "clean" | "charge" | "station") => void
  >();
  private readonly telemetryListeners = new Set<
    (path: string, value: RobotTelemetryValue) => void
  >();
  private errorTelemetryInitialized = false;
  private lastErrorDescription = "";

  /**
   * Creates a robot transport with logging and timer services.
   *
   * @param vacbot - Underlying Ecovacs robot implementation.
   * @param warn - Callback used to report warnings.
   * @param timers - Timer service supplied by the adapter.
   */
  constructor(
    private readonly vacbot: VacBotLike,
    warn: ((message: string) => void) | undefined,
    private readonly timers: TimerService,
  ) {
    this.warn = warn ?? (() => {});
    this.vacbot.timerService = this.timers;
    this.guardProtocolDisconnect();
    this.ignoreMalformedXmlMessages();
    this.listen("MapDataObject", (value) => {
      this.maps = value ?? [];
      this.clearMapRetries();
      this.emitMap();
    });
    this.listen("CurrentMapMID", (value) => {
      this.currentMapId =
        value == null ? null : apiValueToString(value) || null;
      this.emitMap();
    });
    this.listen("CurrentMapName", (value) => {
      this.currentMapName =
        value == null ? null : apiValueToString(value) || null;
      this.emitMap();
    });
    this.listen("CurrentMapIndex", (value) => {
      const index = Number(value);
      this.currentMapIndex = Number.isFinite(index) ? index : null;
      this.emitMap();
    });
    this.listen("MultiMapState", (value) => {
      this.multiMapEnabled = value === true || value === 1 || value === "1";
      this.emitMap();
    });
    this.listen("Position", (value) => {
      this.robotPosition = this.point(value);
      this.emitMap();
    });
    this.listen("ChargingPosition", (value) => {
      this.dockPosition = this.point(value);
      this.emitMap();
    });
    this.listen("DeebotPositionCurrentSpotAreaID", (value) => {
      this.currentRoomId = this.cleanRoomValue(value);
      this.emitMap();
    });
    this.listen("DeebotPositionCurrentSpotAreaName", (value) => {
      this.currentRoomName = this.cleanRoomValue(value);
      this.emitMap();
    });
    this.listen("ready", () => this.requestMap());
    this.listen("CleanSpeed", (value) => this.emitSetting("cleanSpeed", value));
    this.listen("WaterLevel", (value) => {
      const level = Number(value);
      if (Number.isFinite(level)) {
        this.waterLevel = level;
      }
      this.emitSetting("waterLevel", value);
    });
    this.listen("CleanCount", (value) => this.emitSetting("cleanCount", value));
    this.listen("SweepMode", (value) => this.emitSetting("moppingMode", value));
    this.listen("WorkMode", (value) => this.emitSetting("cleaningMode", value));
    this.listen("MoppingSystemInfo", (value) => this.handleMoppingInfo(value));
    this.listen("CurrentSpotAreas", (value) =>
      this.emitTelemetry(
        "cleaning.currentSpotAreas",
        this.telemetryValue(value),
      ),
    );
    this.listen("CurrentCustomAreaValues", (value) =>
      this.emitTelemetry(
        "cleaning.currentCustomAreaValues",
        this.telemetryValue(value),
      ),
    );
    this.listen("LastUsedAreaValues", (value) =>
      this.emitTelemetry(
        "cleaning.currentCustomAreaValues",
        this.telemetryValue(value),
      ),
    );
    this.listen("CleanReport", (value) => {
      const status = this.statusText(value);
      const areas = apiValueToString(this.vacbot.currentSpotAreas).trim();
      const customAreaValues = apiValueToString(
        this.vacbot.currentCustomAreaValues,
      ).trim();
      this.emitTelemetry("cleanStatus", status);
      if (customAreaValues && /custom[_-]?area/i.test(status)) {
        this.emitTelemetry(
          "cleaning.currentCustomAreaValues",
          customAreaValues,
        );
        this.emitStatus(`${status}|${customAreaValues}`, "clean");
      } else {
        this.emitStatus(
          areas && /spot[_-]?area/i.test(status)
            ? `${status}|${areas}`
            : status,
          "clean",
        );
      }
    });
    this.listen("ChargeState", (value) => {
      this.emitTelemetry("chargeStatus", this.statusText(value));
      this.emitStatus(value, "charge");
    });
    this.listen("BatteryInfo", (value) =>
      this.emitTelemetry("battery", Math.round(Number(value))),
    );
    this.listen("BatteryIsLow", (value) =>
      this.emitTelemetry("extended.batteryLow", Boolean(value)),
    );
    for (const [event, name] of [
      ["main_brush", "mainBrush"],
      ["side_brush", "sideBrush"],
      ["filter", "filter"],
      ["unit_care", "unitCare"],
      ["round_mop", "roundMop"],
      ["air_freshener", "airFreshener"],
    ] as const) {
      this.listen(`LifeSpan_${event}`, (value) =>
        this.emitLifeSpanComponent(name, value),
      );
    }
    this.listen("LifeSpan", (value) => {
      if (value && typeof value === "object") {
        const lifespan = value as Record<string, unknown>;
        const names: Record<string, string> = {
          main_brush: "mainBrush",
          side_brush: "sideBrush",
          filter: "filter",
          unit_care: "unitCare",
          round_mop: "roundMop",
          air_freshener: "airFreshener",
        };
        for (const [key, name] of Object.entries(names)) {
          if (lifespan[key] != null) {
            this.emitLifeSpanComponent(name, lifespan[key]);
          }
        }
      }
    });
    this.listen("CurrentStats", (value) =>
      this.emitTelemetryFields("statistics.current", value),
    );
    this.listen("LastCleanLogs", (value) =>
      this.emitTelemetryFields("statistics.lastCleaning", value),
    );
    this.listen("CleanLog", (value) =>
      this.emitTelemetry("statistics.cleaningLog", this.telemetryValue(value)),
    );
    this.listen("WaterBoxInfo", (value) =>
      this.emitTelemetry("supplies.waterTankInstalled", Boolean(value)),
    );
    this.listen("WaterBoxMoppingType", (value) =>
      this.emitTelemetry("supplies.moppingType", this.telemetryValue(value)),
    );
    this.listen("WaterBoxScrubbingType", (value) =>
      this.emitTelemetry("supplies.scrubbingType", this.telemetryValue(value)),
    );
    this.listen("DustCaseInfo", (value) =>
      this.emitTelemetry("supplies.dustBinInstalled", Boolean(value)),
    );
    this.listen("AutoEmpty", (value) =>
      this.emitTelemetry("station.autoEmptyEnabled", Number(value) === 1),
    );
    this.listen("AutoEmptyStatus", (value) => {
      if (!value || typeof value !== "object") {
        return;
      }
      const status = value as Record<string, unknown>;
      const stationStatus = Number(status.stationStatus);
      if (stationStatus === 2 || stationStatus === 5) {
        this.emitTelemetry("consumables.dustBagFull", stationStatus === 5);
      }
      const { dustBagFull: _dustBagFull, ...station } = status;
      this.emitTelemetryFields("station.autoEmpty", station);
    });
    this.listen("ChildLock", (value) =>
      this.emitTelemetry("settings.childLock", Boolean(value)),
    );
    this.listen("DoNotDisturbEnabled", (value) =>
      this.emitTelemetry("settings.doNotDisturbEnabled", Boolean(value)),
    );
    this.listen("DoNotDisturbBlockTime", (value) =>
      this.emitTelemetry(
        "settings.doNotDisturbTime",
        this.telemetryValue(value),
      ),
    );
    this.listen("CarpetPressure", (value) =>
      this.emitTelemetry("sensors.carpetBoost", Boolean(value)),
    );
    this.listen("CarpetInfo", (value) =>
      this.emitTelemetry("sensors.carpetStrategy", this.telemetryValue(value)),
    );
    this.listen("TrueDetect", (value) =>
      this.emitTelemetry("sensors.obstacleDetection", Boolean(value)),
    );
    this.listen("Ota", (value) => this.handleFirmwareTelemetry(value));
    this.listen("NetworkInfo", (value) =>
      this.emitTelemetryFields("device.network", value),
    );
    this.listen("Sysinfo", (value) =>
      this.emitTelemetryFields("device.system", value),
    );
    this.listen("Schedule", (value) =>
      this.emitTelemetry(
        "extended.currentSchedule",
        this.telemetryValue(value),
      ),
    );
    this.listen("WashInterval", (value) =>
      this.emitTelemetry("extended.washInterval", Number(value)),
    );
    this.listen("DryingDuration", (value) =>
      this.emitTelemetry("extended.airDryingDuration", Number(value)),
    );
    this.listen("AirDryingState", (value) =>
      this.emitTelemetry("extended.airDryingState", apiValueToString(value)),
    );
    this.listen("AICleanItemState", (value) => this.handleAiTelemetry(value));
    this.listen("Error", (value) => {
      this.lastErrorDescription = apiValueToString(value).trim();
      this.emitTelemetry("extended.errorMessage", this.lastErrorDescription);
    });
    this.listen("ErrorCode", (value) => this.handleErrorTelemetry(value));
    this.listen("StationInfo", (value) =>
      this.handleStationInfoTelemetry(value),
    );
    this.listen("StationState", (value) => {
      this.handleStationTelemetry(value);
      this.emitStatus(value, "station");
    });
  }

  /**
   * Establishes the robot connection and waits for protocol readiness.
   */
  async connect(): Promise<void> {
    const protocol = this.vacbot.ecovacs;
    if (!protocol?.on || !protocol.removeListener || !this.vacbot.connect) {
      throw new Error("Ecovacs connection events are unavailable");
    }

    const on = protocol.on.bind(protocol);
    const removeListener = protocol.removeListener.bind(protocol);
    const startConnection = this.vacbot.connect.bind(this.vacbot);

    try {
      await new Promise<void>((resolve, reject) => {
        let finished = false;
        const timers = this.timers;

        const finish = (error?: Error): void => {
          if (finished) {
            return;
          }
          finished = true;
          cleanup();
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };

        const onReady = (): void => finish();
        const onClosed = (): void =>
          finish(new Error("Ecovacs connection closed before ready"));

        const timeout = this.timers.setTimeout(
          () =>
            finish(new Error("Ecovacs connection timeout after 30 seconds")),
          30000,
        );

        function cleanup(): void {
          timers.clearTimeout(timeout);
          removeListener("ready", onReady);
          removeListener("closed", onClosed);
        }

        if (timeout === undefined) {
          reject(new Error("Ecovacs connection aborted: adapter is stopping"));
          return;
        }

        on("ready", onReady);
        on("closed", onClosed);

        try {
          Promise.resolve(startConnection()).catch((error) =>
            finish(error instanceof Error ? error : new Error(String(error))),
          );
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
    } catch (error) {
      let cleanupTimer: ioBroker.Timeout | undefined;
      let cleanupTimedOut = false;

      try {
        await Promise.race([
          this.disconnect(),
          new Promise<void>((resolve) => {
            cleanupTimer = this.timers.setTimeout(() => {
              cleanupTimedOut = true;
              resolve();
            }, 5000);
            if (cleanupTimer === undefined) {
              cleanupTimedOut = true;
              resolve();
            }
          }),
        ]);

        if (cleanupTimedOut) {
          this.warn("Ecovacs connection cleanup timed out after 5 seconds");

          const protocol = this.vacbot.getProtocol?.();
          if (protocol === "MQTT" || this.vacbot.is950type?.()) {
            try {
              this.vacbot.ecovacs?.client?.end(true);
            } catch (closeError) {
              this.warn(
                `Ecovacs MQTT forced close failed: ${String(closeError)}`,
              );
            }
          }
        }
      } catch (disconnectError) {
        this.warn(
          `Ecovacs connection cleanup failed: ${String(disconnectError)}`,
        );
      } finally {
        if (cleanupTimer) {
          this.timers.clearTimeout(cleanupTimer);
        }
      }

      throw error;
    }
  }

  private guardProtocolDisconnect(): void {
    const protocol = this.vacbot.ecovacs;
    const original = protocol?.disconnect;
    if (!protocol || !original) {
      return;
    }
    // Upstream emitLastError calls protocol.disconnect() without awaiting it.
    // MQTT unsubscribe failure rejects with false and otherwise escapes even
    // though our normal adapter shutdown awaits vacbot.disconnectAsync().
    protocol.disconnect = async () => {
      try {
        return await original.call(protocol);
      } catch (error) {
        const detail =
          error === false
            ? "MQTT unsubscribe failed (upstream rejection: false)"
            : error instanceof Error
              ? error.message
              : String(error);
        this.warn(`Ecovacs disconnect failed: ${detail}`);
        try {
          // Upstream skips client.end() when unsubscribe fails. Close the
          // remaining socket so stopping the adapter cannot leave it alive.
          protocol.client?.end(true);
        } catch (closeError) {
          this.warn(
            `Ecovacs MQTT close failed: ${closeError instanceof Error ? closeError.message : String(closeError)}`,
          );
        }
      }
    };
  }

  private ignoreMalformedXmlMessages(): void {
    if (this.vacbot.is950type?.()) {
      return;
    }
    const protocol = this.vacbot.ecovacs;
    const original = protocol?.handleMessage;
    if (!protocol || !original) {
      return;
    }
    protocol.handleMessage = (topic, payload, type) => {
      if (typeof payload === "string" && !payload.trim()) {
        return;
      }
      try {
        original.call(protocol, topic, payload, type);
      } catch (error) {
        // The upstream XML handler parses outside its own try/catch. An empty
        // MQTT message must not terminate the entire ioBroker process.
        if (
          error instanceof Error &&
          /missing root element/i.test(error.message)
        ) {
          return;
        }
        throw error;
      }
    };
  }

  /**
   * Disconnects the transport and releases its resources.
   */
  async disconnect(): Promise<void> {
    for (const { event, listener } of this.handlers) {
      this.vacbot.removeListener?.(event, listener);
    }
    this.handlers.length = 0;
    this.clearMapRetries();
    this.stopPositionPolling();
    if (this.settingsRefreshTimer) {
      this.timers.clearTimeout(this.settingsRefreshTimer);
    }
    this.settingsRefreshTimer = undefined;
    const disconnect = this.vacbot.disconnectAsync
      ? () => this.vacbot.disconnectAsync!()
      : () => this.vacbot.disconnect?.();

    if (this.vacbot.getProtocol?.() !== "MQTT") {
      await disconnect();
      return;
    }

    let timeout: ioBroker.Timeout | undefined;
    let timedOut = false;

    try {
      await Promise.race([
        Promise.resolve().then(disconnect),
        new Promise<void>((resolve) => {
          timeout = this.timers.setTimeout(() => {
            timedOut = true;
            resolve();
          }, 1000);

          if (timeout === undefined) {
            timedOut = true;
            resolve();
          }
        }),
      ]);

      if (timedOut) {
        this.warn("MQTT disconnect timed out; forcing socket close");
        try {
          this.vacbot.ecovacs?.client?.end(true);
        } catch (error) {
          this.warn(
            `MQTT forced close failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } finally {
      if (timeout !== undefined) {
        this.timers.clearTimeout(timeout);
      }
    }
  }

  /**
   * Subscribes to robot map updates.
   *
   * @param listener - Callback receiving updates.
   */
  onMapUpdate(listener: (update: RobotMapSourceUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Subscribes to robot setting updates.
   *
   * @param listener - Callback receiving updates.
   */
  onSettingUpdate(
    listener: (setting: RobotSettingName, value: number) => void,
  ): () => void {
    this.settingListeners.add(listener);
    return () => this.settingListeners.delete(listener);
  }

  /**
   * Subscribes to robot status updates.
   *
   * @param listener - Callback receiving updates.
   */
  onStatusUpdate(
    listener: (status: string, source: "clean" | "charge" | "station") => void,
  ): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * Subscribes to robot telemetry updates.
   *
   * @param listener - Callback receiving updates.
   */
  onTelemetryUpdate(
    listener: (path: string, value: RobotTelemetryValue) => void,
  ): () => void {
    this.telemetryListeners.add(listener);
    return () => this.telemetryListeners.delete(listener);
  }

  /**
   * Requests current robot telemetry.
   */
  requestTelemetry(): void {
    if (!this.errorTelemetryInitialized) {
      this.errorTelemetryInitialized = true;
      this.handleErrorTelemetry(0);
    }
    for (const command of [
      "GetBatteryState",
      "GetChargeState",
      this.vacbot.is950type?.() ? "GetCleanState_V2" : "GetCleanState",
      this.vacbot.is950type?.() ? "GetSchedule_V2" : "GetSchedule",
    ]) {
      this.vacbot.run(command);
    }
    this.vacbot.run("GetCleanLogs");
    if (
      this.vacbot.hasMainBrush?.() ||
      this.vacbot.hasSideBrush?.() ||
      this.vacbot.hasFilter?.() ||
      this.vacbot.hasUnitCareInfo?.() ||
      this.vacbot.hasRoundMopInfo?.()
    ) {
      this.vacbot.run("GetLifeSpan");
    }
    // The upstream combined LifeSpan event omits round_mop even when the
    // device returns it. An individual request emits LifeSpan_round_mop.
    if (
      this.vacbot.is950type?.() &&
      (this.vacbot.hasRoundMopInfo?.() || this.vacbot.hasMoppingSystem?.())
    ) {
      this.safeRun("GetLifeSpan", "round_mop");
    }
    if (this.vacbot.hasMoppingSystem?.()) {
      this.vacbot.run("GetWaterBoxInfo");
    }
    if (this.vacbot.hasAutoEmptyStation?.()) {
      this.vacbot.run("GetAutoEmpty");
    }
    if (this.vacbot.is950type?.()) {
      for (const command of [
        "GetTotalStats",
        "GetStationInfo",
        "GetStationState",
        "GetAirDrying",
        "GetDryingDuration",
        "GetWashInterval",
        "GetAICleanItemState",
        "GetError",
        "GetChildLock",
        "GetCarpetPressure",
        "GetCarpetInfo",
        "GetTrueDetect",
        "GetOta",
      ]) {
        this.vacbot.run(command);
      }
    }
  }

  private emitTelemetry(path: string, value: RobotTelemetryValue): void {
    if (typeof value === "number" && !Number.isFinite(value)) {
      return;
    }
    for (const listener of this.telemetryListeners) {
      listener(path, value);
    }
  }

  private emitLifeSpanComponent(name: string, value: unknown): void {
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      return;
    }
    this.emitTelemetry(`consumables.${name}`, amount);
  }

  private telemetryValue(value: unknown): RobotTelemetryValue {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    if (Array.isArray(value)) {
      return value;
    }
    if (value && typeof value === "object") {
      return value as Record<string, unknown>;
    }
    return "";
  }

  private emitTelemetryFields(prefix: string, value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      this.emitTelemetry(`${prefix}.value`, this.telemetryValue(value));
      return;
    }
    this.emitTelemetry(`${prefix}.raw`, value as Record<string, unknown>);
    for (const [key, field] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const safeKey = key.replace(/[^A-Za-z0-9_]/g, "_");
      if (!safeKey || !["string", "number", "boolean"].includes(typeof field)) {
        continue;
      }
      this.emitTelemetry(
        `${prefix}.${safeKey}`,
        field as string | number | boolean,
      );
    }
  }

  private handleFirmwareTelemetry(value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      this.emitTelemetry("device.firmware.raw", this.telemetryValue(value));
      return;
    }
    const firmware = value as Record<string, unknown>;
    this.emitTelemetry("device.firmware.raw", firmware);
    for (const key of ["autoSwitch", "isForce", "supportAuto"] as const) {
      if (firmware[key] !== undefined) {
        this.emitTelemetry(
          `device.firmware.${key}`,
          firmware[key] === true ||
            firmware[key] === 1 ||
            firmware[key] === "1",
        );
      }
    }
    for (const key of ["progress", "result"] as const) {
      const number = Number(firmware[key]);
      if (Number.isFinite(number)) {
        this.emitTelemetry(`device.firmware.${key}`, number);
      }
    }
    for (const key of ["status", "ver"] as const) {
      if (firmware[key] !== undefined) {
        this.emitTelemetry(
          `device.firmware.${key}`,
          apiValueToString(firmware[key]),
        );
      }
    }
    const result = Number(firmware.result);
    if (Number.isFinite(result)) {
      this.emitTelemetry(
        "device.firmware.resultText",
        result === 0 ? "Kein Fehler" : `Firmware-Ergebniscode ${result}`,
      );
    }
  }

  private handleStationInfoTelemetry(value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }
    const station = value as Record<string, unknown>;
    const fields: Record<string, unknown> = {
      infoState: station.state,
      name: station.name,
      model: station.model,
      serialNumber: station.sn,
      firmwareVersion: station.wkVer,
    };
    for (const [name, field] of Object.entries(fields)) {
      if (["string", "number", "boolean"].includes(typeof field)) {
        this.emitTelemetry(
          `extended.cleaningStation.${name}`,
          field as string | number | boolean,
        );
      }
    }
  }

  private handleStationTelemetry(value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }
    const station = value as Record<string, unknown>;
    this.emitTelemetry(
      "extended.cleaningStationActive",
      station.isActive === true,
    );
    this.emitTelemetry(
      "extended.selfCleaningActive",
      station.isSelfCleaning === true,
    );
    this.emitTelemetry(
      "extended.airDryingActive",
      station.isAirDrying === true,
    );
    const active = Boolean(station.state);
    const type = Number(station.type);
    if (typeof station.state === "number") {
      this.emitTelemetry("extended.cleaningStation.state", station.state);
    }
    if (Number.isFinite(type)) {
      this.emitTelemetry("extended.cleaningStation.type", type);
    }
    const operationCode = !active ? 0 : type === 2 ? 2 : type === 3 ? 3 : 1;
    this.emitTelemetry("extended.cleaningStation.operationCode", operationCode);
    this.emitTelemetry(
      "extended.cleaningStation.operation",
      operationCode === 0
        ? "Inaktiv"
        : operationCode === 2
          ? "Trocknung"
          : operationCode === 3
            ? "Selbstreinigung"
            : "Station arbeitet",
    );
  }

  private handleAiTelemetry(value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }
    const ai = value as Record<string, unknown>;
    if (typeof ai.particleRemoval === "boolean") {
      this.emitTelemetry("extended.particleRemoval", ai.particleRemoval);
    }
    if (typeof ai.petPoopPrevention === "boolean") {
      this.emitTelemetry("extended.petPoopAvoidance", ai.petPoopPrevention);
    }
  }

  private handleErrorTelemetry(value: unknown): void {
    const code = Number(value);
    if (!Number.isFinite(code)) {
      return;
    }
    const waterMessages: Record<number, string> = {
      301: "Frischwassertank leer",
      302: "Abwassertank voll",
      303: "Frischwassertank fehlt",
      304: "Abwassertank fehlt",
      305: "Schmutzwassertank voll",
      317: "Störung beim Nachfüllen des Frischwassertanks",
      318: "Schmutzwassertank voll",
      319: "Reinigungsmittel wird knapp",
    };
    const normalizedCode = code === 100 ? 0 : code;
    this.emitTelemetry("extended.errorCode", normalizedCode);
    this.emitTelemetry(
      "extended.errorMessage",
      normalizedCode === 0
        ? ""
        : this.lastErrorDescription ||
            waterMessages[normalizedCode] ||
            `Ecovacs-Fehler ${normalizedCode}`,
    );
    this.emitTelemetry(
      "extended.waterStatus",
      waterMessages[normalizedCode] ?? "ok",
    );
    if (this.vacbot.hasMoppingSystem?.()) {
      this.emitTelemetry("consumables.freshWaterEmpty", normalizedCode === 301);
      this.emitTelemetry(
        "consumables.wasteWaterFull",
        [302, 305, 318].includes(normalizedCode),
      );
    }
  }

  /**
   * Returns the robot image URL when available.
   */
  deviceImageUrl(): string {
    return String(this.vacbot.deviceImageURL ?? "").trim();
  }

  /**
   * Returns the capabilities supported by the robot.
   */
  capabilities(): RobotCapabilities {
    const mopping = this.vacbot.hasMoppingSystem?.() ?? false;
    return {
      cleanSpeed:
        (this.vacbot.hasVacuumPowerAdjustment?.() ?? true) ||
        this.detectedCapabilities.has("cleanSpeed"),
      waterLevel: mopping || this.detectedCapabilities.has("waterLevel"),
      cleanCount:
        (this.vacbot.is950type?.() ?? false) ||
        this.detectedCapabilities.has("cleanCount"),
      moppingMode:
        (mopping && (this.vacbot.is950type?.() ?? false)) ||
        this.detectedCapabilities.has("moppingMode"),
      cleaningMode: this.detectedCapabilities.has("cleaningMode"),
      customArea:
        (this.vacbot.hasCustomAreaCleaningMode?.() ?? false) ||
        (this.vacbot.is950type?.() ?? false),
    };
  }

  /**
   * Requests supported robot settings.
   */
  requestSettings(): void {
    // Some newer devices are missing or incorrectly classified in the library's
    // capability table. Probe every harmless getter and learn support from replies.
    this.safeRun("GetCleanSpeed");
    this.safeRun("GetWaterLevel");
    this.safeRun("GetCleanCount");
    this.safeRun("GetSweepMode");
    this.safeRun("GetWorkMode");
  }

  /**
   * Requests the robot map and schedules retries when needed.
   */
  requestMap(): void {
    this.runMapCommands();
    if (
      this.mapRetryTimers.size === 0 &&
      (!Array.isArray(this.maps) || this.maps.length === 0)
    ) {
      for (const delay of [15_000, 45_000]) {
        const timer = this.timers.setTimeout(() => {
          if (timer !== undefined) {
            this.mapRetryTimers.delete(timer);
          }
          if (!Array.isArray(this.maps) || this.maps.length === 0) {
            this.runMapCommands();
          }
        }, delay);
        if (timer !== undefined) {
          this.mapRetryTimers.add(timer);
        }
      }
    }
  }

  /**
   * Translates and sends a robot command.
   *
   * @param command - Robot command to execute.
   */
  execute(command: RobotCommand): void {
    switch (command.type) {
      case "cleanAll":
        this.vacbot.run("Clean");
        this.startPositionPolling();
        break;
      case "cleanRooms":
        if (command.roomIds.length === 0) {
          throw new Error("No rooms selected");
        }
        if (
          this.vacbot.hasSpotAreaCleaningMode &&
          !this.vacbot.hasSpotAreaCleaningMode()
        ) {
          throw new Error("Room cleaning is not supported by this robot");
        }
        if (this.vacbot.is950type?.()) {
          this.vacbot.run(
            "SpotArea_V2",
            command.roomIds.join(","),
            command.repetitions,
          );
        } else {
          this.vacbot.run(
            "SpotArea",
            "start",
            command.roomIds.join(","),
            command.repetitions,
          );
        }
        this.startPositionPolling();
        break;
      case "pause":
        this.vacbot.run("Pause");
        break;
      case "resume":
        this.vacbot.run("Resume");
        break;
      case "stop":
        this.vacbot.run("Stop");
        break;
      case "charge":
        this.vacbot.run("Charge");
        break;
      case "cleanCustomArea":
        if (this.vacbot.is950type?.()) {
          this.vacbot.run(
            "CustomArea_V2",
            command.coordinates,
            command.repetitions,
            0,
          );
        } else {
          this.vacbot.run(
            "CustomArea",
            "start",
            command.coordinates,
            command.repetitions,
          );
        }
        this.startPositionPolling();
        break;
      case "setSetting":
        this.setSetting(command.setting, command.value);
        break;
    }
  }

  private setSetting(setting: RobotSettingName, value: number): void {
    if (!this.capabilities()[setting]) {
      throw new Error(`${setting} is not supported by this robot`);
    }
    if (setting === "cleanSpeed") {
      this.vacbot.run("SetCleanSpeed", value);
    } else if (setting === "cleanCount") {
      this.vacbot.run("SetCleanCount", value);
    } else if (setting === "waterLevel") {
      this.waterLevel = value;
      this.vacbot.run("SetWaterLevel", value);
    } else if (setting === "moppingMode") {
      this.vacbot.run("SetSweepMode", value);
    } else {
      this.vacbot.run("SetWorkMode", value);
    }
    if (this.settingsRefreshTimer) {
      this.timers.clearTimeout(this.settingsRefreshTimer);
    }
    this.settingsRefreshTimer = this.timers.setTimeout(() => {
      this.settingsRefreshTimer = undefined;
      this.requestSettings();
    }, 750);
  }

  private safeRun(command: string, ...args: unknown[]): void {
    try {
      this.vacbot.run(command, ...args);
    } catch {
      /* Unsupported variants stay hidden or retain their last value. */
    }
  }

  private emitSetting(setting: RobotSettingName, value: unknown): void {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return;
    }
    this.detectedCapabilities.add(setting);
    for (const listener of this.settingListeners) {
      listener(setting, numeric);
    }
  }

  private handleMoppingInfo(value: unknown): void {
    if (!value || typeof value !== "object") {
      return;
    }
    const report = value as {
      cleanInfo?: { level?: unknown };
      waterInfo?: {
        enabled?: unknown;
        level?: unknown;
        scrubbingType?: unknown;
        moppingType?: unknown;
      };
    };
    const waterInfo = report.waterInfo;
    if (waterInfo?.enabled != null) {
      this.emitTelemetry(
        "supplies.moppingActive",
        waterInfo.enabled === true ||
          waterInfo.enabled === 1 ||
          waterInfo.enabled === "1",
      );
    }
    if (report.cleanInfo?.level != null) {
      this.emitSetting("cleanSpeed", report.cleanInfo.level);
    }
    if (report.waterInfo?.level != null) {
      this.waterLevel = Number(report.waterInfo.level) || this.waterLevel;
      this.emitSetting("waterLevel", report.waterInfo.level);
    }
  }

  private emitStatus(
    value: unknown,
    source: "clean" | "charge" | "station",
  ): void {
    const status =
      source === "station" ? this.stationStatus(value) : this.statusText(value);
    if (!status) {
      return;
    }
    const normalized = status.toLowerCase();
    if (
      source === "clean" &&
      /clean|spot|area|auto|mop|wash|return/.test(normalized)
    ) {
      this.startPositionPolling();
    }
    if (
      (source === "charge" && /charg/.test(normalized)) ||
      (source === "clean" && /idle|stop|finish|complete/.test(normalized))
    ) {
      this.schedulePositionPollingStop();
    }
    for (const listener of this.statusListeners) {
      listener(status, source);
    }
  }

  private stationStatus(value: unknown): string {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return this.statusText(value);
    }
    const station = value as Record<string, unknown>;
    if (station.isAirDrying === true) {
      return "drying";
    }
    if (station.isSelfCleaning === true) {
      return "washing";
    }
    // Types such as 1 describe another active station function. They must not
    // replace the robot's clean/charge status merely because the JSON keys
    // contain words such as "Cleaning" while their values are false.
    return "";
  }

  private statusText(value: unknown): string {
    return typeof value === "string"
      ? value.trim()
      : (JSON.stringify(value) ?? "").trim();
  }

  private startPositionPolling(): void {
    if (this.positionPollingStopTimer) {
      this.timers.clearTimeout(this.positionPollingStopTimer);
      this.positionPollingStopTimer = undefined;
    }
    if (this.positionPollingTimer) {
      return;
    }
    this.requestPosition();
    this.requestRuntimeStates();
    this.positionPollingTimer = this.timers.setInterval(
      () => this.requestPosition(),
      5_000,
    );
    this.runtimePollingTimer = this.timers.setInterval(
      () => this.requestRuntimeStates(),
      30_000,
    );
  }

  private schedulePositionPollingStop(): void {
    if (this.positionPollingStopTimer) {
      this.timers.clearTimeout(this.positionPollingStopTimer);
    }
    this.positionPollingStopTimer = this.timers.setTimeout(
      () => this.stopPositionPolling(),
      90_000,
    );
  }

  private stopPositionPolling(): void {
    if (this.positionPollingTimer) {
      this.timers.clearInterval(this.positionPollingTimer);
    }
    if (this.runtimePollingTimer) {
      this.timers.clearInterval(this.runtimePollingTimer);
    }
    if (this.positionPollingStopTimer) {
      this.timers.clearTimeout(this.positionPollingStopTimer);
    }
    this.positionPollingTimer = undefined;
    this.runtimePollingTimer = undefined;
    this.positionPollingStopTimer = undefined;
  }

  private requestPosition(): void {
    try {
      this.vacbot.run("GetPosition");
    } catch {
      /* Not all models support active position polling. */
    }
  }

  private requestRuntimeStates(): void {
    // Some models do not push the final transition. Status polling is kept
    // deliberately slow to avoid cloud rate limits and event floods.
    for (const command of [
      this.vacbot.is950type?.() ? "GetCleanState_V2" : "GetCleanState",
      "GetChargeState",
    ]) {
      try {
        this.vacbot.run(command);
      } catch {
        /* Not all models support every getter. */
      }
    }
  }

  private runMapCommands(): void {
    for (const [command, ...args] of [
      ["GetMaps", true, false],
      ["GetMultiMapState"],
      ["GetChargerPos"],
      ["GetPosition"],
    ] as Array<[string, ...unknown[]]>) {
      try {
        this.vacbot.run(command, ...args);
      } catch {
        // Some models do not implement every position command. Map discovery continues.
      }
    }
  }

  private clearMapRetries(): void {
    for (const timer of this.mapRetryTimers) {
      this.timers.clearTimeout(timer);
    }
    this.mapRetryTimers.clear();
  }

  private listen(event: string, listener: (value?: unknown) => void): void {
    this.handlers.push({ event, listener });
    this.vacbot.on(event, listener);
  }

  private emitMap(): void {
    const update: RobotMapSourceUpdate = {
      maps: this.maps,
      currentMapId: this.currentMapId,
      currentMapName: this.currentMapName,
      currentMapIndex: this.currentMapIndex,
      multiMapEnabled: this.multiMapEnabled,
      robotPosition: this.robotPosition,
      dockPosition: this.dockPosition,
      currentRoomId: this.currentRoomId,
      currentRoomName: this.currentRoomName,
    };
    for (const listener of this.listeners) {
      listener(update);
    }
  }

  private point(value: unknown): Point | null {
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const point = value as Record<string, unknown>;
    const x = Number(point.x);
    const y = Number(point.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  private cleanRoomValue(value: unknown): string | null {
    const result = apiValueToString(value).trim();
    return result && result.toLowerCase() !== "unknown" ? result : null;
  }
}

/**
 * Manages an Ecovacs cloud session and its discovered robots.
 */
export class EcovacsCloudSession implements CloudSession {
  private api: EcoVacsApiLike | null = null;
  private rawDevices = new Map<string, RawDevice>();
  private credentials: CloudCredentials | null = null;

  /**
   * Creates a cloud session for the selected region and device.
   *
   * @param options - Configuration options.
   * @param options.deviceId - Stable client device identifier.
   * @param options.country - Two-letter country code.
   * @param options.continent - Ecovacs server region.
   * @param warn - Callback used to report warnings.
   * @param timers - Timer service supplied by the adapter.
   */
  constructor(
    private readonly options: {
      deviceId: string;
      country: string;
      continent: string;
    },
    private readonly warn: (message: string) => void,
    private readonly timers: TimerService,
  ) {}

  /**
   * Authenticates the cloud session using account or cached credentials.
   *
   * @param account - Ecovacs account identifier.
   * @param password - Ecovacs account password.
   * @param verificationCode - Code received during device verification.
   * @param cachedCredentials - Previously stored session credentials.
   */
  async login(
    account: string,
    password: string,
    verificationCode?: string,
    cachedCredentials?: CloudCredentials,
  ): Promise<void> {
    const auth = new ModernEcovacsAuthenticator(this.options);
    let credentials: Credentials;
    if (cachedCredentials?.userId && cachedCredentials.token) {
      credentials = cachedCredentials;
    } else {
      try {
        credentials = await auth.login(account, password);
      } catch (error) {
        if (!(error instanceof EcovacsAuthApiError) || error.code !== "1013") {
          throw error;
        }
        if (verificationCode) {
          try {
            credentials = await auth.verifyDevice(account, verificationCode);
          } catch (verifyError) {
            if (
              verifyError instanceof EcovacsAuthApiError &&
              verifyError.code === "1012"
            ) {
              throw new VerificationRequiredError(
                "Der Ecovacs-Verifizierungscode ist ungültig oder abgelaufen.",
                "1012",
              );
            }
            throw verifyError;
          }
        } else {
          await auth.requestVerificationCode(account);
          throw new VerificationRequiredError(
            "Ecovacs hat einen Verifizierungscode per E-Mail gesendet. Code in den Adaptereinstellungen eintragen, speichern und die Instanz neu starten.",
          );
        }
      }
    }

    this.credentials = { userId: credentials.userId, token: credentials.token };
    const module = loadVendorModule(
      join(__dirname, "../../../vendor/ecovacs-deebot"),
    ) as EcoVacsModule;
    this.api = new module.EcoVacsAPI(
      this.options.deviceId,
      this.options.country,
      this.options.continent,
    );
    this.api.uid = credentials.userId;
    this.api.user_access_token = credentials.token;
  }

  /**
   * Returns a copy of the current cloud credentials when available.
   */
  authCredentials(): CloudCredentials | null {
    return this.credentials ? { ...this.credentials } : null;
  }

  /**
   * Renews cloud authentication using account credentials.
   *
   * @param account - Ecovacs account identifier.
   * @param password - Ecovacs account password.
   */
  async refreshAuthentication(
    account: string,
    password: string,
  ): Promise<void> {
    // A cached user token can be accepted locally but rejected by GetDeviceList.
    // Authenticate with the account again instead of reusing that token.
    await this.login(account, password);
  }

  /**
   * Retrieves and normalizes the robots available in the account.
   */
  async listRobots(): Promise<RobotDescriptor[]> {
    if (!this.api) {
      throw new Error("Ecovacs session is not logged in");
    }
    const response = await this.api.devices();
    const devices = Array.isArray(response)
      ? response
      : Object.values(response);
    this.rawDevices.clear();
    return devices.map((device, index) => {
      const descriptor = this.normalize(device, index);
      this.rawDevices.set(descriptor.id, device);
      return descriptor;
    });
  }

  /**
   * Creates a transport for a discovered robot.
   *
   * @param robot - Descriptor of the target robot.
   */
  createTransport(robot: RobotDescriptor): RobotTransport {
    if (!this.api) {
      throw new Error("Ecovacs session is not logged in");
    }
    const raw = this.rawDevices.get(robot.id);
    if (!raw) {
      throw new Error(`No raw Ecovacs device found for ${robot.id}`);
    }
    return new VacBotTransport(
      this.api.getVacBotObj(raw),
      (message) => this.warn(`${robot.name}: ${message}`),
      this.timers,
    );
  }

  /**
   * Closes the cloud session and clears its cached devices.
   */
  close(): Promise<void> {
    this.rawDevices.clear();
    this.api = null;
    return Promise.resolve();
  }

  private normalize(device: RawDevice, index: number): RobotDescriptor {
    const value = (...keys: string[]): string => {
      for (const key of keys) {
        const candidate = device[key];
        if (
          candidate !== undefined &&
          candidate !== null &&
          apiValueToString(candidate).trim()
        ) {
          return apiValueToString(candidate);
        }
      }
      return "";
    };
    const id = value("did", "deviceId", "id", "name") || `device-${index}`;
    const deviceClass = value("class", "deviceClass") || "unknown";
    const modelCode = value("model", "product", "deviceName") || "unknown";
    return {
      id,
      name: value("nick", "friendlyName", "name") || id,
      model: resolveEcovacsModelName(deviceClass, modelCode),
      modelCode,
      deviceClass,
      company: value("company") || undefined,
      raw: { ...device },
    };
  }
}

/**
 * Resolves a readable Ecovacs model name from its device class.
 *
 * @param deviceClass - Ecovacs device class identifier.
 * @param fallback - Fallback model name.
 */
export function resolveEcovacsModelName(
  deviceClass: string,
  fallback: string,
): string {
  try {
    const modelsPath = join(
      __dirname,
      "../../../vendor/ecovacs-deebot/library/models.js",
    );
    const models = loadVendorModule(modelsPath) as {
      KnownDevices?: Record<string, { name?: string }>;
      SupportedDevices?: Record<string, { name?: string }>;
    };
    const name =
      models.KnownDevices?.[deviceClass]?.name ??
      models.SupportedDevices?.[deviceClass]?.name;
    if (typeof name === "string" && name.trim()) {
      return name.trim();
    }
  } catch {
    /* Optional Ecovacs library or model entry is unavailable. */
  }
  return fallback || "unknown";
}

/**
 * Creates Ecovacs cloud sessions with shared transport services.
 */
export class EcovacsCloudSessionFactory implements CloudSessionFactory {
  /**
   * Configures logging and timer services for new cloud sessions.
   *
   * @param warn - Callback used to report warnings.
   * @param timers - Timer service supplied by the adapter.
   */
  constructor(
    private readonly warn: (message: string) => void,
    private readonly timers: TimerService,
  ) {}

  /**
   * Creates a cloud session for the supplied device and region.
   *
   * @param options - Configuration options.
   * @param options.deviceId - Stable client device identifier.
   * @param options.country - Two-letter country code.
   * @param options.continent - Ecovacs server region.
   */
  create(options: {
    deviceId: string;
    country: string;
    continent: string;
  }): CloudSession {
    return new EcovacsCloudSession(options, this.warn, this.timers);
  }
}

/**
 * Generates a stable eight-character device identifier from a seed.
 *
 * @param seed - Stable input used to generate the identifier.
 */
export function createStableDeviceId(seed: string): string {
  return createHash("sha256")
    .update(seed)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
}
