import type { Response } from "express";

/**
 * Send a file and resolve once the transfer finishes.
 * Errors after the response has started (client abort, connection reset)
 * are logged and do not reject, so the caller does not forward a second
 * response through the global error handler.
 * Errors before headers are sent are returned to the caller.
 */
export function sendDownload(
  response: Response,
  absolutePath: string,
): Promise<Error | null> {
  return new Promise((resolve) => {
    response.sendFile(absolutePath, (error) => {
      if (!error) {
        resolve(null);
        return;
      }
      if (response.headersSent) {
        console.error("File response failed after headers were sent", {
          message: error.message,
        });
        resolve(null);
        return;
      }
      resolve(error);
    });
  });
}
