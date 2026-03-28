// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { InstanceService } from "../services/instance.js";

/**
 * Humanized mouse interaction via LinkedHelper's VirtualMouse.
 *
 * Accesses LH's VirtualMouse through `@electron/remote` from the
 * instance UI target.  VirtualMouse provides Bezier-curve mouse paths
 * with intentional overshoot, recorded human track replay, velocity
 * variation, and proper press/release click timing — all dispatched
 * to the LinkedIn WebView via CDP `Input.dispatchMouseEvent`.
 *
 * Call {@link initialize} after `InstanceService.connect()` to probe
 * whether VirtualMouse is accessible.  If not, all methods throw.
 */
export class HumanizedMouse {
  private available = false;

  constructor(private readonly instance: InstanceService) {}

  /**
   * Probe whether LH's VirtualMouse is accessible via `@electron/remote`.
   *
   * @returns `true` if VirtualMouse is available and methods can be called.
   */
  async initialize(): Promise<boolean> {
    try {
      this.available = await this.instance.evaluateUI<boolean>(
        `(() => {
          try {
            const remote = require('@electron/remote');
            const mw = remote.getGlobal('mainWindow');
            return typeof mw?.contentWindow?.virtualMouse?.click === 'function';
          } catch { return false; }
        })()`,
        false,
      );
    } catch {
      this.available = false;
    }
    return this.available;
  }

  /** Whether LH's native VirtualMouse is available. */
  get isAvailable(): boolean {
    return this.available;
  }

  /**
   * Move the cursor to the given coordinates along a humanized path.
   *
   * Uses Bezier curves with random cubic anchors (creating wrist-arc
   * paths), intentional overshoot (40–91 % probability depending on
   * distance), and variable velocity (fast start, slow finish).
   * When recorded human tracks are available, replays a matching track
   * rotated and scaled to fit the movement vector.
   */
  async move(x: number, y: number): Promise<void> {
    await this.vmEval(`vm.move({ x: ${String(x)}, y: ${String(y)} })`);
  }

  /**
   * Move the cursor to the given coordinates and click.
   *
   * The cursor follows a humanized path to the target, then dispatches
   * `mousePressed` → 100 ms delay → `mouseReleased` via CDP.
   */
  async click(x: number, y: number): Promise<void> {
    await this.vmEval(`vm.click({ x: ${String(x)}, y: ${String(y)} })`);
  }

  /**
   * Move the cursor to the given coordinates and scroll vertically.
   *
   * Scrolling is emulated as incremental mouse-wheel strokes (150 px
   * every 25 ms by default) to mimic a physical scroll wheel.
   *
   * @param deltaY  - Pixels to scroll (positive = down, negative = up).
   * @param x       - Cursor X position for the scroll.
   * @param y       - Cursor Y position for the scroll.
   */
  async scrollY(deltaY: number, x: number, y: number): Promise<void> {
    await this.vmEval(
      `vm.scrollY(${String(deltaY)}, { x: ${String(x)}, y: ${String(y)} })`,
    );
  }

  /**
   * Get the current VirtualMouse cursor position.
   */
  async position(): Promise<{ x: number; y: number }> {
    this.ensureAvailable();
    return this.instance.evaluateUI<{ x: number; y: number }>(
      `(() => {
        const remote = require('@electron/remote');
        const vm = remote.getGlobal('mainWindow').contentWindow.virtualMouse;
        return { x: vm.position.x, y: vm.position.y };
      })()`,
      false,
    );
  }

  /**
   * Evaluate an expression on the VirtualMouse instance (awaited).
   *
   * The expression must reference the VirtualMouse instance as `vm`.
   */
  private async vmEval(expr: string): Promise<void> {
    this.ensureAvailable();
    await this.instance.evaluateUI(
      `(async () => {
        const remote = require('@electron/remote');
        const vm = remote.getGlobal('mainWindow').contentWindow.virtualMouse;
        await ${expr};
      })()`,
      true,
    );
  }

  private ensureAvailable(): void {
    if (!this.available) {
      throw new Error(
        "HumanizedMouse is not available — call initialize() first or check isAvailable",
      );
    }
  }
}
