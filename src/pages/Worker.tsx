import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, RotateCw, UploadCloud, Server, AlertCircle } from "lucide-react";
import { useIsAdmin } from "@/hooks/useIsAdmin";

type StatusParsed = {
  name?: string;
  status?: string;
  uptime_ms?: number | null;
  restarts?: number;
  memory_mb?: number | null;
  cpu?: number;
  pid?: number;
};

type ControlResponse = {
  ok?: boolean;
  action?: string;
  code?: number;
  stdout?: string;
  stderr?: string;
  parsed?: StatusParsed;
  error?: string;
};

type QueueCounts = { pending: number; running: number; failed: number; done: number };
type Alert = { id: string; created_at: string; kind: string; message: string };

function fmtUptime(ms: number | null | undefined) {
  if (!ms || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}д ${h}ч`;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м`;
}

async function countByStatus(table: "scrape_jobs" | "wordstat_jobs"): Promise<QueueCounts> {
  const statuses: (keyof QueueCounts)[] = ["pending", "running", "failed", "done"];
  const out: QueueCounts = { pending: 0, running: 0, failed: 0, done: 0 };
  await Promise.all(
    statuses.map(async (st) => {
      const { count } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("status", st);
      out[st] = count ?? 0;
    }),
  );
  return out;
}

