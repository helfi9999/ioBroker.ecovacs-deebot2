import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { VacBotTransport } from "../src/ecovacs/EcovacsCloudSession";
import { testTimerService } from "./TimerService";

function createTransport(connect: () => void): {
  transport: VacBotTransport;
  protocol: EventEmitter;
} {
  const protocol = new EventEmitter();

  const vacbot = {
    ecovacs: protocol,
    connect,
  };

  const transport = Object.create(VacBotTransport.prototype) as VacBotTransport;

  Object.assign(transport, {
    vacbot,
    warn: () => {},
    timers: testTimerService,
    handlers: [],
    mapRetryTimers: new Set(),
    stopPositionPolling: () => {},
  });

  return { transport, protocol };
}

void test("connection waits for ready", async () => {
  let resolved = false;
  const { transport, protocol } = createTransport(() => {});

  const pending = transport.connect().then(() => {
    resolved = true;
  });

  await Promise.resolve();
  assert.equal(resolved, false);

  protocol.emit("ready");
  await pending;

  assert.equal(resolved, true);
  assert.equal(protocol.listenerCount("ready"), 0);
  assert.equal(protocol.listenerCount("closed"), 0);
});

void test("connection rejects when closed before ready", async () => {
  const { transport, protocol } = createTransport(() => {});

  const pending = transport.connect();
  protocol.emit("closed");

  await assert.rejects(pending, /closed before ready/);

  assert.equal(protocol.listenerCount("ready"), 0);
  assert.equal(protocol.listenerCount("closed"), 0);
});

void test("connection rejects synchronous errors", async () => {
  const { transport, protocol } = createTransport(() => {
    throw new Error("Connection failed");
  });

  await assert.rejects(transport.connect(), /Connection failed/);

  assert.equal(protocol.listenerCount("ready"), 0);
  assert.equal(protocol.listenerCount("closed"), 0);
});

void test("connection times out without ready", async () => {
  const { transport, protocol } = createTransport(() => {});

  await assert.rejects(
    transport.connect(),
    /connection timeout after 30 seconds/,
  );

  assert.equal(protocol.listenerCount("ready"), 0);
  assert.equal(protocol.listenerCount("closed"), 0);
});

void test("connection failure disconnects the robot", async () => {
  const { transport, protocol } = createTransport(() => {});
  let disconnectCount = 0;

  Object.assign(transport, {
    vacbot: {
      ecovacs: protocol,
      connect: () => {},
      disconnectAsync: (): Promise<void> => {
        disconnectCount++;
        return Promise.resolve();
      },
    },
  });

  const pending = transport.connect();
  protocol.emit("closed");

  await assert.rejects(pending, /closed before ready/);

  assert.equal(disconnectCount, 1);
  assert.equal(protocol.listenerCount("ready"), 0);
  assert.equal(protocol.listenerCount("closed"), 0);
});

void test("MQTT cleanup timeout forces socket closure", async () => {
  const { transport, protocol } = createTransport(() => {});
  let forcedClose = false;

  Object.assign(transport, {
    vacbot: {
      ecovacs: Object.assign(protocol, {
        client: {
          end: (force: boolean) => {
            forcedClose = force;
          },
        },
      }),
      connect: () => {},
      getProtocol: () => "MQTT",
      disconnectAsync: () => new Promise<void>(() => {}),
    },
  });

  const pending = transport.connect();
  protocol.emit("closed");

  await assert.rejects(pending, /closed before ready/);

  assert.equal(forcedClose, true);
  assert.equal(protocol.listenerCount("ready"), 0);
  assert.equal(protocol.listenerCount("closed"), 0);
});

void test("XMPP cleanup does not force MQTT socket closure", async () => {
  const { transport, protocol } = createTransport(() => {});
  let forcedClose = false;

  Object.assign(transport, {
    vacbot: {
      ecovacs: Object.assign(protocol, {
        client: {
          end: () => {
            forcedClose = true;
          },
        },
      }),
      connect: () => {},
      getProtocol: () => "XMPP",
      disconnectAsync: () => new Promise<void>(() => {}),
    },
  });

  const pending = transport.connect();
  protocol.emit("closed");

  await assert.rejects(pending, /closed before ready/);

  assert.equal(forcedClose, false);
  assert.equal(protocol.listenerCount("ready"), 0);
  assert.equal(protocol.listenerCount("closed"), 0);
});

void test("MQTT forced-close failure preserves original error", async () => {
  const { transport, protocol } = createTransport(() => {});
  const warnings: string[] = [];

  Object.assign(transport, {
    warn: (message: string) => warnings.push(message),
    vacbot: {
      ecovacs: Object.assign(protocol, {
        client: {
          end: () => {
            throw new Error("Socket close failed");
          },
        },
      }),
      connect: () => {},
      getProtocol: () => "MQTT",
      disconnectAsync: () => new Promise<void>(() => {}),
    },
  });

  const pending = transport.connect();
  protocol.emit("closed");

  await assert.rejects(pending, /closed before ready/);

  assert.ok(
    warnings.some((message) => message.includes("MQTT forced close failed")),
  );
});

