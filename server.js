require("dotenv").config();
console.log("JWT_SECRET exists:", !!process.env.JWT_SECRET);
console.log("JWT_SECRET value:", process.env.JWT_SECRET ? "Loaded" : "Missing");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const todoRoutes = require("./routes/todoRoutes");
const authRoutes = require("./routes/authRoutes");
const chatRoutes = require("./routes/chatRoutes");

const app = express();

// Middleware
app.use(
  cors({
    origin: "https://todo-frontend-coral-chi.vercel.app",
    credentials: true,
  })
);

app.use(express.json());

// Log incoming requests (optional, useful for debugging)
app.use((req, res, next) => {
  console.log(
    `Incoming request: ${req.method} ${req.path} | Origin: ${req.headers.origin}`
  );
  next();
});

// Routes
app.use("/api/todos", todoRoutes);
app.use("/api/users", authRoutes);
app.use("/api/chat", chatRoutes);

// Health check route (optional but recommended)
app.get("/", (req, res) => {
  res.json({
    message: "Todo Backend API is running 🚀",
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
  });
});

// Start server
const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected");

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
  });
console.log("JWT_SECRET exists:", !!process.env.JWT_SECRET);