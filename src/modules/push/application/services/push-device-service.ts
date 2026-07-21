import type { PushPlatform } from "@prisma/client";

import { AppError } from "../../../../shared/errors/app-error.js";
import type { PushDeviceRepository } from "../ports/push-device-repository.js";

export class PushDeviceService {
  constructor(private readonly devices: PushDeviceRepository) {}

  registerToken(
    userId: string,
    input: { token: string; platform: PushPlatform },
  ) {
    return this.devices.upsertToken({
      userId,
      token: input.token,
      platform: input.platform,
    });
  }

  async unregisterToken(userId: string, token: string): Promise<void> {
    const removed = await this.devices.removeToken({ userId, token });
    if (!removed) {
      throw new AppError("NOT_FOUND", "Push device not found", 404);
    }
  }
}
