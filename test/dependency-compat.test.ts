/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H. */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { Agent as HttpAgent, createServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const ecovacsRequire = createRequire(
  join(__dirname, "../../vendor/ecovacs-deebot/package.json"),
);
const xmppRequire = createRequire(
  join(__dirname, "../../vendor/node-xmpp-client/package.json"),
);

// These tests exercise the real legacy protocol modules with the replacement
// dependencies. They must not be replaced by stubs that only check versions.
void test("legacy MQTT/XML still encodes custom areas and decodes robot reports", () => {
  const Protocol = ecovacsRequire("./library/non950type/ecovacsMQTT_XML");
  const commands = ecovacsRequire("./library/non950type/command");
  const protocol = new Protocol(
    { is950type: () => false },
    "user",
    "ecouser.net",
    "client",
    "dummy-token",
    "eu",
    "de",
    {},
    "localhost",
  );
  const payload = protocol.getCommandPayload(
    new commands.CustomArea("start", "-100,-200,300,400", 1),
  );
  const { DOMParser } = ecovacsRequire("@xmldom/xmldom");
  const xml = new DOMParser().parseFromString(payload, "text/xml");
  assert.equal(
    xml.getElementsByTagName("clean")[0].getAttribute("p"),
    "-100,-200,300,400",
  );
  assert.equal(xml.documentElement.hasAttribute("td"), false);
  const report = protocol.commandXml2Json(
    '<ctl td="ChargeState" type="SlotCharging"/>',
  );
  assert.equal(report.event, "ChargeState");
  assert.equal(report.attrs.type, "SlotCharging");
  const life = protocol.commandXml2Json(
    '<ctl td="LifeSpan"><life type="Brush" val="75"/></ctl>',
  );
  assert.ok(
    life.children.some(
      (child: any) => child.attrs.type === "Brush" && child.attrs.val === "75",
    ),
  );
});

void test(
  "legacy XMPP/BOSH can POST XML using the maintained request replacement",
  { timeout: 7000 },
  async (t) => {
    let received = "";
    const server = createServer((request, response) => {
      assert.equal(request.method, "POST");
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        received += chunk;
      });
      request.on("end", () => {
        response.setHeader("Content-Type", "text/xml");
        response.end(
          '<body xmlns="http://jabber.org/protocol/httpbind" sid="test-session"/>',
        );
      });
    });
    t.after(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const Bosh = xmppRequire("./lib/bosh");
    const connection = Object.create(Bosh.prototype);
    Object.assign(connection, {
      boshURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/xmpp`,
      rid: 1,
      currentRequests: 0,
      xmlnsAttrs: { xmlns: "http://jabber.org/protocol/httpbind" },
      maxHTTPRetries: 0,
    });
    const body = await new Promise<any>((resolve, reject) =>
      connection.request({}, [], (error: unknown, value: unknown) =>
        error
          ? reject(
              error instanceof Error
                ? error
                : new Error(
                    typeof error === "string"
                      ? error
                      : "Unknown XMPP request error",
                  ),
            )
          : resolve(value),
      ),
    );
    assert.equal(body.attrs.sid, "test-session");
    assert.match(received, /rid="1"/);
    assert.equal(connection.currentRequests, 0);
  },
);

void test(
  "legacy XMPP WebSocket framing still exchanges stanzas",
  { timeout: 7000 },
  async (t) => {
    const WebSocket = xmppRequire("ws");
    const server = new WebSocket.Server({ host: "127.0.0.1", port: 0 });
    t.after(
      () =>
        new Promise<void>((resolve) => {
          for (const client of server.clients) {
            client.terminate();
          }
          server.close(() => resolve());
        }),
    );
    await once(server, "listening");
    const frames: string[] = [];
    server.on("connection", (socket: any) => {
      socket.on("message", (data: Buffer) => {
        frames.push(data.toString());
        if (frames.length === 1) {
          socket.send(
            '<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" from="example.org" id="session"/>',
          );
          socket.send(
            '<message xmlns="jabber:client" from="robot@example.org"><body>ready</body></message>',
          );
        }
      });
    });
    const WSConnection = xmppRequire("./lib/websockets");
    const connection = new WSConnection({
      websocket: {
        url: `ws://127.0.0.1:${server.address().port}`,
        options: {},
      },
      jid: { domain: "example.org" },
    });
    t.after(() => connection.websocket.terminate());
    const stanzaPromise = new Promise<any>((resolve, reject) => {
      connection.on("stanza", (stanza: any) => {
        if (stanza.is("message")) {
          resolve(stanza);
        }
      });
      connection.once("error", reject);
    });
    connection.on("connected", () => connection.startStream());
    const stanza = await stanzaPromise;
    assert.equal(stanza.getChildText("body"), "ready");
    assert.match(frames[0], /<open/);
  },
);

