const express = require("express");
const cors = require("cors");
const Docker = require("dockerode");
const si = require("systeminformation");
const os = require("os");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

app.use(cors());
app.use(express.json());

// ─── Auth config ────────────────────────────────────────────────────────────

const USERS_FILE = process.env.USERS_FILE || "/data/users.json";
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production-use-a-long-random-string";
const JWT_EXPIRES = "24h";

let users = [];
try {
  if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  }
} catch (_) {}

function saveUsers() {
  try {
    fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (_) {}
}

// Auth middleware
function requireAuth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ─── Auth routes ───────────────────────────────────────────────────

app.post("/api/auth/register", async (req, res) => {
  const { name, username, password } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: "Name, username and password are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  if (users.find(u => u.username === username)) {
    return res.status(409).json({ error: "Username already taken" });
  }
  const hash = await bcrypt.hash(password, 10);
  const user = { id: Date.now().toString(), name, username, hash };
  users.push(user);
  saveUsers();
  const token = jwt.sign({ id: user.id, name: user.name, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ token, user: { id: user.id, name: user.name, username: user.username } });
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: "Invalid username or password" });
  const ok = await bcrypt.compare(password, user.hash);
  if (!ok) return res.status(401).json({ error: "Invalid username or password" });
  const token = jwt.sign({ id: user.id, name: user.name, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ token, user: { id: user.id, name: user.name, username: user.username } });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ─── Rate limiting ──────────────────────────────────────────────────────────

const actionRateMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60_000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = actionRateMap.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + RATE_WINDOW; }
  entry.count++;
  actionRateMap.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of actionRateMap) {
    if (now > entry.resetAt) actionRateMap.delete(ip);
  }
}, 5 * 60_000);

// ─── CPU history ────────────────────────────────────────────────────────────

const CPU_HISTORY_MAX = 180;
const cpuHistory = [];

async function sampleCpu() {
  try {
    const load = await si.currentLoad();
    cpuHistory.push({ t: Date.now(), v: Math.round(load.currentLoad) });
    if (cpuHistory.length > CPU_HISTORY_MAX) cpuHistory.shift();
  } catch (_) {}
}

sampleCpu();
setInterval(sampleCpu, 5000);

// ─── Helpers ────────────────────────────────────────────────────────────────

const SKIP_MOUNTS = ["/etc/resolv.conf", "/etc/hostname", "/etc/hosts", "/proc", "/sys", "/dev", "/run", "/snap"];
const isRealDisk = (d) =>
  !SKIP_MOUNTS.some((m) => d.mount.startsWith(m)) &&
  !d.fs.startsWith("tmpfs") && !d.fs.startsWith("udev") && !d.fs.startsWith("overlay") &&
  d.size > 0;

async function getContainerStats(container, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    container.stats({ stream: false })
      .then((s) => { clearTimeout(timer); resolve(s); })
      .catch(() => { clearTimeout(timer); resolve(null); });
  });
}

// ─── Protected API routes ────────────────────────────────────────────────────

app.get("/api/cpu-history", requireAuth, (req, res) => {
  res.json(cpuHistory);
});