void test("connection aborts when ioBroker cannot create the ready timeout", async () => {
  let connectCalled = false;
  const { transport, protocol } = createTransport(() => {
    connectCalled = true;
  });

  Object.assign(transport, {
    timers: {
      ...testTimerService,
      setTimeout: () => undefined,
    },
  });

  await assert.rejects(transport.connect(), /adapter is stopping/);

  assert.equal(connectCalled, false);
  assert.equal(protocol.listenerCount("ready"), 0);
  assert.equal(protocol.listenerCount("closed"), 0);
});

void test("MQTT cleanup forces socket closure when ioBroker cannot create a cleanup timer", async () => {
  let forcedClose = false;
  const warnings: string[] = [];
  const { transport, protocol } = createTransport(() => {});

  Object.assign(transport, {
    warn: (message: string) => warnings.push(message),
    timers: {
      ...testTimerService,
      setTimeout: (callback: () => void, delay: number) =>
        delay === 5000
          ? undefined
          : testTimerService.setTimeout(callback, delay),
    },
    vacbot: {
      ecovacs: Object.assign(protocol, {
        client: {
          end: (force: boolean) => {
            forcedClose = force;
          },
        },
      }),
      connect: () => {},
      getProtocol: () => "MQTT",
      disconnectAsync: () => new Promise<void>(() => {}),
    },
  });

  const pending = transport.connect();
  protocol.emit("closed");

  await assert.rejects(pending, /closed before ready/);
  assert.equal(forcedClose, true);
  assert.equal(protocol.listenerCount("ready"), 0);
  assert.equal(protocol.listenerCount("closed"), 0);
  assert.ok(warnings.some((message) => /cleanup timed out/.test(message)));
});

void test("MQTT disconnect completes without forcing socket close", async () => {
  const { transport, protocol } = createTransport(() => {});
  let forcedClose = false;

  Object.assign(transport, {
    vacbot: {
      ecovacs: Object.assign(protocol, {
        client: {
          end: () => {
            forcedClose = true;
          },
        },
      }),
      getProtocol: () => "MQTT",
      disconnectAsync: async () => {},
    },
  });

  await transport.disconnect();
  assert.equal(forcedClose, false);
});

void test("MQTT disconnect timeout forces socket close", async () => {
  const { transport, protocol } = createTransport(() => {});
  let forcedClose = false;
  const warnings: string[] = [];

  Object.assign(transport, {
    warn: (message: string) => warnings.push(message),
    timers: {
      ...testTimerService,
      setTimeout: (callback: () => void) => {
        queueMicrotask(callback);
        return undefined;
      },
    },
    vacbot: {
      ecovacs: Object.assign(protocol, {
        client: {
          end: (force: boolean) => {
            forcedClose = force;
          },
        },
      }),
      getProtocol: () => "MQTT",
      disconnectAsync: () => new Promise<void>(() => {}),
    },
  });

  await transport.disconnect();
  assert.equal(forcedClose, true);
  assert.match(warnings.join(" "), /MQTT disconnect timed out/);
});

void test("MQTT forced-close failure does not reject disconnect", async () => {
  const { transport, protocol } = createTransport(() => {});
  const warnings: string[] = [];

  Object.assign(transport, {
    warn: (message: string) => warnings.push(message),
    timers: {
      ...testTimerService,
      setTimeout: () => undefined,
    },
    vacbot: {
      ecovacs: Object.assign(protocol, {
        client: {
          end: () => {
            throw new Error("Socket close failed");
          },
        },
      }),
      getProtocol: () => "MQTT",
      disconnectAsync: () => new Promise<void>(() => {}),
    },
  });

  await transport.disconnect();
  assert.match(warnings.join(" "), /Socket close failed/);
});

void test("MQTT disconnect registered timeout forces socket close", async () => {
  const { transport, protocol } = createTransport(() => {});
  let timeoutCallback: (() => void) | undefined;
  let timeoutDelay: number | undefined;
  let timeoutCleared = false;
  let forcedClose = false;

  Object.assign(transport, {
    warn: () => {},
    timers: {
      ...testTimerService,
      setTimeout: (callback: () => void, delay: number) => {
        timeoutCallback = callback;
        timeoutDelay = delay;
        return 1 as unknown as ioBroker.Timeout;
      },
      clearTimeout: () => {
        timeoutCleared = true;
      },
    },
    vacbot: {
      ecovacs: Object.assign(protocol, {
        client: {
          end: (force: boolean) => {
            forcedClose = force;
          },
        },
      }),
      getProtocol: () => "MQTT",
      disconnectAsync: () => new Promise<void>(() => {}),
    },
  });

  const pending = transport.disconnect();

  assert.equal(timeoutDelay, 1000);
  assert.ok(timeoutCallback);

  timeoutCallback();
  await pending;

  assert.equal(forcedClose, true);
  assert.equal(timeoutCleared, true);
});
