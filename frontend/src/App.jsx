import { useState, useEffect, useCallback, useRef } from "react";

const API_BASE = "";
const CPU_HISTORY_MAX = 180;

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function getToken() { return localStorage.getItem("hl_token"); }
function setToken(t) { localStorage.setItem("hl_token", t); }
function clearToken() { localStorage.removeItem("hl_token"); }

async function authFetch(url, opts = {}) {
  const token = getToken();
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: opts.body,
  });
  if (res.status === 401) {
    clearToken();
    window.location.reload();
  }
  return res;
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────

function AuthScreen({ onAuth }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError("");
    if (!username.trim() || !password.trim()) { setError("Username and password are required"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Invalid username or password"); return; }
      setToken(json.token);
      onAuth(json.user);
    } catch {
      setError("Cannot connect to backend");
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => { if (e.key === "Enter") submit(); };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-sans)", padding: "1rem",
      background: "var(--color-background-secondary)",
    }}>
      <div style={{
        width: "100%", maxWidth: 340,
        background: "var(--color-background-primary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "var(--border-radius-lg)",
        padding: "2rem",
      }}>
        <div style={{ marginBottom: "1.75rem" }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Homelab Dashboard</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>Sign in to continue</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Username</label>
            <input
              placeholder="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={handleKey}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Password</label>
            <div style={{ position: "relative" }}>
              <input
                type={showPw ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={handleKey}
                style={{ width: "100%", paddingRight: 40, boxSizing: "border-box" }}
              />
              <button onClick={() => setShowPw(s => !s)}
                style={{
                  position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                  border: "none", background: "transparent", cursor: "pointer",
                  color: "var(--color-text-secondary)", fontSize: 15, padding: 0, lineHeight: 1,
                }}>
                <i className={`ti ${showPw ? "ti-eye-off" : "ti-eye"}`} />
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div style={{
            marginTop: "0.75rem", padding: "8px 12px", borderRadius: "var(--border-radius-md)",
            background: "var(--color-background-danger)", color: "var(--color-text-danger)", fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={loading}
          style={{
            marginTop: "1.25rem", width: "100%", padding: "9px 0",
            background: "var(--accent)", color: "#fff", border: "none",
            borderRadius: "var(--border-radius-md)", fontWeight: 500, fontSize: 14,
            cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
          {loading && <i className="ti ti-loader" style={{ fontSize: 14 }} />}
          Sign in
        </button>
      </div>
    </div>
  );
}

const useServerData = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [cpuHistory, setCpuHistory] = useState([]);

  useEffect(() => {
    authFetch(`${API_BASE}/api/cpu-history`)
      .then(r => r.json())
      .then(history => {
        if (Array.isArray(history) && history.length > 0) {
          setCpuHistory(history.map(p => p.v));
        }
      })
      .catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [sysRes, dockerRes] = await Promise.all([
        authFetch(`${API_BASE}/api/system`),
        authFetch(`${API_BASE}/api/docker`),
      ]);
      const sys = await sysRes.json();
      const docker = await dockerRes.json();
      setData({ system: sys, containers: Array.isArray(docker) ? docker : [] });
      setLastUpdated(new Date());
      setError(null);
      setCpuHistory(prev => {
        const next = [...prev, Math.round(sys.cpu?.percent ?? 0)];
        return next.length > CPU_HISTORY_MAX ? next.slice(-CPU_HISTORY_MAX) : next;
      });
    } catch (e) {
      setError("Cannot connect to backend — showing demo data");
      setData(d => d || getMockData());
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return { data, loading, error, refetch: fetchData, lastUpdated, cpuHistory };
};

const getMockData = () => ({
  system: {
    hostname: "homeserver",
    uptime: 1234567,
    cpu: { percent: 23, cores: 8, model: "Intel Core i7-9700K" },
    ram: { total: 32 * 1024 ** 3, used: 14.2 * 1024 ** 3, free: 17.8 * 1024 ** 3 },
    disks: [
      { device: "/dev/sda1", mountpoint: "/", total: 500 * 1024 ** 3, used: 212 * 1024 ** 3, free: 288 * 1024 ** 3, percent: 42 },
      { device: "/dev/sdb1", mountpoint: "/data", total: 2 * 1024 ** 4, used: 1.1 * 1024 ** 4, free: 0.9 * 1024 ** 4, percent: 55 },
    ],
    network: { rx_bytes: 15.4 * 1024 ** 3, tx_bytes: 3.2 * 1024 ** 3 },
  },
  containers: [
    { id: "a1b2c3d4", name: "nginx-proxy", image: "nginx:alpine", status: "running", state: "running", cpu_percent: 0.3, mem_usage: 18 * 1024 ** 2, mem_limit: 256 * 1024 ** 2, ports: [{ host: 80, container: 80 }, { host: 443, container: 443 }], created: "2024-01-15", uptime: "12d 4h" },
    { id: "e5f6g7h8", name: "plex", image: "plexinc/pms-docker:latest", status: "running", state: "running", cpu_percent: 12.4, mem_usage: 512 * 1024 ** 2, mem_limit: 2 * 1024 ** 3, ports: [{ host: 32400, container: 32400 }], created: "2024-01-10", uptime: "17d 2h" },
    { id: "i9j0k1l2", name: "postgres", image: "postgres:15", status: "running", state: "running", cpu_percent: 1.8, mem_usage: 128 * 1024 ** 2, mem_limit: 512 * 1024 ** 2, ports: [{ host: 5432, container: 5432 }], created: "2024-01-08", uptime: "19d 6h" },
    { id: "m3n4o5p6", name: "nextcloud", image: "nextcloud:latest", status: "exited", state: "exited", cpu_percent: 0, mem_usage: 0, mem_limit: 1 * 1024 ** 3, ports: [], created: "2024-01-05", uptime: "—" },
    { id: "q7r8s9t0", name: "portainer", image: "portainer/portainer-ce:latest", status: "running", state: "running", cpu_percent: 0.1, mem_usage: 22 * 1024 ** 2, mem_limit: 128 * 1024 ** 2, ports: [{ host: 9000, container: 9000 }], created: "2024-01-01", uptime: "23d 1h" },
    { id: "u1v2w3x4", name: "redis", image: "redis:7-alpine", status: "running", state: "running", cpu_percent: 0.05, mem_usage: 8 * 1024 ** 2, mem_limit: 64 * 1024 ** 2, ports: [{ host: 6379, container: 6379 }], created: "2024-01-12", uptime: "14d 8h" },
  ],
});

const fmt = {
  bytes: (b) => {
    if (!b) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0, v = b;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  },
  uptime: (s) => {
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  },
  pct: (v) => `${Math.round(v)}%`,
};

const GaugeBar = ({ value, max, color = "var(--accent)" }) => {
  const pct = Math.min(100, (value / max) * 100);
  const clr = pct > 85 ? "#E24B4A" : pct > 65 ? "#EF9F27" : color;
  return (
    <div style={{ height: 6, background: "var(--color-border-tertiary)", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: clr, borderRadius: 3, transition: "width 0.6s ease" }} />
    </div>
  );
};

const CpuPerCore = ({ cores = [] }) => {
  if (!cores.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
      {cores.map((c, i) => {
        const pct = Math.min(100, Math.max(0, c));
        const color = pct > 85 ? "#E24B4A" : pct > 65 ? "#EF9F27" : "#4da3ff";
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, width: 34, color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>
              CPU{i}
            </span>
            <div style={{ flex: 1, height: 6, background: "var(--color-border-tertiary)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.3s ease" }} />
            </div>
            <span style={{ fontSize: 11, width: 40, textAlign: "right", color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>
              {pct.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
};

const CpuSparkline = ({ history }) => {
  if (!history || history.length < 2) return null;

  const W = 200;
  const H = 40;
  const PAD = 2;
  const max = 100;

  const pts = history.map((v, i) => {
    const x = PAD + (i / (history.length - 1)) * (W - PAD * 2);
    const y = H - PAD - (v / max) * (H - PAD * 2);
    return [x, y];
  });

  const points = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  const area = [
    `${PAD},${H}`,
    ...pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`),
    `${W - PAD},${H}`,
  ].join(" ");

  const last = history[history.length - 1];
  const color = last > 80 ? "#E24B4A" : last > 60 ? "#EF9F27" : "#4da3ff";
  const [lastX, lastY] = pts[pts.length - 1];

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: H, display: "block", overflow: "visible" }}
    >
      <defs>
        <linearGradient id="cpuAreaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
        <filter id="sparkGlow">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* subtle grid lines */}
      {[0.33, 0.66].map((f, i) => (
        <line key={i} x1={PAD} y1={H * f} x2={W - PAD} y2={H * f}
          stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3 4" />
      ))}

      {/* fill area */}
      <polygon points={area} fill="url(#cpuAreaFill)" style={{ transition: "all 200ms ease-out" }} />

      {/* glow line (thick, low opacity) */}
      <polyline points={points} fill="none" stroke={color} strokeWidth="5"
        opacity="0.15" strokeLinecap="round" strokeLinejoin="round"
        style={{ transition: "all 200ms ease-out" }} />

      {/* main line */}
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round"
        style={{ transition: "all 200ms ease-out" }} filter="url(#sparkGlow)" />

      {/* dot + halo at latest value */}
      <circle cx={lastX} cy={lastY} r="7" fill={color} opacity="0.18"
        style={{ transition: "all 200ms ease-out" }} />
      <circle cx={lastX} cy={lastY} r="3.5" fill={color}
        style={{ transition: "all 200ms ease-out" }} />
    </svg>
  );
};

const Badge = ({ state }) => {
  const cfg = {
    running: { bg: "var(--color-background-success)", color: "var(--color-text-success)", label: "running" },
    exited: { bg: "var(--color-background-danger)", color: "var(--color-text-danger)", label: "stopped" },
    paused: { bg: "var(--color-background-warning)", color: "var(--color-text-warning)", label: "paused" },
    restarting: { bg: "var(--color-background-warning)", color: "var(--color-text-warning)", label: "restarting" },
  };
  const c = cfg[state] || cfg.exited;
  return (
    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: c.bg, color: c.color, fontWeight: 500 }}>
      {c.label}
    </span>
  );
};

const ContainerCard = ({ c, onAction }) => {
  const [expanded, setExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const memPct = c.mem_limit ? (c.mem_usage / c.mem_limit) * 100 : 0;

  const handleAction = async (action) => {
    setActionLoading(action);
    await onAction(c.id, action, c.name);
    setActionLoading(null);
  };

  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      padding: "1rem 1.25rem",
      transition: "border-color 0.2s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)" }}>{c.name}</span>
            <Badge state={c.state} />
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.image}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {c.state === "running" ? (
            <>
              <ActionBtn icon="ti-player-pause" label="Pause" onClick={() => handleAction("pause")} loading={actionLoading === "pause"} />
              <ActionBtn icon="ti-square" label="Stop" onClick={() => handleAction("stop")} loading={actionLoading === "stop"} danger />
              <ActionBtn icon="ti-refresh" label="Restart" onClick={() => handleAction("restart")} loading={actionLoading === "restart"} />
            </>
          ) : c.state === "paused" ? (
            <ActionBtn icon="ti-player-play" label="Unpause" onClick={() => handleAction("unpause")} loading={actionLoading === "unpause"} success />
          ) : (
            <ActionBtn icon="ti-player-play" label="Start" onClick={() => handleAction("start")} loading={actionLoading === "start"} success />
          )}
          <ActionBtn icon={expanded ? "ti-chevron-up" : "ti-chevron-down"} label="Details" onClick={() => setExpanded(v => !v)} />
        </div>
      </div>

      {c.state === "running" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "0.75rem" }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>CPU</span>
              <span style={{ fontSize: 12, fontWeight: 500 }}>{c.cpu_percent.toFixed(1)}%</span>
            </div>
            <GaugeBar value={c.cpu_percent} max={100} />
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>RAM</span>
              <span style={{ fontSize: 12, fontWeight: 500 }}>{fmt.bytes(c.mem_usage)}</span>
            </div>
            <GaugeBar value={c.mem_usage} max={c.mem_limit || 1} />
          </div>
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.25rem 1rem", fontSize: 12 }}>
            <Row k="Container ID" v={c.id.slice(0, 12)} mono />
            <Row k="Uptime" v={c.uptime} />
            <Row k="Memory limit" v={fmt.bytes(c.mem_limit)} />
            <Row k="Memory used" v={`${fmt.bytes(c.mem_usage)} (${Math.round(memPct)}%)`} />
            <Row k="Created" v={c.created} />
            {c.ports.length > 0 && (
              <div style={{ gridColumn: "span 2" }}>
                <span style={{ color: "var(--color-text-secondary)" }}>Ports</span>
                <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  {c.ports.map((p, i) => (
                    <span key={i} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--color-background-info)", color: "var(--color-text-info)", fontFamily: "var(--font-mono)" }}>
                      {p.host}:{p.container}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: "0.75rem", borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: "0.75rem" }}>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8, fontWeight: 500 }}>Quick actions</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <ActionBtnText icon="ti-terminal" label="Shell" onClick={() => handleAction("shell")} />
              <ActionBtnText icon="ti-file-description" label="Logs" onClick={() => handleAction("logs")} />
              <ActionBtnText icon="ti-info-circle" label="Inspect" onClick={() => handleAction("inspect")} />
              <ActionBtnText icon="ti-trash" label="Remove" onClick={() => handleAction("remove")} danger disabled={c.state === "running"} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ActionBtn = ({ icon, label, onClick, loading, danger, success }) => (
  <button
    title={label}
    onClick={onClick}
    disabled={!!loading}
    style={{
      border: `0.5px solid ${danger ? "var(--color-border-danger)" : success ? "var(--color-border-success)" : "var(--color-border-secondary)"}`,
      borderRadius: "var(--border-radius-md)",
      background: "transparent",
      padding: "5px 10px",
      cursor: loading ? "wait" : "pointer",
      color: danger ? "var(--color-text-danger)" : success ? "var(--color-text-success)" : "var(--color-text-secondary)",
      opacity: loading ? 0.5 : 1,
      display: "flex", alignItems: "center", gap: 5, fontSize: 12,
    }}
  >
    <i className={`ti ${loading ? "ti-loader" : icon}`} style={{ fontSize: 14 }} aria-hidden="true" />
    {label}
  </button>
);

const ActionBtnText = ({ icon, label, onClick, danger, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      border: `0.5px solid ${danger ? "var(--color-border-danger)" : "var(--color-border-secondary)"}`,
      borderRadius: "var(--border-radius-md)",
      background: "transparent",
      padding: "4px 10px",
      cursor: disabled ? "not-allowed" : "pointer",
      color: danger ? "var(--color-text-danger)" : "var(--color-text-secondary)",
      display: "flex", alignItems: "center", gap: 5, fontSize: 12,
      opacity: disabled ? 0.4 : 1,
    }}
  >
    <i className={`ti ${icon}`} style={{ fontSize: 14 }} aria-hidden="true" /> {label}
  </button>
);

const Row = ({ k, v, mono }) => (
  <>
    <span style={{ color: "var(--color-text-secondary)" }}>{k}</span>
    <span style={{ fontFamily: mono ? "var(--font-mono)" : undefined, textAlign: "right" }}>{v}</span>
  </>
);

const StatCard = ({ label, value, sub, icon, color }) => (
  <div style={{
    background: "var(--color-background-secondary)",
    borderRadius: "var(--border-radius-md)",
    padding: "1rem",
    display: "flex", flexDirection: "column", gap: 4,
  }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{label}</span>
      <i className={`ti ${icon}`} style={{ fontSize: 16, color: color || "var(--color-text-secondary)" }} aria-hidden="true" />
    </div>
    <div style={{ fontSize: 22, fontWeight: 500, color: "var(--color-text-primary)" }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{sub}</div>}
  </div>
);

const Modal = ({ title, content, onClose }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
    <div onClick={e => e.stopPropagation()} style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-lg)", padding: "1.5rem", maxWidth: 680, width: "90%", maxHeight: "75vh", overflow: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <span style={{ fontSize: 15, fontWeight: 500 }}>{title}</span>
        <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--color-text-secondary)", padding: 4 }}><i className="ti ti-x" /></button>
      </div>
      <pre style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>{content}</pre>
    </div>
  </div>
);

const LogsTab = () => {
  const [logType, setLogType] = useState("system");
  const [logs, setLogs] = useState("");
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [containers, setContainers] = useState([]);
  const [selectedContainer, setSelectedContainer] = useState(null);

  useEffect(() => {
    authFetch(`${API_BASE}/api/docker`)
      .then(r => r.json())
      .then(setContainers)
      .catch(() => {});
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    setLogs("");
    try {
      if (logType === "system") {
        const r = await authFetch(`${API_BASE}/api/logs/system`);
        const j = await r.json();
        setLogs(j.logs || "No logs available");
      } else if (logType === "docker-events") {
        const r = await authFetch(`${API_BASE}/api/logs/docker`);
        const j = await r.json();
        setLogs(j.logs || "No Docker events available");
      } else if (logType === "container" && selectedContainer) {
        const r = await authFetch(`${API_BASE}/api/docker/${selectedContainer}/logs`, { method: "POST" });
        const j = await r.json();
        setLogs(j.logs || "No logs available");
      }
    } catch {
      setLogs("Error fetching logs — backend not reachable.");
    } finally {
      setLoadingLogs(false);
    }
  }, [logType, selectedContainer]);

  useEffect(() => {
    if (logType !== "container" || selectedContainer) {
      fetchLogs();
    }
  }, [logType, selectedContainer]);

  const btnStyle = (active) => ({
    border: `0.5px solid ${active ? "var(--color-border-primary)" : "var(--color-border-tertiary)"}`,
    background: active ? "var(--color-background-secondary)" : "transparent",
    borderRadius: "var(--border-radius-md)",
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: active ? 500 : 400,
    color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Log type selector */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button style={btnStyle(logType === "system")} onClick={() => setLogType("system")}>
          <i className="ti ti-device-desktop" style={{ fontSize: 13, marginRight: 6 }} />System logs
        </button>
        <button style={btnStyle(logType === "docker-events")} onClick={() => setLogType("docker-events")}>
          <i className="ti ti-brand-docker" style={{ fontSize: 13, marginRight: 6 }} />Docker events
        </button>
        <button style={btnStyle(logType === "container")} onClick={() => setLogType("container")}>
          <i className="ti ti-file-description" style={{ fontSize: 13, marginRight: 6 }} />Container logs
        </button>
        <button
          onClick={fetchLogs}
          disabled={loadingLogs}
          style={{ ...btnStyle(false), marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}
        >
          <i className={`ti ${loadingLogs ? "ti-loader" : "ti-refresh"}`} style={{ fontSize: 13 }} />
          {loadingLogs ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Container picker */}
      {logType === "container" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {containers.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedContainer(c.id)}
              style={{
                ...btnStyle(selectedContainer === c.id),
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <span style={{
                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                background: c.state === "running" ? "var(--color-text-success)" : "var(--color-text-danger)",
              }} />
              {c.name}
            </button>
          ))}
          {containers.length === 0 && (
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>No containers found</span>
          )}
        </div>
      )}

      {/* Log output */}
      <div style={{
        background: "var(--color-background-primary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "var(--border-radius-lg)",
        padding: "1rem",
        minHeight: 300,
      }}>
        {loadingLogs ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--color-text-secondary)", fontSize: 13 }}>
            <i className="ti ti-loader" style={{ fontSize: 15 }} /> Loading logs…
          </div>
        ) : logType === "container" && !selectedContainer ? (
          <div style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
            ← Select a container to view its logs
          </div>
        ) : (
          <pre style={{
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            color: "var(--color-text-secondary)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            margin: 0,
            lineHeight: 1.6,
          }}>
            {logs || "No output"}
          </pre>
        )}
      </div>
    </div>
  );
};

const SHORTCUT_ACTIONS = [
  { value: "restart",       label: "restart",               needsTarget: true },
  { value: "stop",          label: "stop",                  needsTarget: true },
  { value: "start",         label: "start",                 needsTarget: true },
  { value: "logs",          label: "logs",                  needsTarget: true,  hasLines: true },
  { value: "pull",          label: "pull (update image)",   needsTarget: true },
  { value: "stats",         label: "stats",                 needsTarget: false },
  { value: "prune",         label: "system prune",          needsTarget: false },
  { value: "prune-images",  label: "prune images",          needsTarget: false },
  { value: "watchtower",    label: "watchtower (update all)", needsTarget: false },
  { value: "custom",        label: "custom…",               needsTarget: false },
];

function buildCommand(action, target, lines, custom) {
  switch (action) {
    case "restart":       return `docker restart ${target}`;
    case "stop":          return `docker stop ${target}`;
    case "start":         return `docker start ${target}`;
    case "logs":          return `docker logs ${target} --tail ${lines}`;
    case "pull":          return `docker pull $(docker inspect --format='{{.Config.Image}}' ${target})`;
    case "stats":         return target ? `docker stats ${target} --no-stream` : "docker stats --no-stream";
    case "prune":         return "docker system prune -f";
    case "prune-images":  return "docker image prune -af";
    case "watchtower":    return "docker run --rm -e DOCKER_API_VERSION=1.40 -v /var/run/docker.sock:/var/run/docker.sock containrrr/watchtower --cleanup --run-once";
    case "custom":        return custom;
    default:              return "";
  }
}

const ShortcutsTab = ({ containers }) => {
  const [action, setAction] = useState("restart");
  const [target, setTarget] = useState("");
  const [lines, setLines] = useState("100");
  const [custom, setCustom] = useState("");
  const [name, setName] = useState("");
  const [shortcuts, setShortcuts] = useState([]);
  const [output, setOutput] = useState(null);
  const [running, setRunning] = useState(null);

  const actionCfg = SHORTCUT_ACTIONS.find(a => a.value === action);
  const cmd = buildCommand(action, target, lines, custom);

  useEffect(() => {
    authFetch(`${API_BASE}/api/shortcuts`)
      .then(r => r.json())
      .then(setShortcuts)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (actionCfg?.needsTarget && containers.length > 0 && !target) {
      setTarget(containers[0].name);
    }
    if (!actionCfg?.needsTarget) setTarget("");
  }, [action, containers]);

  const save = async () => {
    const n = name.trim() || `${action}${target ? " " + target : ""}`;
    const sc = { id: Date.now(), name: n, action, target, lines, custom, cmd };
    const res = await authFetch(`${API_BASE}/api/shortcuts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sc),
    }).then(r => r.json()).catch(() => null);
    if (res) { setShortcuts(res); setName(""); }
  };

  const remove = async (id) => {
    const res = await authFetch(`${API_BASE}/api/shortcuts/${id}`, { method: "DELETE" })
      .then(r => r.json()).catch(() => null);
    if (res) setShortcuts(res);
  };

  const run = async (sc) => {
    setRunning(sc.id);
    setOutput({ id: sc.id, name: sc.name, text: "Running…" });
    try {
      const res = await authFetch(`${API_BASE}/api/shortcuts/${sc.id}/run`, { method: "POST" })
        .then(r => r.json());
      setOutput({ id: sc.id, name: sc.name, text: res.output || res.error || "Done" });
    } catch {
      setOutput({ id: sc.id, name: sc.name, text: "Error — backend not reachable" });
    }
    setRunning(null);
  };

  const selectStyle = { fontSize: 13, padding: "6px 10px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)", cursor: "pointer" };
  const btnStyle = (danger) => ({ border: `0.5px solid ${danger ? "var(--color-border-danger)" : "var(--color-border-secondary)"}`, background: "transparent", borderRadius: "var(--border-radius-md)", padding: "5px 7px", cursor: "pointer", color: danger ? "var(--color-text-danger)" : "var(--color-text-secondary)", display: "flex", alignItems: "center" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

      {/* Builder */}
      <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem" }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: "0.75rem" }}>
          <i className="ti ti-plus" style={{ fontSize: 14, marginRight: 6, verticalAlign: "-2px" }} aria-hidden="true" />
          New shortcut
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Action</span>
            <select style={selectStyle} value={action} onChange={e => setAction(e.target.value)}>
              {SHORTCUT_ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>

          {actionCfg?.needsTarget && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Container</span>
              <select style={selectStyle} value={target} onChange={e => setTarget(e.target.value)}>
                {containers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          )}

          {actionCfg?.hasLines && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Lines</span>
              <select style={selectStyle} value={lines} onChange={e => setLines(e.target.value)}>
                {["50","100","200","500"].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          )}

          {action === "custom" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Command</span>
              <input style={{ fontFamily: "var(--font-mono)", fontSize: 12 }} placeholder="docker run --rm ..." value={custom} onChange={e => setCustom(e.target.value)} />
            </div>
          )}
        </div>

        <div style={{ marginTop: "0.75rem", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--color-text-primary)", wordBreak: "break-all" }}>
          {cmd || "—"}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: "0.75rem", alignItems: "center" }}>
          <input placeholder="Shortcut name (optional)" value={name} onChange={e => setName(e.target.value)} style={{ flex: 1, fontSize: 13 }} />
          <button onClick={save} disabled={!cmd} style={{ border: "0.5px solid var(--color-border-primary)", background: "transparent", borderRadius: "var(--border-radius-md)", padding: "6px 14px", cursor: cmd ? "pointer" : "not-allowed", fontSize: 13, color: "var(--color-text-primary)", display: "flex", alignItems: "center", gap: 6, opacity: cmd ? 1 : 0.4, whiteSpace: "nowrap" }}>
            <i className="ti ti-device-floppy" style={{ fontSize: 14 }} aria-hidden="true" /> Save
          </button>
        </div>
      </div>

      {/* Saved shortcuts */}
      <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem" }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: "0.75rem" }}>
          <i className="ti ti-terminal" style={{ fontSize: 14, marginRight: 6, verticalAlign: "-2px" }} aria-hidden="true" />
          Saved shortcuts
        </div>

        {shortcuts.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", padding: "1rem 0" }}>No shortcuts yet — create one above.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {shortcuts.map(sc => (
              <div key={sc.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: "var(--border-radius-md)", background: sc.target ? "var(--color-background-info)" : "var(--color-background-warning)", color: sc.target ? "var(--color-text-info)" : "var(--color-text-warning)", whiteSpace: "nowrap" }}>
                    {sc.target || "system"}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{sc.name}</span>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240 }}>{sc.cmd}</span>
                  <button
                    onClick={() => run(sc)}
                    disabled={running === sc.id}
                    style={{ border: `0.5px solid ${running === sc.id ? "var(--color-border-success)" : "var(--color-border-secondary)"}`, background: "transparent", borderRadius: "var(--border-radius-md)", padding: "4px 10px", cursor: "pointer", fontSize: 12, color: running === sc.id ? "var(--color-text-success)" : "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                    <i className={`ti ${running === sc.id ? "ti-loader" : "ti-player-play"}`} style={{ fontSize: 12 }} aria-hidden="true" />
                    {running === sc.id ? "Running…" : "Run"}
                  </button>
                  <button onClick={() => remove(sc.id)} style={btnStyle(true)}>
                    <i className="ti ti-trash" style={{ fontSize: 13 }} aria-hidden="true" />
                  </button>
                </div>
                {output?.id === sc.id && (
                  <div style={{ margin: "6px 0 4px", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "8px 12px", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.6 }}>
                    {output.text}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function Dashboard({ user, onLogout }) {
  const { data, loading, error, refetch, lastUpdated, cpuHistory } = useServerData();
  const [tab, setTab] = useState("overview");
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");

  const handleAction = async (id, action, name) => {
    try {
      const res = await authFetch(`${API_BASE}/api/docker/${id}/${action}`, { method: "POST" });
      const json = await res.json();
      if (action === "logs") {
        setModal({ title: `Logs — ${name || id.slice(0, 12)}`, content: json.logs });
      } else if (action === "inspect") {
        setModal({ title: `Inspect — ${name || id.slice(0, 12)}`, content: JSON.stringify(json, null, 2) });
      } else if (action === "shell") {
        setModal({ title: "Shell", content: `To open a shell, run:\n\ndocker exec -it ${name || id.slice(0, 12)} /bin/sh\n\n(or /bin/bash depending on the image)` });
      } else {
        setTimeout(refetch, 1200);
      }
    } catch {
      setModal({ title: "Demo mode", content: `Action "${action}" on container ${name || id.slice(0, 12)} — backend not connected.\n\nDeploy the backend to enable container control.` });
    }
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "var(--color-text-secondary)", gap: 8 }}>
      <i className="ti ti-loader" style={{ fontSize: 18 }} aria-hidden="true" />
      <span>Connecting to server…</span>
    </div>
  );

  const sys = data?.system;
  const containers = data?.containers || [];
  const filtered = containers.filter(c => {
    if (filter === "running" && c.state !== "running") return false;
    if (filter === "stopped" && c.state === "running") return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.image.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const running = containers.filter(c => c.state === "running").length;

  return (
    <div style={{ padding: "1rem 0", fontFamily: "var(--font-sans)" }}>
      {modal && <Modal title={modal.title} content={modal.content} onClose={() => setModal(null)} />}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>
            <i className="ti ti-server" style={{ fontSize: 18, marginRight: 8, verticalAlign: "-2px" }} aria-hidden="true" />
            {sys?.hostname || "server"} dashboard
          </h2>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4 }}>
            {error ? <span style={{ color: "var(--color-text-warning)" }}><i className="ti ti-alert-circle" style={{ fontSize: 13, marginRight: 4, verticalAlign: "-1px" }} />{error}</span>
              : lastUpdated ? `Updated ${Math.round((Date.now() - lastUpdated) / 1000)}s ago` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={refetch} style={{ border: "0.5px solid var(--color-border-secondary)", background: "transparent", borderRadius: "var(--border-radius-md)", padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-text-secondary)" }}>
            <i className="ti ti-refresh" style={{ fontSize: 14 }} aria-hidden="true" /> Refresh
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-tertiary)", fontSize: 13, color: "var(--color-text-secondary)" }}>
            <i className="ti ti-user-circle" style={{ fontSize: 14 }} />
            <span style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name || user?.username}</span>
          </div>
          <button onClick={onLogout} style={{ border: "0.5px solid var(--color-border-secondary)", background: "transparent", borderRadius: "var(--border-radius-md)", padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "var(--color-text-secondary)" }} title="Sign out">
            <i className="ti ti-logout" style={{ fontSize: 14 }} /> Sign out
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: "1.5rem", borderBottom: "0.5px solid var(--color-border-tertiary)", paddingBottom: "0.5rem" }}>
        {["overview", "containers", "storage", "network", "logs", "shortcuts"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            border: "none", background: tab === t ? "var(--color-background-secondary)" : "transparent",
            borderRadius: "var(--border-radius-md)", padding: "6px 14px", cursor: "pointer",
            fontSize: 13, fontWeight: tab === t ? 500 : 400,
            color: tab === t ? "var(--color-text-primary)" : "var(--color-text-secondary)",
          }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === "overview" && sys && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <StatCard label="Uptime" value={fmt.uptime(sys.uptime)} icon="ti-clock" />
            <StatCard label="CPU usage" value={fmt.pct(sys.cpu.percent)} icon="ti-cpu" color={sys.cpu.percent > 80 ? "var(--color-text-danger)" : "var(--color-text-success)"} />
            <StatCard label="RAM used" value={fmt.bytes(sys.ram.used)} sub={`of ${fmt.bytes(sys.ram.total)}`} icon="ti-server" />
            <StatCard label="Containers" value={`${running}/${containers.length}`} sub="running" icon="ti-brand-docker" color="var(--color-text-info)" />
          </div>

          <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem" }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: "0.75rem" }}>System resources</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <ResourceRow label="CPU" value={sys.cpu.percent} max={100} sub={`${sys.cpu.cores} cores · ${sys.cpu.model}`} fmt={v => `${v.toFixed(1)}%`}>
                {cpuHistory.length >= 2 && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: "var(--color-text-secondary)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Activity · last 15 min</span>
                      <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                        {Math.min(...cpuHistory)}% – {Math.max(...cpuHistory)}%
                      </span>
                    </div>
                    <div style={{ background: "rgba(255,255,255,0.025)", borderRadius: 6, padding: "6px 8px" }}>
                      <CpuSparkline history={cpuHistory} />
                    </div>
                  </div>
                )}
                {sys.cpu.perCore?.length > 0 && <CpuPerCore cores={sys.cpu.perCore} />}
              </ResourceRow>
              <ResourceRow label="RAM" value={sys.ram.used} max={sys.ram.total} sub={`${fmt.bytes(sys.ram.available)} available`} fmt={v => `${fmt.bytes(v)} / ${fmt.bytes(sys.ram.total)}`} />
              {sys.disks.map((d, i) => (
                <ResourceRow key={i} label={`Disk ${d.mountpoint}`} value={d.used} max={d.total} sub={`${fmt.bytes(d.free)} free · ${d.device}`} fmt={v => `${fmt.bytes(v)} / ${fmt.bytes(d.total)}`} />
              ))}
            </div>
          </div>

          <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem" }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: "0.75rem" }}>Active containers</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {containers.filter(c => c.state === "running").map(c => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-text-success)", flexShrink: 0 }} />
                    <span style={{ fontWeight: 500 }}>{c.name}</span>
                    <span style={{ color: "var(--color-text-secondary)", fontSize: 12 }}>{c.image.split(":")[0].split("/").pop()}</span>
                  </div>
                  <div style={{ display: "flex", gap: 12, color: "var(--color-text-secondary)", fontSize: 12 }}>
                    <span>CPU {c.cpu_percent.toFixed(1)}%</span>
                    <span>RAM {fmt.bytes(c.mem_usage)}</span>
                    <span style={{ color: "var(--color-text-tertiary)" }}>↑ {c.uptime}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Containers tab */}
      {tab === "containers" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <i className="ti ti-search" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "var(--color-text-secondary)" }} aria-hidden="true" />
              <input
                placeholder="Search containers…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: "100%", paddingLeft: 32, boxSizing: "border-box" }}
              />
            </div>
            {["all", "running", "stopped"].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                border: `0.5px solid ${filter === f ? "var(--color-border-primary)" : "var(--color-border-tertiary)"}`,
                background: filter === f ? "var(--color-background-secondary)" : "transparent",
                borderRadius: "var(--border-radius-md)", padding: "6px 12px", cursor: "pointer", fontSize: 12,
                color: filter === f ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              }}>
                {f.charAt(0).toUpperCase() + f.slice(1)} {f === "all" ? `(${containers.length})` : f === "running" ? `(${running})` : `(${containers.length - running})`}
              </button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--color-text-secondary)", padding: "2rem", fontSize: 14 }}>
              No containers found
            </div>
          ) : (
            filtered.map(c => <ContainerCard key={c.id} c={c} onAction={handleAction} />)
          )}
        </div>
      )}

      {tab === "storage" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {!sys ? (
            <div style={{ textAlign: "center", color: "var(--color-text-secondary)", padding: "2rem", fontSize: 14 }}>
              Loading storage info…
            </div>
          ) : sys.disks.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--color-text-secondary)", padding: "2rem", fontSize: 14 }}>
              No disks detected
            </div>
          ) : (
            sys.disks.map((d, i) => (
              <div key={i} style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{d.mountpoint}</div>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)", marginTop: 2 }}>{d.device}</div>
                  </div>
                  <span style={{ fontSize: 22, fontWeight: 500 }}>{fmt.pct(d.percent)}</span>
                </div>
                <GaugeBar value={d.used} max={d.total} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: "var(--color-text-secondary)" }}>
                  <span>Used: {fmt.bytes(d.used)}</span>
                  <span>Free: {fmt.bytes(d.free)}</span>
                  <span>Total: {fmt.bytes(d.total)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Network tab */}
      {tab === "network" && sys && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <StatCard label="Total received" value={fmt.bytes(sys.network.rx_bytes)} icon="ti-arrow-down" color="var(--color-text-success)" />
          <StatCard label="Total sent" value={fmt.bytes(sys.network.tx_bytes)} icon="ti-arrow-up" color="var(--color-text-info)" />
          <div style={{ gridColumn: "span 2", background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem" }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: "0.75rem" }}>Container port bindings</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {containers.filter(c => c.ports.length > 0).map(c => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Badge state={c.state} />
                    <span style={{ fontWeight: 500 }}>{c.name}</span>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {c.ports.map((p, i) => (
                      <span key={i} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--color-background-info)", color: "var(--color-text-info)", fontFamily: "var(--font-mono)" }}>
                        :{p.host}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "logs" && <LogsTab />}
      {tab === "shortcuts" && <ShortcutsTab containers={containers} />}
    </div>
  );
}

const ResourceRow = ({ label, value, max, sub, fmt: fmtFn, children }) => (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
      <div>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
        {sub && <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginLeft: 8 }}>{sub}</span>}
      </div>
      <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{fmtFn(value)}</span>
    </div>
    <GaugeBar value={value} max={max} />
    {children && <div style={{ marginTop: 10 }}>{children}</div>}
  </div>
);

export default function App() {
  const [user, setUser] = useState(() => {
    const token = getToken();
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (payload.exp && payload.exp * 1000 < Date.now()) { clearToken(); return null; }
      return { id: payload.id, name: payload.name, username: payload.username };
    } catch { clearToken(); return null; }
  });

  const handleAuth = (u) => setUser(u);

  const handleLogout = () => {
    clearToken();
    setUser(null);
  };

  if (!user) return <AuthScreen onAuth={handleAuth} />;
  return <Dashboard user={user} onLogout={handleLogout} />;
}