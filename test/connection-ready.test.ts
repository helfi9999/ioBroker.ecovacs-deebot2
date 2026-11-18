import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { VacBotTransport } from "../src/ecovacs/EcovacsCloudSession";

function createTransport(connect: () => void) {
  const protocol = new EventEmitter();

  const vacbot = {
    ecovacs: protocol,
    connect,
  };

  const transport = Object.create(
    VacBotTransport.prototype,
  ) as VacBotTransport;

  Object.assign(transport, {
    vacbot,
    warn: () => {},
    handlers: [],
    mapRetryTimers: new Set(),
    stopPositionPolling: () => {},
  });

  return { transport, protocol };
}

test("connection waits for ready", async () => {
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

test("connection rejects when closed before ready", async () => {
  const { transport, protocol } = createTransport(() => {});

  const pending = transport.connect();
  protocol.emit("closed");

  await assert.rejects(pending, /closed before ready/);

  assert.equal(protocol.listenerCount("ready"), 0);
  assert.equal(protocol.listenerCount("closed"), 0);
});

test("connection rejects synchronous errors", async () => {
  const { transport, protocol } = createTransport(() => {
    throw new Error("Connection failed");
  });

  await assert.rejects(
    transport.connect(),
    /Connection failed/,
  );

  assert.equal(protocol.listenerCount("ready"), 0);
  assert.equal(protocol.listenerCount("closed"), 0);
});

test("connection times out without ready", async () => {
  const { transport, protocol } = createTransport(() => {});

  await assert.rejects(
    transport.connect(),
    /connection timeout after 30 seconds/,
  );

  assert.equal(protocol.listenerCount("ready"), 0);
  assert.equal(protocol.listenerCount("closed"), 0);
});

test("connection failure disconnects the robot", async () => {
  const { transport, protocol } = createTransport(() => {});
  let disconnectCount = 0;

  Object.assign(transport, {
    vacbot: {
      ecovacs: protocol,
      connect: () => {},
      disconnectAsync: async () => {
        disconnectCount++;
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

test("MQTT cleanup timeout forces socket closure", async () => {
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

test("XMPP cleanup does not force MQTT socket closure", async () => {
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

test("MQTT forced-close failure preserves original error", async () => {
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
    warnings.some(message =>
      message.includes("MQTT forced close failed"),
    ),
  );
});
