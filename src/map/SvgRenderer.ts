/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * Map-related portions based on ioBroker.ecovacs-map, Copyright (c) 2026 Helfi9999.
 * Original MIT terms are preserved in licenses/ioBroker.ecovacs-map-MIT.txt.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import type { Point, Room } from "../domain/types";

/** Robot map data used to generate an SVG visualization. */
export interface SvgRenderInput {
  robotId: string;
  mapId: string;
  rooms: Room[];
  robotPosition: Point | null;
  dockPosition: Point | null;
  currentRoomId?: string | null;
  currentRoomName?: string | null;
}

/** Optional display settings and interactive map elements. */
export interface SvgRenderOptions {
  selectedRoomIds?: string[];
  roomStateBase?: string;
  customArea?: { active: boolean; values: string; stateId?: string };
  robotSizePercent?: number;
  robotImageUrl?: string;
  trail?: Point[];
}

/** Generates SVG maps with rooms, robot markers, and controls. */
export class SvgRenderer {
  private readonly colors = [
    "#3f5944",
    "#6a3d6d",
    "#895d20",
    "#34626a",
    "#78404d",
  ];
  private readonly strokes = [
    "#35b44a",
    "#bd4fd0",
    "#a66a18",
    "#19c3d2",
    "#e05a72",
  ];

