import type { NetworkAccount } from '@prisma/client';

/**
 * Bridge between the portal and the network equipment.
 *
 * V1 ships with the ManualAdapter: it applies nothing, so `enabled` stays as the admin last
 * confirmed it and the mismatch with `desiredEnabled` shows up in the admin "Network" to-do list.
 *
 * To automate (V2), implement this interface for the real gear (MikroTik RouterOS API / hotspot
 * users, RADIUS, UniFi controller vouchers, ...) and return it from `getNetworkAdapter()`.
 * `setAccess` should return true when the change was actually applied on the device.
 */
export interface NetworkAdapter {
  readonly name: string;
  readonly automatic: boolean;
  setAccess(account: NetworkAccount, enabled: boolean): Promise<boolean>;
}

class ManualAdapter implements NetworkAdapter {
  readonly name = 'manual';
  readonly automatic = false;
  async setAccess() {
    return false;
  }
}

let adapter: NetworkAdapter = new ManualAdapter();

export const getNetworkAdapter = () => adapter;
export const setNetworkAdapter = (a: NetworkAdapter) => {
  adapter = a;
};
