import type { Request, Response } from "express";

import { AppError } from "../../../shared/errors/app-error.js";
import type { PushDeviceService } from "../application/services/push-device-service.js";
import {
  deletePushDeviceSchema,
  upsertPushDeviceSchema,
} from "./push-device-schemas.js";

export class PushDeviceController {
  constructor(private readonly devices: PushDeviceService) {}

  upsert = async (request: Request, response: Response): Promise<void> => {
    const input = upsertPushDeviceSchema.parse(request.body);
    const device = await this.devices.registerToken(requireUser(request), {
      token: input.token,
      platform: input.platform,
    });
    response.status(200).json({
      success: true,
      data: {
        id: device.id,
        platform: device.platform,
      },
      meta: { requestId: request.requestId },
    });
  };

  remove = async (request: Request, response: Response): Promise<void> => {
    const input = deletePushDeviceSchema.parse(request.body);
    await this.devices.unregisterToken(requireUser(request), input.token);
    response.status(204).send();
  };
}

function requireUser(request: Request): string {
  if (!request.auth) {
    throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
  }
  return request.auth.userId;
}
