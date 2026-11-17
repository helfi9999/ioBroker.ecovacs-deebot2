/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import type { Point, Room, RoomGroup } from "../domain/types";
import { EventBus } from "../events/EventBus";

interface RobotRooms {
  rooms: Map<string, Room>;
  groups: Map<string, RoomGroup>;
}

export class RoomManager {
  private readonly robots = new Map<string, RobotRooms>();

  constructor(private readonly events: EventBus) {}

  sync(robotId: string, discovered: Array<Pick<Room, "id" | "ecovacsName" | "polygon">>): Room[] {
    const store = this.store(robotId);
    const incoming = new Set(discovered.map(room => room.id));
    for (const id of store.rooms.keys()) if (!incoming.has(id)) store.rooms.delete(id);

    for (const item of discovered) {
      const current = store.rooms.get(item.id);
      const room: Room = {
        id: item.id,
        ecovacsName: item.ecovacsName,
        displayName: current?.displayName ?? item.ecovacsName,
        polygon: structuredClone(item.polygon),
        center: this.center(item.polygon),
        groupId: current?.groupId ?? null,
      };
      store.rooms.set(room.id, room);
    }
    this.repairGroups(store);
    return this.getRooms(robotId);
  }

  rename(robotId: string, roomId: string, displayName: string): Room {
    const room = this.requireRoom(robotId, roomId);
    const name = displayName.trim();
    if (!name) throw new Error("Room name must not be empty");
    room.displayName = name;
    this.events.emit("room:updated", { robotId, room: structuredClone(room) });
    return structuredClone(room);
  }

  merge(robotId: string, roomIds: string[], groupName: string): RoomGroup {
    const ids = [...new Set(roomIds)];
    if (ids.length < 2) throw new Error("A room group needs at least two rooms");
    const name = groupName.trim();
    if (!name) throw new Error("Group name must not be empty");
    const store = this.store(robotId);
    ids.forEach(id => this.requireRoom(robotId, id));
    const groupId = ids.slice().sort().join(",");
    const group: RoomGroup = { id: groupId, name, roomIds: ids.slice().sort() };
    store.groups.set(groupId, group);
    for (const id of ids) {
      const room = store.rooms.get(id)!;
      if (room.groupId && room.groupId !== groupId) this.removeRoomFromGroup(store, room.groupId, id);
      room.groupId = groupId;
      room.displayName = name;
      this.events.emit("room:updated", { robotId, room: structuredClone(room) });
    }
    return structuredClone(group);
  }

  unmerge(robotId: string, groupId: string): void {
    const store = this.store(robotId);
    const group = store.groups.get(groupId);
    if (!group) return;
    for (const id of group.roomIds) {
      const room = store.rooms.get(id);
      if (room) room.groupId = null;
    }
    store.groups.delete(groupId);
  }

  getRooms(robotId: string): Room[] {
    return [...this.store(robotId).rooms.values()].map(room => structuredClone(room));
  }

  getGroups(robotId: string): RoomGroup[] {
    return [...this.store(robotId).groups.values()].map(group => structuredClone(group));
  }

  export(robotId: string): { rooms: Room[]; groups: RoomGroup[] } {
    return { rooms: this.getRooms(robotId), groups: this.getGroups(robotId) };
  }

  private store(robotId: string): RobotRooms {
    let store = this.robots.get(robotId);
    if (!store) {
      store = { rooms: new Map(), groups: new Map() };
      this.robots.set(robotId, store);
    }
    return store;
  }

  private requireRoom(robotId: string, roomId: string): Room {
    const room = this.store(robotId).rooms.get(roomId);
    if (!room) throw new Error(`Unknown room ${roomId} for robot ${robotId}`);
    return room;
  }

  private center(points: Point[]): Point | null {
    if (points.length === 0) return null;
    const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
    return { x: total.x / points.length, y: total.y / points.length };
  }

  private removeRoomFromGroup(store: RobotRooms, groupId: string, roomId: string): void {
    const group = store.groups.get(groupId);
    if (!group) return;
    group.roomIds = group.roomIds.filter(id => id !== roomId);
    if (group.roomIds.length < 2) store.groups.delete(groupId);
  }

  private repairGroups(store: RobotRooms): void {
    for (const [groupId, group] of store.groups) {
      group.roomIds = group.roomIds.filter(id => store.rooms.has(id));
      if (group.roomIds.length < 2) store.groups.delete(groupId);
    }
    for (const room of store.rooms.values()) {
      if (room.groupId && !store.groups.has(room.groupId)) room.groupId = null;
    }
  }
}
