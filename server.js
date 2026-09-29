const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { startWorker } = require("./worker");

const app = express();
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./swagger.json");
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
const prisma = new PrismaClient();
app.use(express.json());

app.post("/events", async (req, res) => {
  const { customer_id, payload } = req.body;

  if (!customer_id || !payload) {
    return res
      .status(400)
      .json({ error: "customer_id and payload are required" });
  }

  const event = await prisma.event.create({
    data: {
      customer_id,
      data: JSON.stringify(payload),
    },
  });

  return res.status(202).json({ id: event.id });
});

app.get("/events/:id", async (req, res) => {
  const event = await prisma.event.findUnique({
    where: { id: req.params.id },
  });

  if (!event) {
    return res.status(404).json({ error: "Event not found" });
  }

  return res.json({
    id: event.id,
    status: event.status,
    retry_count: event.retry_count,
  });
});

app.post("/mock-success", (req, res) =>
  res.status(200).json({ message: "OK" }),
);
app.post("/mock-fail", (req, res) =>
  res.status(500).json({ error: "Internal Server Error" }),
);
app.post("/mock-timeout", (req, res) => {
  setTimeout(() => res.status(200).json({ message: "Too Late" }), 15000);
});

let unstableTry = 0;
app.post("/mock-unstable", (req, res) => {
  unstableTry++;
  if (unstableTry <= 2) {
    return res.status(500).json({ error: "Server down." });
  } else {
    //reset nilai untuk simulasi unstable
    unstableTry = 0;
    return res.status(200).json({ message: "Server kembali hidup." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
  console.log(`Memulai worker....`);
  startWorker();
});
