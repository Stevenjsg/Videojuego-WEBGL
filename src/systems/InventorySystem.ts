import { Flashlight } from "@entities/Flashlight";

export class InventorySystem {
  public objectives = 0;
  public objectivesTotal = 5;
  public keys: Set<string> = new Set();

  constructor(public flashlight: Flashlight) {}

  pickupFlashlight() {
    this.flashlight.equip();
  }

  pickupBattery(amount01: number) {
    this.flashlight.addBattery(amount01);
  }

  pickupKey(keyName: string) {
    this.keys.add(keyName);
  }

  hasKey(keyName: string) {
    return this.keys.has(keyName);
  }

  pickupObjective() {
    this.objectives = Math.min(this.objectives + 1, this.objectivesTotal);
  }
}
