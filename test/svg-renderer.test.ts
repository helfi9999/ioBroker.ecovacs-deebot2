/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SvgRenderer } from "../src/map/SvgRenderer";

void test("SVG renderer creates clickable rooms and robot markers", () => {
  const svg = new SvgRenderer().render(
    {
      robotId: "sky-id",
      mapId: "map-1",
      robotPosition: { x: 50, y: 50 },
      dockPosition: { x: 10, y: 10 },
      rooms: [
        {
          id: "2",
          ecovacsName: "C",
          displayName: "Kinder & Spielzimmer",
          polygon: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
          ],
          center: { x: 50, y: 50 },
          groupId: null,
        },
      ],
    },
    90,
  );

  assert.match(svg, /^<svg/);
  assert.match(svg, /data-room-id="2"/);
  assert.match(svg, /Kinder &amp; Spielzimmer/);
  assert.match(svg, /data-marker="robot"/);
  assert.match(svg, /data-marker="dock"/);
  assert.match(svg, /data-rotation="90"/);
  assert.match(svg, /data-flip-y="true"/);
  assert.match(svg, /transform="rotate\(90 /);
  assert.match(svg, /<text[^>]+transform="rotate\(-90 50 -50\)"/);
  assert.match(svg, /width="100%" height="100%"/);
  assert.match(svg, /font-family="inherit" font-size="[\d.]+em"/);
  assert.match(svg, /fill="currentColor"/);
  assert.doesNotMatch(svg, /<rect[^>]+fill="#f8fafc"/);
  assert.doesNotMatch(svg, /Kinder & Spielzimmer/);
});

void test("rectangular maps use tight bounds and swap them when rotated", () => {
  const input = {
    robotId: "sky-id",
    mapId: "wide-map",
    robotPosition: null,
    dockPosition: null,
    rooms: [
      {
        id: "0",
        ecovacsName: "A",
        displayName: "Wohnzimmer",
        polygon: [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
          { x: 200, y: 100 },
          { x: 0, y: 100 },
        ],
        center: { x: 100, y: 50 },
        groupId: null,
      },
    ],
  };
  const normal = new SvgRenderer().render(input, 0);
  const rotated = new SvgRenderer().render(input, 90);
  assert.match(normal, /viewBox="-20 -120 240 140"/);
  assert.match(normal, /font-size="0.6em"/);
  assert.match(rotated, /viewBox="30 -170 140 240"/);
});

