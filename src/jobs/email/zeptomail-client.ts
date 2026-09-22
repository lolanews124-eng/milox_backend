export type ZeptoMailTransport = {
  apiUrl: string;
  apiToken: string;
  fromAddress: string;
  fromName: string;
  bounceAddress?: string;
};

export type ZeptoMailMessage = {
  toEmail: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Sends mail via ZeptoMail HTTP API (India endpoint).
 * Credentials come from admin Email settings (not .env).
 */
export async function sendViaZeptoMail(
  transport: ZeptoMailTransport,
  message: ZeptoMailMessage,
): Promise<void> {
  const token = transport.apiToken.trim();
  if (!token) {
    throw new Error("ZeptoMail API token is not configured in admin");
  }

  const authHeader = token.startsWith("Zoho-enczapikey")
    ? token
    : `Zoho-enczapikey ${token}`;

  const fromAddress = transport.fromAddress.trim();
  if (!fromAddress) {
    throw new Error("From address is not configured in admin");
  }

  const payload: Record<string, unknown> = {
    from: {
      address: fromAddress,
      name: transport.fromName.trim() || "Milox",
    },
    to: [
      {
        email_address: {
          address: message.toEmail,
          name: message.toName || message.toEmail.split("@")[0] || "Member",
        },
      },
    ],
    subject: message.subject,
    htmlbody: message.html,
    textbody: message.text,
  };

  if (transport.bounceAddress?.trim()) {
    payload.bounce_address = transport.bounceAddress.trim();
  }

  const response = await fetch(transport.apiUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `ZeptoMail send failed (${response.status}): ${body.slice(0, 500)}`,
    );
  }
}