export default function Worker() {
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading } = useIsAdmin();

  const [status, setStatus] = useState<StatusParsed | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [scrape, setScrape] = useState<QueueCounts | null>(null);
  const [wordstat, setWordstat] = useState<QueueCounts | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [busy, setBusy] = useState<null | "deploy" | "restart" | "refresh">(null);

  const callControl = useCallback(async (action: "deploy" | "restart" | "status" | "logs"): Promise<ControlResponse> => {
    const { data, error } = await supabase.functions.invoke("worker-control", { body: { action } });
    if (error) throw new Error(error.message);
    return (data ?? {}) as ControlResponse;
  }, []);

  const refreshAll = useCallback(async () => {
    setBusy((b) => b ?? "refresh");
    try {
      const [st, lg, sj, wj, al] = await Promise.all([
        callControl("status").catch((e) => ({ error: String(e.message ?? e) }) as ControlResponse),
        callControl("logs").catch((e) => ({ error: String(e.message ?? e) }) as ControlResponse),
        countByStatus("scrape_jobs"),
        countByStatus("wordstat_jobs"),
        supabase.from("system_alerts").select("id, created_at, kind, message").order("created_at", { ascending: false }).limit(20),
      ]);
      if (st.error) { setStatusErr(st.error); setStatus(null); }
      else { setStatusErr(null); setStatus(st.parsed ?? null); }
      setLogs(lg.error ? `Ошибка получения логов: ${lg.error}` : (lg.stdout ?? ""));
      setScrape(sj);
      setWordstat(wj);
      setAlerts((al.data as Alert[]) ?? []);
    } finally {
      setBusy(null);
    }
  }, [callControl]);

  useEffect(() => {
    if (!isAdmin) return;
    refreshAll();
    const t = setInterval(() => {
      // тихий рефреш статуса+очереди (без логов чтобы не дёргать SSH часто)
      Promise.all([
        callControl("status").catch(() => null),
        countByStatus("scrape_jobs"),
        countByStatus("wordstat_jobs"),
      ]).then(([st, sj, wj]) => {
        if (st && !st.error) { setStatus(st.parsed ?? null); setStatusErr(null); }
        if (sj) setScrape(sj);
        if (wj) setWordstat(wj);
      });
    }, 15000);
    return () => clearInterval(t);
  }, [isAdmin, refreshAll, callControl]);

  const onDeploy = async () => {
    setBusy("deploy");
    try {
      const res = await callControl("deploy");
      if (res.ok) {
        const sha = (res.stdout ?? "").trim().split("\n").pop() ?? "";
        toast.success(`Воркер обновлён${sha ? ` (${sha})` : ""}`);
      } else {
        toast.error(`Не удалось обновить: code ${res.code}`);
      }
      setLogs((res.stdout ?? "") + (res.stderr ? `\n--- stderr ---\n${res.stderr}` : ""));
      await refreshAll();
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  const onRestart = async () => {
    setBusy("restart");
    try {
      const res = await callControl("restart");
      if (res.ok) toast.success("Воркер перезапущен");
      else toast.error(`Рестарт не удался: code ${res.code}`);
      await refreshAll();
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  if (roleLoading) {
    return <div className="p-8 text-muted-foreground">Загрузка…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="p-8 max-w-xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold">Доступ запрещён</h1>
        <p className="text-muted-foreground">Эта страница доступна только администратору.</p>
        <Button variant="ghost" onClick={() => navigate("/")}><ArrowLeft className="h-4 w-4 mr-2" />На дашборд</Button>
      </div>
    );
  }

  const online = status?.status === "online";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary to-accent grid place-items-center">
              <Server className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight">Воркер</div>
              <div className="text-xs text-muted-foreground leading-tight">управление сервером скрейпинга</div>
            </div>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/"><ArrowLeft className="h-4 w-4 mr-2" />На дашборд</Link>
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-500" : "bg-red-500"}`} />
                  Статус: {status?.status ?? (statusErr ? "недоступен" : "—")}
                </CardTitle>
                <CardDescription>
                  {statusErr
                    ? <span className="text-destructive">{statusErr}</span>
                    : <>uptime {fmtUptime(status?.uptime_ms)} · RAM {status?.memory_mb ?? "—"} MB · restarts {status?.restarts ?? "—"} · pid {status?.pid ?? "—"}</>}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button onClick={onDeploy} disabled={busy !== null}>
                  <UploadCloud className="h-4 w-4 mr-2" />
                  {busy === "deploy" ? "Обновляю…" : "Обновить код"}
                </Button>
                <Button variant="secondary" onClick={onRestart} disabled={busy !== null}>
                  <RotateCw className="h-4 w-4 mr-2" />
                  {busy === "restart" ? "Рестарт…" : "Рестарт"}
                </Button>
                <Button variant="ghost" onClick={refreshAll} disabled={busy !== null}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
        </Card>

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Очередь scrape_jobs</CardTitle>
              <CardDescription>проверки позиций в Яндекс Картах</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge variant="secondary">pending {scrape?.pending ?? 0}</Badge>
              <Badge>running {scrape?.running ?? 0}</Badge>
              <Badge variant="destructive">failed {scrape?.failed ?? 0}</Badge>
              <Badge variant="outline">done {scrape?.done ?? 0}</Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Очередь wordstat_jobs</CardTitle>
              <CardDescription>сбор частотности ключей</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge variant="secondary">pending {wordstat?.pending ?? 0}</Badge>
              <Badge>running {wordstat?.running ?? 0}</Badge>
              <Badge variant="destructive">failed {wordstat?.failed ?? 0}</Badge>
              <Badge variant="outline">done {wordstat?.done ?? 0}</Badge>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />Последние алерты</CardTitle>
            <CardDescription>system_alerts, последние 20</CardDescription>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <div className="text-sm text-muted-foreground">Алертов нет</div>
            ) : (
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {alerts.map((a) => (
                    <div key={a.id} className="text-sm border rounded-md p-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{new Date(a.created_at).toLocaleString()}</span>
                        <Badge variant="outline">{a.kind}</Badge>
                      </div>
                      <div className="mt-1 break-words">{a.message}</div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Логи воркера</CardTitle>
            <CardDescription>pm2 logs yandex-worker, последние ~200 строк</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-96 rounded-md border bg-muted/30">
              <pre className="text-xs p-3 font-mono whitespace-pre-wrap break-words">
                {logs || "Нет данных"}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
