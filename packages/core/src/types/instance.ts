/**
 * LinkedHelper instance lifecycle types.
 *
 * An "instance" is a running LinkedHelper browser session tied to a
 * specific LinkedIn account.
 */

export interface StartInstanceParams {
  linkedInAccount: { id: number; liId: number };
  accountData: { id: number; liId: number };
  instanceId: number;
  proxy: null;
  license: null;
  userId: null;
  frontendSettings: Record<string, unknown>;
  lhAccount: Record<string, unknown>;
  zoomDefault: number;
  shouldBringToFront: boolean;
  shouldStartRunningCampaigns: boolean;
}

export interface StartInstanceResult {
  success: boolean;
  error?: string | undefined;
}

export type InstanceStatus = "stopped" | "starting" | "running" | "stopping";

export interface InstanceInfo {
  instanceId: number;
  status: InstanceStatus;
  debuggerPort?: number | undefined;
}