  /**
   * Renders the robot map as an SVG document.
   *
   * @param input - Map geometry and robot positions.
   * @param rotation - Map rotation in degrees.
   * @param options - Optional display and interaction settings.
   * @returns SVG markup for the map.
   */
  render(
    input: SvgRenderInput,
    rotation = 0,
    options: SvgRenderOptions = {},
  ): string {
    input = this.flipY(input);
    const points = [
      ...input.rooms.flatMap((room) => room.polygon),
      ...(input.robotPosition ? [input.robotPosition] : []),
      ...(input.dockPosition ? [input.dockPosition] : []),
    ];
    if (!points.length) {
      return this.empty(input);
    }

    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxY = Math.max(...points.map((point) => point.y));
    const rawWidth = Math.max(maxX - minX, 1);
    const rawHeight = Math.max(maxY - minY, 1);
    const padding = Math.max(Math.max(rawWidth, rawHeight) * 0.06, 20);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const baseMarkerSize = Math.max(Math.max(rawWidth, rawHeight) * 0.025, 8);
    const robotSizePercent = Math.max(
      0.5,
      Math.min(10, Number(options.robotSizePercent) || 1.8),
    );
    const markerSize = Math.max(
      (Math.max(rawWidth, rawHeight) * robotSizePercent) / 100,
      4,
    );
    const angle = this.normalizeRotation(rotation);
    const swapsAxes = angle === 90 || angle === 270;
    const viewWidth = (swapsAxes ? rawHeight : rawWidth) + padding * 2;
    const viewHeight = (swapsAxes ? rawWidth : rawHeight) + padding * 2;
    const viewX = centerX - viewWidth / 2;
    const viewY = centerY - viewHeight / 2;
    const labelScale = Math.max(viewWidth, viewHeight) / 400;

    const visualKeys = [
      ...new Set(input.rooms.map((room) => room.groupId || room.id)),
    ].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
    const colorIndexes = new Map(
      visualKeys.map((key, index) => [key, index % this.colors.length]),
    );
    const groupedRooms = new Map<string, Room[]>();
    for (const room of input.rooms) {
      const key = room.groupId || room.id;
      const group = groupedRooms.get(key) ?? [];
      group.push(room);
      groupedRooms.set(key, group);
    }
    const rooms = [...groupedRooms.entries()]
      .map(([key, group]) =>
        this.roomGroup(
          group,
          colorIndexes.get(key) ?? 0,
          angle,
          labelScale,
          options,
        ),
      )
      .join("");
    const dock = input.dockPosition
      ? this.dock(input.dockPosition, markerSize)
      : "";
    const robot = input.robotPosition
      ? this.robot(
          input.robotPosition,
          markerSize,
          options.robotImageUrl,
          input.robotId,
        )
      : "";
    const customArea = this.customArea(options.customArea, baseMarkerSize);
    const trail = this.trail(options.trail);
    const svgTouchStyle = options.customArea?.active
      ? ";touch-action:none;overscroll-behavior:contain;-webkit-user-select:none;user-select:none"
      : "";
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="${this.n(viewX)} ${this.n(viewY)} ${this.n(viewWidth)} ${this.n(viewHeight)}" preserveAspectRatio="xMidYMid meet" style="display:block${svgTouchStyle}" role="img" aria-label="Karte ${this.escape(input.mapId)}" data-robot-id="${this.escape(input.robotId)}" data-map-id="${this.escape(input.mapId)}" data-rotation="${angle}" data-flip-y="true">` +
      `<g class="map-content" transform="rotate(${angle} ${this.n(centerX)} ${this.n(centerY)})"><g class="rooms">${rooms}</g>${customArea}${trail}<g class="markers">${dock}${robot}</g></g></svg>`
    );
  }

  private roomGroup(
    rooms: Room[],
    colorIndex: number,
    rotation: number,
    labelScale: number,
    options: SvgRenderOptions,
  ): string {
    const drawable = rooms.filter((room) => room.polygon.length >= 3);
    if (!drawable.length) {
      return "";
    }
    const grouped = drawable.length > 1 && Boolean(drawable[0].groupId);
    const points = drawable.flatMap((room) => room.polygon);
    const center = grouped
      ? this.boundingCenter(points)
      : (drawable[0].center ?? this.center(points));
    const displayName = grouped
      ? drawable[0].groupId!
      : drawable[0].displayName;
    const selectedIds = new Set(options.selectedRoomIds ?? []);
    const selected = drawable.every((room) => selectedIds.has(room.id));
    const click = options.roomStateBase
      ? this.clickScript(
          drawable.map((room) => room.id),
          selected,
          options.roomStateBase,
        )
      : "";
    const interaction = click
      ? ` style="cursor:pointer;pointer-events:auto" onclick="${this.escape(click)}"`
      : "";
    const label = center
      ? `<text x="${this.n(center.x)}" y="${this.n(center.y)}" transform="rotate(${-rotation} ${this.n(center.x)} ${this.n(center.y)})" text-anchor="middle" dominant-baseline="middle" font-family="inherit" font-size="${this.n(labelScale)}em" font-style="inherit" font-weight="inherit" fill="currentColor" pointer-events="none">${this.escape(displayName)}</text>`
      : "";
    const paths = drawable
      .map((room) => {
        const path = `${room.polygon
          .map(
            (point, index) =>
              `${index ? "L" : "M"}${this.n(point.x)} ${this.n(point.y)}`,
          )
          .join(" ")} Z`;
        const fill = selected
          ? this.lighten(this.colors[colorIndex], 0.48)
          : this.colors[colorIndex];
        const stroke = selected ? "#ffffff" : this.strokes[colorIndex];
        return `<path data-room-id="${this.escape(room.id)}" d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="${selected ? 4 : 1.5}" vector-effect="non-scaling-stroke"/>`;
      })
      .join("");
    const roomIds = drawable.map((room) => room.id).join(",");
    return `<g class="room${grouped ? " room-group" : ""}${selected ? " selected" : ""}" data-room-id="${this.escape(roomIds)}" data-room-name="${this.escape(displayName)}"${grouped ? ` data-room-group="${this.escape(displayName)}"` : ""}${interaction}>${paths}${label}</g>`;
  }

  private clickScript(
    roomIds: string[],
    selected: boolean,
    base: string,
  ): string {
    const target = selected ? "false" : "true";
    return roomIds
      .map((roomId) => {
        const stateId = `${base}.${this.objectId(roomId)}.selected`;
        return `if(window.vis&&typeof vis.setValue==='function'){vis.setValue('${stateId}',${target});}else if(window.socket&&typeof socket.emit==='function'){socket.emit('setState','${stateId}',{val:${target},ack:false});}`;
      })
      .join("");
  }

  private lighten(color: string, amount: number): string {
    const match = /^#([0-9a-f]{6})$/i.exec(color);
    if (!match) {
      return color;
    }
    const parts = [0, 2, 4].map((index) =>
      parseInt(match[1].slice(index, index + 2), 16),
    );
    return `#${parts
      .map((value) =>
        Math.round(value + (255 - value) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  }

  private objectId(value: string): string {
    return (
      value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "Room"
    );
  }

  private dock(point: Point, size: number): string {
    const half = size * 0.7;
    return `<g class="dock" data-marker="dock"><rect x="${this.n(point.x - half)}" y="${this.n(point.y - half)}" width="${this.n(half * 2)}" height="${this.n(half * 2)}" rx="${this.n(size * 0.2)}" fill="#334155" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="${this.n(point.x)}" cy="${this.n(point.y)}" r="${this.n(size * 0.22)}" fill="#22c55e"/></g>`;
  }

  private customArea(
    area: { active: boolean; values: string; stateId?: string } | undefined,
    markerSize: number,
  ): string {
    if (!area?.active) {
      return "";
    }
    const values = area.values.split(",").map(Number);
    if (
      values.length !== 4 ||
      values.some((value) => !Number.isFinite(value))
    ) {
      return "";
    }
    const [x1, rawY1, x2, rawY2] = values;
    const y1 = -rawY1;
    const y2 = -rawY2;
    const left = Math.min(x1, x2),
      top = Math.min(y1, y2),
      right = Math.max(x1, x2),
      bottom = Math.max(y1, y2);
    const stateId = this.escape(area.stateId ?? "");
    const down = this.escape(
      "if(event.button!==undefined&&event.button!==0)return;event.preventDefault();event.stopPropagation();var m=this.getScreenCTM();if(!m)return;var p=this.ownerSVGElement.createSVGPoint();p.x=event.clientX;p.y=event.clientY;p=p.matrixTransform(m.inverse());var r=this.querySelector('rect[data-area]');this.__drag={id:event.pointerId,mode:event.target.getAttribute('data-handle')||'move',x:p.x,y:p.y,l:+r.getAttribute('x'),t:+r.getAttribute('y'),w:+r.getAttribute('width'),h:+r.getAttribute('height')};if(event.pointerId!==undefined&&this.setPointerCapture)this.setPointerCapture(event.pointerId);",
    );
    const move = this.escape(
      "var d=this.__drag;if(!d||(d.id!==undefined&&d.id!==event.pointerId))return;event.preventDefault();event.stopPropagation();var p=this.ownerSVGElement.createSVGPoint(),m=this.getScreenCTM();if(!m)return;p.x=event.clientX;p.y=event.clientY;p=p.matrixTransform(m.inverse());var x=p.x-d.x,y=p.y-d.y,l=d.l,t=d.t,r=l+d.w,b=t+d.h;if(d.mode==='move'){l+=x;r+=x;t+=y;b+=y}else{if(d.mode.indexOf('w')>=0)l+=x;if(d.mode.indexOf('e')>=0)r+=x;if(d.mode.indexOf('n')>=0)t+=y;if(d.mode.indexOf('s')>=0)b+=y;if(r-l<8)r=l+8;if(b-t<8)b=t+8}var q=this.querySelector('rect[data-area]');q.setAttribute('x',l);q.setAttribute('y',t);q.setAttribute('width',r-l);q.setAttribute('height',b-t);this.querySelectorAll('[data-handle]').forEach(function(h,i){h.setAttribute('cx',i%2?r:l);h.setAttribute('cy',i<2?t:b)});",
    );
    const up = this.escape(
      "if(!this.__drag)return;event.preventDefault();event.stopPropagation();var q=this.querySelector('rect[data-area]'),l=+q.getAttribute('x'),t=+q.getAttribute('y'),v=[l,-t,l+(+q.getAttribute('width')),-t-(+q.getAttribute('height'))].join(','),id=this.getAttribute('data-state-id');this.__drag=null;if(event.pointerId!==undefined&&this.releasePointerCapture)try{this.releasePointerCapture(event.pointerId)}catch(e){}if(window.vis&&typeof window.vis.setValue==='function')window.vis.setValue(id,v);else if(window.socket)window.socket.emit('setState',id,{val:v,ack:false});",
    );
    const handleRadius = Math.max(markerSize * 0.85, 14);
    const handles = [
      ["nw", left, top],
      ["ne", right, top],
      ["sw", left, bottom],
      ["se", right, bottom],
    ]
      .map(
        ([name, x, y]) =>
          `<circle data-handle="${name}" cx="${this.n(Number(x))}" cy="${this.n(Number(y))}" r="${this.n(handleRadius)}" fill="#ffffff" fill-opacity="0.96" stroke="#1e88e5" stroke-width="3" vector-effect="non-scaling-stroke" style="cursor:${name}-resize;pointer-events:all;touch-action:none"/>`,
      )
      .join("");
    return `<g class="custom-area" data-state-id="${stateId}" style="pointer-events:auto;touch-action:none;user-select:none" onpointerdown="${down}" onpointermove="${move}" onpointerup="${up}" onmousedown="${down}" onmousemove="${move}" onmouseup="${up}" oncontextmenu="event.preventDefault();return false"><rect data-area="true" x="${this.n(left)}" y="${this.n(top)}" width="${this.n(right - left)}" height="${this.n(bottom - top)}" fill="#38bdf8" fill-opacity="0.22" stroke="#ffffff" stroke-width="3" stroke-dasharray="8 5" vector-effect="non-scaling-stroke" style="cursor:move;pointer-events:all;touch-action:none"/>${handles}</g>`;
  }

  private trail(points?: Point[]): string {
    if (!points || points.length < 2) {
      return "";
    }
    const values = points
      .map((point) => `${this.n(point.x)},${this.n(-point.y)}`)
      .join(" ");
    return `<polyline class="cleaning-trail" points="${values}" fill="none" stroke="#ff3b30" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
  }

  private robot(
    point: Point,
    size: number,
    imageUrl: string | undefined,
    robotId: string,
  ): string {
    const url = imageUrl?.trim();
    const body = `<circle cx="${this.n(point.x)}" cy="${this.n(point.y)}" r="${this.n(size)}" fill="#263238" stroke="#ffffff" stroke-width="3" vector-effect="non-scaling-stroke"/><path d="M${this.n(point.x - size * 0.62)} ${this.n(point.y - size * 0.42)} A${this.n(size * 0.76)} ${this.n(size * 0.76)} 0 0 1 ${this.n(point.x + size * 0.62)} ${this.n(point.y - size * 0.42)}" fill="none" stroke="#90a4ae" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="${this.n(point.x)}" cy="${this.n(point.y - size * 0.2)}" r="${this.n(size * 0.27)}" fill="#607d8b" stroke="#cfd8dc" stroke-width="1.5" vector-effect="non-scaling-stroke"/><circle cx="${this.n(point.x)}" cy="${this.n(point.y - size * 0.2)}" r="${this.n(size * 0.08)}" fill="#29b6f6"/><rect x="${this.n(point.x - size * 0.28)}" y="${this.n(point.y + size * 0.48)}" width="${this.n(size * 0.56)}" height="${this.n(size * 0.12)}" rx="${this.n(size * 0.06)}" fill="#78909c"/>`;
    if (!url) {
      return `<g class="robot" data-marker="robot">${body}</g>`;
    }
    const clipId = `robot-clip-${this.objectId(robotId)}`;
    return `<g class="robot" data-marker="robot"><defs><clipPath id="${clipId}"><circle cx="${this.n(point.x)}" cy="${this.n(point.y)}" r="${this.n(size)}"/></clipPath></defs>${body}<image href="${this.escape(url)}" x="${this.n(point.x - size)}" y="${this.n(point.y - size)}" width="${this.n(size * 2)}" height="${this.n(size * 2)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" onerror="this.style.display=&apos;none&apos;"/><circle cx="${this.n(point.x)}" cy="${this.n(point.y)}" r="${this.n(size)}" fill="none" stroke="#ffffff" stroke-width="3" vector-effect="non-scaling-stroke" pointer-events="none"/></g>`;
  }

  private empty(input: SvgRenderInput): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="Keine Kartendaten" data-robot-id="${this.escape(input.robotId)}" data-map-id="${this.escape(input.mapId)}"><text x="320" y="180" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,sans-serif" font-size="24" fill="#64748b">Keine Kartendaten</text></svg>`;
  }

  /**
   * Rounds a map rotation to the nearest cardinal direction.
   *
   * @param value - Requested rotation in degrees.
   * @returns Normalized angle between 0 and 359 degrees.
   */
  normalizeRotation(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return (((Math.round(value / 90) * 90) % 360) + 360) % 360;
  }

  private flipY(input: SvgRenderInput): SvgRenderInput {
    const point = (value: Point | null): Point | null =>
      value ? { x: value.x, y: -value.y } : null;
    return {
      ...input,
      robotPosition: point(input.robotPosition),
      dockPosition: point(input.dockPosition),
      rooms: input.rooms.map((room) => ({
        ...room,
        polygon: room.polygon.map((value) => ({ x: value.x, y: -value.y })),
        center: point(room.center),
      })),
    };
  }

  private center(points: Point[]): Point | null {
    if (!points.length) {
      return null;
    }
    const sum = points.reduce(
      (result, point) => ({ x: result.x + point.x, y: result.y + point.y }),
      { x: 0, y: 0 },
    );
    return { x: sum.x / points.length, y: sum.y / points.length };
  }

  private boundingCenter(points: Point[]): Point | null {
    if (!points.length) {
      return null;
    }
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
  }

  private n(value: number): string {
    return Number(value.toFixed(2)).toString();
  }

  private escape(value: string): string {
    return value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[character]!,
    );
  }
}
