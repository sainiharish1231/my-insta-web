type ShortsStreamEvent =
  | {
      type: "ready";
      [key: string]: unknown;
    }
  | {
      type: "clip-progress";
      [key: string]: unknown;
    }
  | {
      type: "clip";
      [key: string]: unknown;
    }
  | {
      type: "complete";
      [key: string]: unknown;
    }
  | {
      type: "error";
      error: string;
    };

export function createShortsStreamResponse(
  producer: (emit: (event: ShortsStreamEvent) => Promise<void>) => Promise<void>,
) {
  const encoder = new TextEncoder();
  let closeStream: () => void = () => {};

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const heartbeat = setInterval(() => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode("\n"));
        } catch {
          closed = true;
          clearInterval(heartbeat);
        }
      }, 15_000);

      const closeController = () => {
        if (closed) {
          return;
        }

        closed = true;
        clearInterval(heartbeat);

        try {
          controller.close();
        } catch {
          // Client disconnected or stream already closed.
        }
      };
      closeStream = closeController;

      const emit = async (event: ShortsStreamEvent) => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closeController();
        }
      };

      void (async () => {
        try {
          await producer(emit);
        } catch (error: any) {
          console.error("[v0] Shorts stream failed:", error);
          await emit({
            type: "error",
            error: error?.message || "Shorts stream failed.",
          });
        } finally {
          closeController();
        }
      })();
    },
    cancel() {
      closeStream();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
