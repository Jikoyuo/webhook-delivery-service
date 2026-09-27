const { PrismaClient } = require("@prisma/client");
const axios = require("axios");

const prisma = new PrismaClient();

const registeredEndpoints = {
  "cust-001": "http://localhost:3000/mock-success",
  "cust-002": "http://localhost:3000/mock-fail",
  "cust-003": "http://localhost:3000/mock-timeout",
  "cust-004": "http://localhost:3000/mock-unstable",
};

const getNextRetryAt = (retryCount) => {
  const now = new Date();
  // const delaysInMinutes = [1, 5, 30, 120, 360];
  const delaysInMinutes = [0, 1, 2, 3, 4];
  const delay = delaysInMinutes[retryCount] || 0;
  return new Date(now.getTime() + delay * 60000);
};

const startWorker = async () => {
  try {
    const events = await prisma.event.findMany({
      where: {
        status: "pending",
        next_retry_at: { lte: new Date() },
      },
      orderBy: { next_retry_at: "asc" },
      take: 50,
    });

    if (events.length === 0) {
      return;
    }

    console.log(
      `[Worker] Menemukan ${events.length} event. Mulai memproses HTTP...`,
    );

    const results = await Promise.allSettled(
      events.map(async (event) => {
        const url = registeredEndpoints[event.customer_id];

        if (!url) {
          return { id: event.id, status: "failed", error: "URL not found" };
        }

        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch (err) {
          return {
            id: event.id,
            status: "failed",
            error: "Invalid JSON format",
          };
        }

        try {
          const response = await axios.post(url, payload, { timeout: 10000 });
          if (response.status >= 200 && response.status < 300) {
            return {
              id: event.id,
              status: "delivered",
              retry_count: event.retry_count,
            };
          }
          throw new Error(`HTTP Status ${response.status}`);
        } catch (error) {
          return {
            id: event.id,
            status: "retry",
            retry_count: event.retry_count,
            error: error.message,
          };
        }
      }),
    );

    const updateOperations = results.map((result) => {
      const data = result.value;

      if (data.status === "delivered") {
        return prisma.event.update({
          where: { id: data.id },
          data: { status: "delivered", last_retry_at: new Date() },
        });
      }

      if (data.status === "failed") {
        return prisma.event.update({
          where: { id: data.id },
          data: { status: "failed", last_retry_at: new Date() },
        });
      }

      const newRetryCount = data.retry_count + 1;
      const isPermanentFail = newRetryCount >= 5;

      return prisma.event.update({
        where: { id: data.id },
        data: {
          status: isPermanentFail ? "failed" : "pending",
          retry_count: newRetryCount,
          last_retry_at: new Date(),
          ...(isPermanentFail
            ? {}
            : { next_retry_at: getNextRetryAt(newRetryCount) }),
        },
      });
    });

    await prisma.$transaction(updateOperations);
    console.log(`[Worker] Berhasil update ${events.length} event.`);
  } catch (error) {
    console.error("[Worker] Fatal Error:", error);
  } finally {
    setTimeout(startWorker, 5000);
  }
};

module.exports = { startWorker };
