const express = require("express");
const cors = require("cors");
const Docker = require("dockerode");
const si = require("systeminformation");
const os = require("os");

const app = express();
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

app.use(cors());
app.use(express.json());

const actionRateMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60_000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = actionRateMap.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_WINDOW;
  }
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

const SKIP_MOUNTS = [
  "/etc/resolv.conf", "/etc/hostname", "/etc/hosts",
  "/proc", "/sys", "/dev", "/run", "/snap",
];
const isRealDisk = (d) =>
  !SKIP_MOUNTS.some((m) => d.mount.startsWith(m)) &&
  !d.fs.startsWith("tmpfs") &&
  !d.fs.startsWith("udev") &&
  !d.fs.startsWith("overlay") &&
  d.size > 0;


async function getContainerStats(container, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    container.stats({ stream: false })
      .then((s) => { clearTimeout(timer); resolve(s); })
      .catch(() => { clearTimeout(timer); resolve(null); });
  });
}


app.get("/api/system", async (req, res) => {
  try {
    const [cpu, mem, disks, net, osInfo, time, cpuInfo] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.osInfo(),
      si.time(),
      si.cpu(),
    ]);

    let hostname = process.env.NODE_NAME || process.env.HOST_HOSTNAME || "";
    if (!hostname) {
      try {
        const fs = require("fs");
        const h = fs.readFileSync("/proc/sys/kernel/hostname", "utf8").trim();
        if (h) hostname = h;
      } catch (_) {}
    }
    if (!hostname) hostname = os.hostname();

    const realDisks = disks.filter(isRealDisk).reduce((acc, d) => {
      if (!acc.find((x) => x.device === d.fs)) {
        acc.push({
          device: d.fs,
          mountpoint: d.mount,
          total: d.size,
          used: d.used,
          free: d.size - d.used,
          percent: d.use,
        });
      }
      return acc;
    }, []);

    res.json({
      hostname,
      uptime: time.uptime,
      cpu: {
        percent: cpu.currentLoad,
        cores: cpuInfo.physicalCores || cpu.cpus.length,
        model: cpuInfo.brand,
      },
      ram: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        available: mem.available,
      },
      disks: realDisks,
      network: net.reduce(
        (acc, n) => ({
          rx_bytes: acc.rx_bytes + n.rx_bytes,
          tx_bytes: acc.tx_bytes + n.tx_bytes,
          rx_sec: acc.rx_sec + (n.rx_sec || 0),
          tx_sec: acc.tx_sec + (n.tx_sec || 0),
        }),
        { rx_bytes: 0, tx_bytes: 0, rx_sec: 0, tx_sec: 0 }
      ),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/docker", async (req, res) => {
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
              const cpuDelta =
                stats.cpu_stats.cpu_usage.total_usage -
                stats.precpu_stats.cpu_usage.total_usage;
              const systemDelta =
                stats.cpu_stats.system_cpu_usage -
                stats.precpu_stats.system_cpu_usage;
              const numCpus = stats.cpu_stats.online_cpus || 1;
              if (systemDelta > 0) {
                cpu_percent = (cpuDelta / systemDelta) * numCpus * 100;
              }
              mem_usage = stats.memory_stats.usage - (stats.memory_stats.stats?.cache || 0);
              mem_limit = stats.memory_stats.limit || 0;
            } catch (_) {}
          }
        }

        let uptimeSec = 0;
        if (c.State === "running") {
          try {
            const info = await container.inspect();
            const startedAt = new Date(info.State.StartedAt);
            uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
          } catch (_) {
            uptimeSec = Math.floor((Date.now() - c.Created * 1000) / 1000);
          }
        }

        const d = Math.floor(uptimeSec / 86400);
        const h = Math.floor((uptimeSec % 86400) / 3600);
        const m = Math.floor((uptimeSec % 3600) / 60);

        const ports = (c.Ports || [])
          .filter((p) => p.PublicPort)
          .map((p) => ({ host: p.PublicPort, container: p.PrivatePort, type: p.Type }));

        const createdDate = new Date(c.Created * 1000);
        const rawName = c.Names[0]?.replace(/^\//, "") || c.Id.slice(0, 12);

        return {
          id: c.Id,
          name: rawName,
          image: c.Image,
          status: c.Status,
          state: c.State,
          cpu_percent: Math.max(0, cpu_percent),
          mem_usage: Math.max(0, mem_usage),
          mem_limit,
          ports,
          created: createdDate.toISOString().split("T")[0],
          uptime: c.State === "running"
            ? d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
            : "—",
        };
      })
    );

    res.json(withStats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/:id/:action", async (req, res) => {
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({ error: "Too many requests — slow down." });
  }

  const { id, action } = req.params;
  const container = docker.getContainer(id);

  try {
    switch (action) {
      case "start":
        await container.start();
        await new Promise(r => setTimeout(r, 1500));
        res.json({ ok: true });
        break;
      case "stop":
        await container.stop({ t: 10 });
        await new Promise(r => setTimeout(r, 1500));
        res.json({ ok: true });
        break;
      case "restart":
        await container.restart({ t: 10 });
        await new Promise(r => setTimeout(r, 2000));
        res.json({ ok: true });
        break;
      case "pause":
        await container.pause();
        res.json({ ok: true });
        break;
      case "unpause":
        await container.unpause();
        res.json({ ok: true });
        break;
      case "remove":
        await container.remove({ force: false });
        res.json({ ok: true });
        break;
      case "logs": {
        const logs = await container.logs({
          stdout: true,
          stderr: true,
          tail: 300,
          timestamps: true,
        });
        const clean = logs
          .toString("utf8")
          .split("\n")
          .map(line => line.replace(/^[\x00-\x08\x0e-\x1f]{1,8}/, "").trimEnd())
          .filter(Boolean)
          .join("\n");
        res.json({ logs: clean });
        break;
      }
      case "inspect": {
        const info = await container.inspect();
        res.json(info);
        break;
      }
      default:
        res.status(400).json({ error: "Unknown action" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/logs/system", async (req, res) => {
  try {
    const { execSync } = require("child_process");
    let logs = "";
    try {
      logs = execSync(
        "journalctl -n 200 --no-pager -o short-iso 2>/dev/null || tail -200 /var/log/syslog 2>/dev/null || echo 'No system logs available'",
        { timeout: 5000 }
      ).toString();
    } catch (_) {
      logs = "Cannot read system logs — permission denied.";
    }
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/logs/docker", async (req, res) => {
  try {
    const { execSync } = require("child_process");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let out = "";
    try {
      out = execSync(
        `docker events --since "${since}" --format '{{.Time}} [{{.Type}}] {{.Action}} → {{.Actor.Attributes.name}}' 2>/dev/null | tail -150`,
        { timeout: 8000, shell: true }
      ).toString().trim();
    } catch (_) {
      out = "";
    }
    res.json({ logs: out || "No Docker events in the last 24h" });
  } catch (err) {
    res.json({ logs: "No Docker events available" });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Dashboard backend running on :${PORT}`);
});
