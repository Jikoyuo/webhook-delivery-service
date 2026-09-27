const { PrismaClient } = require("@prisma/client");
const axios = require("axios");

const prisma = new PrismaClient();

const registeredEndpoints = {
  "cust-001": "http://localhost:3000/mock-success",
  "cust-002": "http://localhost:3000/mock-fail",
  "cust-003": "http://localhost:3000/mock-timeout",
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

    console.log(`[Worker] Memproses ${events.length} event...`);

    await Promise.allSettled(
      events.map(async (event) => {
        const url = registeredEndpoints[event.customer_id];

        if (!url) {
          await prisma.event.update({
            where: { id: event.id },
            data: { status: "failed" },
          });
          return;
        }

        try {
          const payload = JSON.parse(event.data);
          const response = await axios.post(url, payload, { timeout: 10000 });

          if (response.status >= 200 && response.status < 300) {
            await prisma.event.update({
              where: { id: event.id },
              data: { status: "delivered", last_retry_at: new Date() },
            });
            console.log(`[Worker] Sukses mengirim event ${event.id}`);
          } else {
            throw new Error(`HTTP Status ${response.status}`);
          }
        } catch (error) {
          const newRetryCount = event.retry_count + 1;
          console.log(
            `[Worker] Gagal mengirim event ${event.id}. Retry ke-${newRetryCount}`,
          );

          if (newRetryCount >= 5) {
            await prisma.event.update({
              where: { id: event.id },
              data: { status: "failed", last_retry_at: new Date() },
            });
          } else {
            await prisma.event.update({
              where: { id: event.id },
              data: {
                retry_count: newRetryCount,
                next_retry_at: getNextRetryAt(newRetryCount),
                last_retry_at: new Date(),
              },
            });
          }
        }
      }),
    );
  } catch (error) {
    console.error("[Worker] Fatal Error:", error);
  } finally {
    setTimeout(startWorker, 5000);
  }
};

module.exports = { startWorker };
