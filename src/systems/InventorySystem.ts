import { Flashlight } from "@entities/Flashlight";

export class InventorySystem {
  public objectives = 0;
  public objectivesTotal = 5;

  constructor(public flashlight: Flashlight) {}

  pickupFlashlight() {
    this.flashlight.equip();
  }

  pickupBattery(amount01: number) {
    this.flashlight.addBattery(amount01);
  }
}
