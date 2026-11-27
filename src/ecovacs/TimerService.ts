/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H.
 * See THIRD_PARTY_NOTICES.md for upstream components and retained notices.
 */

/**
 * Timer operations supplied by the ioBroker adapter.
 * Timer handles may be undefined when the adapter is stopping.
 */
export interface TimerService {
  /**
   * Schedules a callback to run once after a delay.
   *
   * @param callback - Function to execute.
   * @param delay - Delay in milliseconds.
   * @returns Timer handle, or undefined if scheduling is unavailable.
   */
  setTimeout: (
    callback: () => void,
    delay: number,
  ) => ioBroker.Timeout | undefined;
  /**
   * Cancels a previously scheduled timeout.
   *
   * @param timer - Timeout handle to cancel.
   */
  clearTimeout: (timer: ioBroker.Timeout | undefined) => void;
  /**
   * Schedules a callback to run repeatedly.
   *
   * @param callback - Function to execute.
   * @param delay - Interval in milliseconds.
   * @returns Timer handle, or undefined if scheduling is unavailable.
   */
  setInterval: (
    callback: () => void,
    delay: number,
  ) => ioBroker.Interval | undefined;
  /**
   * Cancels a previously scheduled interval.
   *
   * @param timer - Interval handle to cancel.
   */
  clearInterval: (timer: ioBroker.Interval | undefined) => void;
}
