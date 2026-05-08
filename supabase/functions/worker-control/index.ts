// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Client as SshClient } from "npm:ssh2@1.15.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SSH_HOST = Deno.env.get("DEPLOY_SSH_HOST") ?? "";
const SSH_USER = Deno.env.get("DEPLOY_SSH_USER") ?? "lovable-deploy";
const SSH_PORT = parseInt(Deno.env.get("DEPLOY_SSH_PORT") ?? "22", 10);
const SSH_KEY = Deno.env.get("DEPLOY_SSH_KEY") ?? "";

const APP_DIR = "/home/worker/app";
const WORKER_DIR = `${APP_DIR}/worker`;

const COMMANDS: Record<string, string> = {
  deploy: `cd ${APP_DIR} && git pull && cd ${WORKER_DIR} && npm install && npx tsc -p . && sudo /usr/bin/pm2 restart yandex-worker && git rev-parse --short HEAD`,
  restart: `sudo /usr/bin/pm2 restart yandex-worker && echo OK`,
  status: `pm2 jlist`,
  logs: `pm2 logs yandex-worker --lines 200 --nostream --raw`,
};

function runSsh(cmd: string, timeoutMs = 120_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (!SSH_HOST || !SSH_KEY) {
      reject(new Error("DEPLOY_SSH_HOST or DEPLOY_SSH_KEY is not set"));
      return;
    }
    const conn = new SshClient();
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { conn.end(); } catch { /* */ }
      reject(new Error(`SSH timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    conn
      .on("ready", () => {
        conn.exec(cmd, (err, stream) => {
          if (err) { clearTimeout(timer); conn.end(); reject(err); return; }
          stream
            .on("close", (code: number) => {
              clearTimeout(timer);
              conn.end();
              resolve({ code: code ?? 0, stdout, stderr });
            })
            .on("data", (d: Buffer) => { stdout += d.toString("utf8"); })
            .stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
        });
      })
      .on("error", (e) => { clearTimeout(timer); reject(e); })
      .connect({
        host: SSH_HOST,
        port: SSH_PORT,
        username: SSH_USER,
        privateKey: SSH_KEY,
        readyTimeout: 15_000,
      });
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Validate user via anon client with the user's JWT
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "Unauthorized" }, 401);

    // Admin check via service-role client
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userRes.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Forbidden: admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "").toLowerCase();
    const cmd = COMMANDS[action];
    if (!cmd) return json({ error: `Unknown action: ${action}` }, 400);

    const timeoutMs = action === "deploy" ? 240_000 : 30_000;
    const result = await runSsh(cmd, timeoutMs);

    let parsed: any = undefined;
    if (action === "status" && result.code === 0) {
      try {
        const arr = JSON.parse(result.stdout);
        const proc = Array.isArray(arr) ? arr.find((p: any) => p.name === "yandex-worker") : null;
        if (proc) {
          parsed = {
            name: proc.name,
            status: proc.pm2_env?.status,
            uptime_ms: proc.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : null,
            restarts: proc.pm2_env?.restart_time,
            memory_mb: proc.monit?.memory ? Math.round(proc.monit.memory / 1024 / 1024) : null,
            cpu: proc.monit?.cpu,
            pid: proc.pid,
          };
        }
      } catch { /* leave parsed undefined */ }
    }

    return json({ ok: result.code === 0, action, code: result.code, stdout: result.stdout, stderr: result.stderr, parsed });
  } catch (e) {
    console.error("worker-control error", e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
