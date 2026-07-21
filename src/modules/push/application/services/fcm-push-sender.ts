import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import admin from "firebase-admin";

import type { AppConfig } from "../../../../config/env.js";
import {
  buildPushNotificationMessage,
  type PushNotificationMessage,
} from "../push-notification-builder.js";
import type { PushDeviceRepository } from "../ports/push-device-repository.js";

export interface PushSender {
  isEnabled(): boolean;
  sendForNotification(recipientId: string, notification: object): Promise<void>;
}

const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

export class FcmPushSender implements PushSender {
  private messaging: admin.messaging.Messaging | null | undefined;

  constructor(
    private readonly devices: PushDeviceRepository,
    private readonly config: AppConfig,
  ) {}

  isEnabled(): boolean {
    return this.getMessaging() !== null;
  }

  async sendForNotification(
    recipientId: string,
    notification: object,
  ): Promise<void> {
    const messaging = this.getMessaging();
    if (!messaging) return;

    const tokens = await this.devices.listTokensForUser(recipientId);
    if (tokens.length === 0) return;

    const message = buildPushNotificationMessage(
      notification as Parameters<typeof buildPushNotificationMessage>[0],
    );
    await this.sendMulticast(messaging, tokens, message);
  }

  private getMessaging(): admin.messaging.Messaging | null {
    if (this.messaging !== undefined) {
      return this.messaging;
    }

    const credentialsPath = this.config.GOOGLE_APPLICATION_CREDENTIALS.trim();
    if (!credentialsPath) {
      this.messaging = null;
      return this.messaging;
    }

    const absolutePath = resolve(credentialsPath);
    if (!existsSync(absolutePath)) {
      console.warn(
        `Push notifications disabled: credentials file not found at ${absolutePath}`,
      );
      this.messaging = null;
      return this.messaging;
    }

    try {
      if (admin.apps.length === 0) {
        const serviceAccount = JSON.parse(
          readFileSync(absolutePath, "utf8"),
        ) as admin.ServiceAccount;
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      }
      this.messaging = admin.messaging();
    } catch (error) {
      console.error("Push notifications disabled: Firebase init failed", error);
      this.messaging = null;
    }

    return this.messaging;
  }

  private async sendMulticast(
    messaging: admin.messaging.Messaging,
    tokens: string[],
    message: PushNotificationMessage,
  ): Promise<void> {
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: message.title,
        body: message.body,
      },
      data: message.data,
      android: {
        priority: "high",
        notification: {
          channelId: "milox_alerts",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    });

    const invalidTokens = response.responses.flatMap((entry, index) => {
      const code = entry.error?.code;
      if (code && INVALID_TOKEN_CODES.has(code)) {
        return [tokens[index]!];
      }
      return [];
    });

    if (invalidTokens.length > 0) {
      await this.devices.removeTokens(invalidTokens);
    }
  }
}

export class NoOpPushSender implements PushSender {
  isEnabled(): boolean {
    return false;
  }

  sendForNotification(): Promise<void> {
    return Promise.resolve();
  }
}

export function createPushSender(
  devices: PushDeviceRepository,
  config: AppConfig,
): PushSender {
  return new FcmPushSender(devices, config);
}
