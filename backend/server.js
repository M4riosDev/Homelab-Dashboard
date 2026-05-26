const express = require("express");
const cors = require("cors");
const Docker = require("dockerode");
const si = require("systeminformation");

const app = express();
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

app.use(cors());
app.use(express.json());

app.get("/api/system", async (req, res) => {
  try {
    const [cpu, mem, disks, net, osInfo, time] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.osInfo(),
      si.time(),
    ]);

    res.json({
      hostname: osInfo.hostname,
      uptime: time.uptime,
      cpu: {
        percent: cpu.currentLoad,
        cores: cpu.cpus.length,
        model: (await si.cpu()).brand,
      },
      ram: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        available: mem.available,
      },
      disks: disks.map((d) => ({
        device: d.fs,
        mountpoint: d.mount,
        total: d.size,
        used: d.used,
        free: d.size - d.used,
        percent: d.use,
      })),
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
        let cpu_percent = 0,
          mem_usage = 0,
          mem_limit = 0;

        if (c.State === "running") {
          try {
            const stats = await container.stats({ stream: false });
            const cpuDelta =
              stats.cpu_stats.cpu_usage.total_usage -
              stats.precpu_stats.cpu_usage.total_usage;
            const systemDelta =
              stats.cpu_stats.system_cpu_usage -
              stats.precpu_stats.system_cpu_usage;
            const numCpus = stats.cpu_stats.online_cpus || 1;
            cpu_percent = (cpuDelta / systemDelta) * numCpus * 100;
            mem_usage = stats.memory_stats.usage || 0;
            mem_limit = stats.memory_stats.limit || 0;
          } catch (_) {}
        }

        const ports = (c.Ports || [])
          .filter((p) => p.PublicPort)
          .map((p) => ({ host: p.PublicPort, container: p.PrivatePort }));

        const createdDate = new Date(c.Created * 1000);
        const uptimeSec = c.State === "running"
          ? Math.floor((Date.now() - createdDate) / 1000) : 0;
        const d = Math.floor(uptimeSec / 86400);
        const h = Math.floor((uptimeSec % 86400) / 3600);

        return {
          id: c.Id,
          name: c.Names[0]?.replace("/", "") || c.Id.slice(0, 12),
          image: c.Image,
          status: c.Status,
          state: c.State,
          cpu_percent: Math.max(0, cpu_percent),
          mem_usage,
          mem_limit,
          ports,
          created: createdDate.toISOString().split("T")[0],
          uptime: c.State === "running"
            ? d > 0 ? `${d}d ${h}h` : `${h}h`
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
  const { id, action } = req.params;
  const container = docker.getContainer(id);

  try {
    switch (action) {
      case "start":
        await container.start();
        res.json({ ok: true });
        break;
      case "stop":
        await container.stop();
        res.json({ ok: true });
        break;
      case "restart":
        await container.restart();
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
          tail: 200,
          timestamps: true,
        });
        const clean = logs
          .toString("utf8")
          .replace(/[\x00-\x08\x0e-\x1f]/g, "")
          .trim();
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server dashboard backend running on :${PORT}`);
  console.log(`Docker socket: /var/run/docker.sock`);
});
