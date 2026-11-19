/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

import type { TimerService } from "../src/ecovacs/TimerService";

/**
 * Real Node.js timers for tests that run without an ioBroker adapter.
 */
export const testTimerService: TimerService = {
  setTimeout: (callback, delay) =>
    setTimeout(callback, delay) as unknown as ioBroker.Timeout,
  clearTimeout: (timer) => {
    if (timer !== undefined) {
      clearTimeout(timer as unknown as NodeJS.Timeout);
    }
  },
  setInterval: (callback, delay) =>
    setInterval(callback, delay) as unknown as ioBroker.Interval,
  clearInterval: (timer) => {
    if (timer !== undefined) {
      clearInterval(timer as unknown as NodeJS.Timeout);
    }
  },
};
