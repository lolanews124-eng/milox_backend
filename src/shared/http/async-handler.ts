import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";

type AsyncHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => Promise<void>;

export function asyncHandler(handler: AsyncHandler): RequestHandler {
  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}