void test("XML CDATA cannot insert an extra element through serialization", () => {
  const { DOMImplementation } = ecovacsRequire("@xmldom/xmldom");
  const document = new DOMImplementation().createDocument(null, "root", null);
  assert.throws(() => document.createCDATASection("value]]><injected/>"), {
    name: "InvalidCharacterError",
  });
});

void test(
  "legacy HTTP dependency blocks cross-protocol redirect agent reuse",
  { timeout: 7000 },
  async (t) => {
    const request = xmppRequire("@cypress/request");
    const server = createServer((_request, response) => {
      response.writeHead(302, {
        Location: `https://127.0.0.1:${(server.address() as AddressInfo).port}/private`,
      });
      response.end();
    });
    server.on("clientError", (_error, socket) => socket.destroy());
    t.after(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const agent = new HttpAgent();
    t.after(() => agent.destroy());
    const error = await new Promise<any>((resolve) => {
      request(
        {
          agent,
          proxy: null,
          uri: `http://127.0.0.1:${(server.address() as AddressInfo).port}/redirect`,
          timeout: 3000,
        },
        (error: unknown) => resolve(error),
      );
    });
    assert.ok(
      error,
      "cross-protocol redirect must fail instead of reaching the redirected endpoint",
    );
    assert.equal(error.code, "ERR_INVALID_PROTOCOL");
  },
);

void test("room geometry remains available without the unused native canvas backend", () => {
  const { EcovacsMapSpotAreaInfo } = ecovacsRequire("./library/mapInfo");
  const boundaries = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];
  const room = new EcovacsMapSpotAreaInfo(
    "floor-1",
    "7",
    [],
    boundaries,
    "0",
    "Kitchen",
  );
  assert.deepEqual(room.mapSpotAreaBoundaries, boundaries);
  assert.equal(room.mapSpotAreaID, "7");
  assert.equal(room.mapSpotAreaCanvas, null);
});

void test("distributed factory keeps legacy MQTT, legacy XMPP and modern model routes", (t) => {
  // A synthetic host identifier makes this an offline routing test. It does
  // not assert actual cloud connectivity or controller startup.
  // Mock the mutable CommonJS module export used by the legacy factory.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  t.mock.method(require("node:os"), "networkInterfaces", () => ({}));
  const { EcoVacsAPI } = ecovacsRequire("./index");
  const models = ecovacsRequire("./library/models");
  const api = new EcoVacsAPI("offline-test", "de", "eu");
  api.uid = "test-user";
  api.user_access_token = "dummy-token";
  const legacy = api.getVacBotObj({
    did: "legacy",
    class: "ls1ok3",
    company: "eco-ng",
    resource: "atom",
  });
  const modern = api.getVacBotObj({
    did: "modern",
    class: "z4lvk7",
    company: "eco-ng",
    resource: "atom",
  });
  assert.equal(legacy.is950type(), false);
  assert.equal(modern.is950type(), true);
  const entry = Object.entries(models.KnownDevices).find(([, value]) =>
    /N79/.test((value as any).name),
  );
  assert.ok(entry, "legacy XMPP model catalogue must remain present");
  const xmpp = api.getVacBotObj({
    did: "xmpp",
    class: entry[0],
    company: "eco",
    resource: "atom",
  });
  assert.equal(xmpp.ecovacs.constructor.name, "EcovacsXMPP_XML");
});
