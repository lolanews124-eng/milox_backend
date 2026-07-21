import { describe, expect, it } from "vitest";

import { buildPushNotificationMessage } from "../src/modules/push/application/push-notification-builder.js";

describe("buildPushNotificationMessage", () => {
  it("builds a chat push with conversation routing data", () => {
    const message = buildPushNotificationMessage({
      id: "notification-id",
      type: "NEW_MESSAGE",
      actor: {
        username: "riya",
        displayName: "Riya",
      },
      payload: {
        conversationId: "conversation-id",
        messageId: "message-id",
      },
    });

    expect(message.title).toBe("Riya");
    expect(message.body).toBe("Riya sent you a message");
    expect(message.data).toEqual(
      expect.objectContaining({
        type: "NEW_MESSAGE",
        notificationId: "notification-id",
        conversationId: "conversation-id",
        actorUsername: "riya",
      }),
    );
  });

  it("builds a like push without conversation data", () => {
    const message = buildPushNotificationMessage({
      id: "like-id",
      type: "NEW_LIKE",
      actor: {
        username: "alex",
        displayName: null,
      },
      payload: { postId: "post-id" },
    });

    expect(message.title).toBe("Milox");
    expect(message.body).toBe("alex liked your post");
    expect(message.data.conversationId).toBeUndefined();
  });
});