void test("the first five rooms receive five distinct colors", () => {
  const rooms = Array.from({ length: 5 }, (_, index) => ({
    id: String(index),
    ecovacsName: String.fromCharCode(65 + index),
    displayName: `Raum ${index + 1}`,
    polygon: [
      { x: index * 20, y: 0 },
      { x: index * 20 + 15, y: 0 },
      { x: index * 20 + 15, y: 15 },
      { x: index * 20, y: 15 },
    ],
    center: { x: index * 20 + 7.5, y: 7.5 },
    groupId: null,
  }));
  const svg = new SvgRenderer().render({
    robotId: "luna-id",
    mapId: "map-2",
    robotPosition: null,
    dockPosition: null,
    rooms,
  });
  const fills = [...svg.matchAll(/<path[^>]+fill="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.equal(new Set(fills).size, 5);
});

void test("grouped rooms share one color and one group label", () => {
  const svg = new SvgRenderer().render({
    robotId: "luna-id",
    mapId: "map-group",
    robotPosition: null,
    dockPosition: null,
    rooms: [
      {
        id: "2",
        ecovacsName: "C",
        displayName: "Kinderzimmer links",
        polygon: [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 40 },
          { x: 0, y: 40 },
        ],
        center: { x: 20, y: 20 },
        groupId: "Kinderzimmer",
      },
      {
        id: "3",
        ecovacsName: "D",
        displayName: "Kinderzimmer rechts",
        polygon: [
          { x: 40, y: 0 },
          { x: 80, y: 0 },
          { x: 80, y: 40 },
          { x: 40, y: 40 },
        ],
        center: { x: 60, y: 20 },
        groupId: "Kinderzimmer",
      },
    ],
  });
  assert.match(svg, /class="room room-group"/);
  assert.match(svg, /data-room-group="Kinderzimmer"/);
  assert.equal([...svg.matchAll(/<text/g)].length, 1);
  assert.equal([...svg.matchAll(/<path/g)].length, 2);
  const fills = [...svg.matchAll(/<path[^>]+fill="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.equal(new Set(fills).size, 1);
});

void test("rotation snaps to cardinal directions", () => {
  const renderer = new SvgRenderer();
  assert.equal(renderer.normalizeRotation(88), 90);
  assert.equal(renderer.normalizeRotation(181), 180);
  assert.equal(renderer.normalizeRotation(-90), 270);
});

void test("interactive SVG marks selected rooms and writes selection through VIS", () => {
  const svg = new SvgRenderer().render(
    {
      robotId: "luna",
      mapId: "map",
      robotPosition: null,
      dockPosition: null,
      rooms: [
        {
          id: "2",
          ecovacsName: "B",
          displayName: "Esszimmer",
          groupId: null,
          polygon: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
          ],
          center: { x: 60, y: 30 },
        },
      ],
    },
    0,
    {
      selectedRoomIds: ["2"],
      roomStateBase: "ecovacs-deebot2.0.devices.Luna.rooms",
    },
  );
  assert.match(svg, /class="room selected"/);
  assert.match(svg, /stroke="#ffffff"/);
  assert.match(
    svg,
    /vis\.setValue\(&apos;ecovacs-deebot2\.0\.devices\.Luna\.rooms\.2\.selected&apos;,false\)/,
  );
});

void test("active custom area is rendered on the existing map", () => {
  const svg = new SvgRenderer().render(
    {
      robotId: "sky",
      mapId: "map",
      robotPosition: null,
      dockPosition: null,
      rooms: [
        {
          id: "1",
          ecovacsName: "A",
          displayName: "Wohnzimmer",
          groupId: null,
          polygon: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
          ],
          center: { x: 60, y: 30 },
        },
      ],
    },
    0,
    {
      customArea: {
        active: true,
        values: "10,20,80,90",
        stateId: "ecovacs-deebot2.0.devices.Sky.customArea.values",
      },
    },
  );
  assert.match(svg, /class="custom-area"/);
  assert.match(svg, /x="10"/);
  assert.match(svg, /y="-90"/);
  assert.match(svg, /touch-action:none/);
  assert.match(svg, /onpointermove=/);
  assert.match(svg, /vis\.setValue/);
  assert.match(
    svg,
    /data-state-id="ecovacs-deebot2\.0\.devices\.Sky\.customArea\.values"/,
  );
  assert.equal((svg.match(/data-handle=/g) ?? []).length, 4);
});

void test("custom area drag and resize use short valid inline handlers", () => {
  const svg = new SvgRenderer().render(
    {
      robotId: "sky",
      mapId: "map",
      robotPosition: null,
      dockPosition: null,
      rooms: [
        {
          id: "1",
          ecovacsName: "A",
          displayName: "Zimmer",
          groupId: null,
          polygon: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
          ],
          center: { x: 50, y: 50 },
        },
      ],
    },
    0,
    {
      customArea: {
        active: true,
        values: "10,-20,80,-90",
        stateId: "robot.customArea.values",
      },
    },
  );
  const handlers = Object.fromEntries(
    ["onpointerdown", "onpointermove", "onpointerup"].map((name) => {
      const encoded = svg.match(new RegExp(`${name}="([^"]+)"`))?.[1];
      assert.ok(encoded);
      assert.ok(
        encoded.length < 1000,
        `${name} must stay short enough for VIS`,
      );
      const decoded = encoded
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
      return [name, new Function("event", "window", decoded)];
    }),
  ) as Record<
    string,
    (this: unknown, event: unknown, window: unknown) => unknown
  >;
  const writes: Array<[string, string]> = [];
  const windowMock = {
    vis: { setValue: (id: string, value: string) => writes.push([id, value]) },
  };
  const rectangle = (
    initial: Record<string, number>,
  ): {
    getAttribute: (name: string) => string | undefined;
    setAttribute: (name: string, value: unknown) => Map<string, string>;
  } => {
    const attrs = new Map(
      Object.entries(initial).map(([name, value]) => [name, String(value)]),
    );
    return {
      getAttribute: (name: string) => attrs.get(name),
      setAttribute: (name: string, value: unknown) =>
        attrs.set(name, String(value)),
    };
  };
  const rect = rectangle({ x: 10, y: 20, width: 70, height: 70 });
  const handles = Array.from({ length: 4 }, () => ({ setAttribute() {} }));
  const group = {
    ownerSVGElement: {
      createSVGPoint: () => ({
        x: 0,
        y: 0,
        matrixTransform() {
          return this;
        },
      }),
    },
    getScreenCTM: () => ({ inverse: () => ({}) }),
    getAttribute: () => "robot.customArea.values",
    querySelector: () => rect,
    querySelectorAll: () => handles,
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const event = (
    x: number,
    y: number,
    handle: string | null = null,
    type = "pointerdown",
  ): {
    type: string;
    button: number;
    pointerId: number;
    clientX: number;
    clientY: number;
    target: { getAttribute: () => string | null };
    preventDefault: () => void;
    stopPropagation: () => void;
  } => ({
    type,
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    target: { getAttribute: () => handle },
    preventDefault() {},
    stopPropagation() {},
  });
  handlers.onpointerdown.call(group, event(10, 20, "se"), windowMock);
  handlers.onpointermove.call(group, event(30, 40), windowMock);
  assert.equal(rect.getAttribute("width"), "90");
  assert.equal(rect.getAttribute("height"), "90");
  handlers.onpointerup.call(group, event(30, 40), windowMock);
  assert.deepEqual(writes, [["robot.customArea.values", "10,-20,100,-110"]]);
});

void test("robot marker supports a relative size and custom image", () => {
  const svg = new SvgRenderer().render(
    {
      robotId: "sky",
      mapId: "map",
      robotPosition: { x: 50, y: 50 },
      dockPosition: null,
      rooms: [
        {
          id: "1",
          ecovacsName: "A",
          displayName: "Wohnzimmer",
          groupId: null,
          polygon: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 100 },
          ],
          center: { x: 100, y: 30 },
        },
      ],
    },
    0,
    {
      robotSizePercent: 3,
      robotImageUrl: "https://example.test/robot.png?a=1&b=2",
    },
  );
  assert.match(svg, /class="robot"/);
  assert.match(svg, /r="6"/);
  assert.match(svg, /href="https:\/\/example\.test\/robot\.png\?a=1&amp;b=2"/);
  assert.match(svg, /clip-path="url\(#robot-clip-sky\)"/);
  assert.match(svg, /preserveAspectRatio="xMidYMid slice"/);
  assert.match(svg, /onerror="this\.style\.display=&apos;none&apos;"/);
  assert.match(svg, /fill="#263238"/);
});

void test("live cleaning trail follows map coordinates", () => {
  const svg = new SvgRenderer().render(
    {
      robotId: "sky",
      mapId: "map",
      robotPosition: { x: 80, y: 70 },
      dockPosition: null,
      rooms: [
        {
          id: "1",
          ecovacsName: "A",
          displayName: "Wohnzimmer",
          groupId: null,
          polygon: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
          ],
          center: { x: 50, y: 50 },
        },
      ],
    },
    0,
    {
      trail: [
        { x: 10, y: 20 },
        { x: 40, y: 50 },
        { x: 80, y: 70 },
      ],
    },
  );
  assert.match(svg, /class="cleaning-trail"/);
  assert.match(svg, /points="10,-20 40,-50 80,-70"/);
  assert.match(svg, /stroke="#ff3b30"/);
  assert.match(svg, /stroke-width="1\.5"/);
  assert.match(svg, /stroke-opacity="0\.65"/);
});