app.get("/api/system", requireAuth, async (req, res) => {
  try {
    const [cpu, mem, disks, net, osInfo, time, cpuInfo] = await Promise.all([
      si.currentLoad(), si.mem(), si.fsSize(), si.networkStats(), si.osInfo(), si.time(), si.cpu(),
    ]);

    let hostname = process.env.NODE_NAME || process.env.HOST_HOSTNAME || "";
    if (!hostname) {
      try { const h = fs.readFileSync("/proc/sys/kernel/hostname", "utf8").trim(); if (h) hostname = h; } catch (_) {}
    }
    if (!hostname) hostname = os.hostname();

    const realDisks = disks.filter(isRealDisk).reduce((acc, d) => {
      if (!acc.find((x) => x.device === d.fs)) {
        acc.push({ device: d.fs, mountpoint: d.mount, total: d.size, used: d.used, free: d.size - d.used, percent: d.use });
      }
      return acc;
    }, []);

    res.json({
      hostname, uptime: time.uptime,
      cpu: {
        percent: cpu.currentLoad,
        cores: cpuInfo.physicalCores || cpu.cpus.length,
        model: cpuInfo.brand,
        perCore: cpu.cpus.map(c => Math.round(c.load)),
      },
      ram: { total: mem.total, used: mem.total - mem.available, free: mem.free, available: mem.available },
      disks: realDisks,
      network: net.reduce(
        (acc, n) => ({ rx_bytes: acc.rx_bytes + n.rx_bytes, tx_bytes: acc.tx_bytes + n.tx_bytes, rx_sec: acc.rx_sec + (n.rx_sec || 0), tx_sec: acc.tx_sec + (n.tx_sec || 0) }),
        { rx_bytes: 0, tx_bytes: 0, rx_sec: 0, tx_sec: 0 }
      ),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/docker", requireAuth, async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });
    const withStats = await Promise.all(
      containers.map(async (c) => {
        const container = docker.getContainer(c.Id);
        let cpu_percent = 0, mem_usage = 0, mem_limit = 0;
        if (c.State === "running") {
          const stats = await getContainerStats(container, 8000);
          if (stats) {
            try {
              const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
              const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
              const numCpus = stats.cpu_stats.online_cpus || 1;
              if (systemDelta > 0) cpu_percent = (cpuDelta / systemDelta) * numCpus * 100;
              mem_usage = stats.memory_stats.usage - (stats.memory_stats.stats?.cache || 0);
              mem_limit = stats.memory_stats.limit || 0;
            } catch (_) {}
          }
        }
        let uptimeSec = 0;
        if (c.State === "running") {
          try {
            const info = await container.inspect();
            uptimeSec = Math.floor((Date.now() - new Date(info.State.StartedAt)) / 1000);
          } catch (_) {
            uptimeSec = Math.floor((Date.now() - c.Created * 1000) / 1000);
          }
        }
        const d = Math.floor(uptimeSec / 86400), h = Math.floor((uptimeSec % 86400) / 3600), m = Math.floor((uptimeSec % 3600) / 60);
        const ports = (c.Ports || []).filter((p) => p.PublicPort).map((p) => ({ host: p.PublicPort, container: p.PrivatePort, type: p.Type }));
        return {
          id: c.Id, name: c.Names[0]?.replace(/^\//, "") || c.Id.slice(0, 12),
          image: c.Image, status: c.Status, state: c.State,
          cpu_percent: Math.max(0, cpu_percent), mem_usage: Math.max(0, mem_usage), mem_limit, ports,
          created: new Date(c.Created * 1000).toISOString().split("T")[0],
          uptime: c.State === "running" ? d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m` : "—",
        };
      })
    );
    res.json(withStats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/:id/:action", requireAuth, async (req, res) => {
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
  if (!checkRateLimit(clientIp)) return res.status(429).json({ error: "Too many requests — slow down." });

  const { id, action } = req.params;
  const container = docker.getContainer(id);

  try {
    switch (action) {
      case "start": await container.start(); await new Promise(r => setTimeout(r, 1500)); res.json({ ok: true }); break;
      case "stop": await container.stop({ t: 10 }); await new Promise(r => setTimeout(r, 1500)); res.json({ ok: true }); break;
      case "restart": await container.restart({ t: 10 }); await new Promise(r => setTimeout(r, 2000)); res.json({ ok: true }); break;
      case "pause": await container.pause(); res.json({ ok: true }); break;
      case "unpause": await container.unpause(); res.json({ ok: true }); break;
      case "remove": await container.remove({ force: false }); res.json({ ok: true }); break;
      case "logs": {
        const logs = await container.logs({ stdout: true, stderr: true, tail: 300, timestamps: true });
        const clean = logs.toString("utf8").split("\n").map(l => l.replace(/^[\x00-\x08\x0e-\x1f]{1,8}/, "").trimEnd()).filter(Boolean).join("\n");
        res.json({ logs: clean }); break;
      }
      case "inspect": res.json(await container.inspect()); break;
      default: res.status(400).json({ error: "Unknown action" });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/logs/system", requireAuth, async (req, res) => {
  try {
    const { execSync } = require("child_process");
    let logs = "";
    try {
      logs = execSync("journalctl -n 200 --no-pager -o short-iso 2>/dev/null || tail -200 /var/log/syslog 2>/dev/null || echo 'No system logs available'", { timeout: 5000 }).toString();
    } catch (_) { logs = "Cannot read system logs — permission denied."; }
    res.json({ logs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/logs/docker", requireAuth, async (req, res) => {
  try {
    const { execSync } = require("child_process");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let out = "";
    try {
      out = execSync(`docker events --since "${since}" --format '{{.Time}} [{{.Type}}] {{.Action}} → {{.Actor.Attributes.name}}' 2>/dev/null | tail -150`, { timeout: 8000, shell: true }).toString().trim();
    } catch (_) { out = ""; }
    res.json({ logs: out || "No Docker events in the last 24h" });
  } catch (err) { res.json({ logs: "No Docker events available" }); }
});

// ─── Shortcuts ───────────────────────────────────────────────────────────────

const SHORTCUTS_FILE = process.env.SHORTCUTS_FILE || "/data/shortcuts.json";
let shortcuts = [];
try {
  if (fs.existsSync(SHORTCUTS_FILE)) shortcuts = JSON.parse(fs.readFileSync(SHORTCUTS_FILE, "utf8"));
} catch (_) {}

function saveShortcuts() {
  try {
    fs.mkdirSync(path.dirname(SHORTCUTS_FILE), { recursive: true });
    fs.writeFileSync(SHORTCUTS_FILE, JSON.stringify(shortcuts, null, 2));
  } catch (_) {}
}

app.get("/api/shortcuts", requireAuth, (req, res) => res.json(shortcuts));
app.post("/api/shortcuts", requireAuth, (req, res) => {
  const sc = req.body;
  if (!sc || !sc.cmd) return res.status(400).json({ error: "Missing cmd" });
  shortcuts.push(sc);
  saveShortcuts();
  res.json(shortcuts);
});
app.delete("/api/shortcuts/:id", requireAuth, (req, res) => {
  shortcuts = shortcuts.filter(s => String(s.id) !== String(req.params.id));
  saveShortcuts();
  res.json(shortcuts);
});
app.post("/api/shortcuts/:id/run", requireAuth, async (req, res) => {
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
  if (!checkRateLimit(clientIp)) return res.status(429).json({ error: "Too many requests — slow down." });
  const sc = shortcuts.find(s => String(s.id) === String(req.params.id));
  if (!sc) return res.status(404).json({ error: "Shortcut not found" });
  const { exec } = require("child_process");
  exec(sc.cmd, { timeout: 60000, shell: true }, (err, stdout, stderr) => {
    res.json({ output: (stdout + stderr).trim() || (err?.message || "Done") });
  });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => console.log(`Dashboard backend running on :${PORT}`));