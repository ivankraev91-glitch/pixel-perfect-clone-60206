import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { toast } from "sonner";
import { MapPin, Settings, LogOut, Loader2, Search, Server } from "lucide-react";
import { useIsAdmin } from "@/hooks/useIsAdmin";

interface Org { id: string; name: string; city: string | null; address: string | null; }
interface Kw { id: string; keyword: string; frequency: number | null; }
interface Gp { id: string; label: string; lat: number; lon: number; }
interface Check {
  id: string;
  position: number | null;            // legacy mirror of maps_position
  total_results: number | null;
  maps_indexed: boolean | null;
  maps_position: number | null;
  wizard_exists: boolean | null;
  wizard_position: number | null;
  wizard_total: number | null;
  error_type: string | null;
  checked_at: string;
  keywords: { keyword: string } | null;
  geopoints: { label: string } | null;
}

type StatusKind = "ok" | "maps_only_no_wizard_card" | "maps_only_no_wizard_block" | "not_indexed" | "error";

function statusOf(c: Check | null | undefined): { kind: StatusKind; label: string; tone: "success" | "warning" | "info" | "destructive" | "muted" } {
  if (!c) return { kind: "error", label: "—", tone: "muted" };
  if (c.maps_indexed === null && c.wizard_exists === null) return { kind: "error", label: "Ошибка проверки", tone: "destructive" };
  if (c.maps_indexed === false) return { kind: "not_indexed", label: "Не в индексе", tone: "destructive" };
  if (c.maps_indexed && c.wizard_exists && c.wizard_position) return { kind: "ok", label: "В Картах + колдунщике", tone: "success" };
  if (c.maps_indexed && c.wizard_exists && !c.wizard_position) return { kind: "maps_only_no_wizard_card", label: "В Картах, не в колдунщике", tone: "warning" };
  if (c.maps_indexed && c.wizard_exists === false) return { kind: "maps_only_no_wizard_block", label: "В Картах (колдунщика нет)", tone: "info" };
  return { kind: "error", label: "Частичный результат", tone: "muted" };
}

function StatusBadge({ check }: { check: Check | null | undefined }) {
  const s = statusOf(check);
  const cls = {
    success: "bg-success text-success-foreground",
    warning: "bg-warning text-warning-foreground",
    info: "bg-primary/10 text-primary border-primary/30",
    destructive: "bg-destructive text-destructive-foreground",
    muted: "bg-muted text-muted-foreground",
  }[s.tone];
  return <Badge className={cls + " border-transparent"}>{s.label}</Badge>;
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const [org, setOrg] = useState<Org | null>(null);
  const [keywords, setKeywords] = useState<Kw[]>([]);
  const [geopoints, setGeopoints] = useState<Gp[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selKw, setSelKw] = useState<string>("");
  const [selGp, setSelGp] = useState<string>("");
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: orgs } = await supabase.from("organizations").select("*").limit(1);
    if (!orgs || orgs.length === 0) {
      navigate("/onboarding", { replace: true });
      return;
    }
    const o = orgs[0] as Org;
    setOrg(o);
    const [{ data: kws }, { data: gps }, { data: chs }] = await Promise.all([
      supabase.from("keywords").select("id, keyword, frequency").eq("org_id", o.id),
      supabase.from("geopoints").select("id, label, lat, lon").eq("org_id", o.id),
      supabase
        .from("checks")
        .select("id, position, total_results, maps_indexed, maps_position, wizard_exists, wizard_position, wizard_total, error_type, checked_at, keywords(keyword), geopoints(label)")
        .eq("org_id", o.id)
        .order("checked_at", { ascending: false })
        .limit(20),
    ]);
    setKeywords((kws ?? []) as Kw[]);
    setGeopoints((gps ?? []) as Gp[]);
    setChecks((chs ?? []) as any);
    if (kws && kws.length > 0) setSelKw(kws[0].id);
    if (gps && gps.length > 0) setSelGp(gps[0].id);
    setLoading(false);
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("checks-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "checks" }, () => {
        load();
        toast.success("Получен новый результат проверки");
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [user]);

  const runCheck = async () => {
    if (!org || !selKw || !selGp) return;
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("check-position", {
      body: { org_id: org.id, keyword_id: selKw, geopoint_id: selGp },
    });
    setRunning(false);
    setDialogOpen(false);
    if (error) {
      try {
        const errorContext = (error as any).context;
        if (errorContext?.json) {
          const j = await errorContext.json();
          if (j?.error === "daily_limit_reached") {
            toast.error(`Достигнут дневной лимит (${j.limit} проверок)`);
            return;
          }
          toast.error(j?.error || error.message);
          return;
        }
      } catch {}
      toast.error(error.message);
      return;
    }
    if (data?.deduplicated) {
      toast.info("Такая проверка уже в очереди");
    } else {
      toast.success("Проверка поставлена в очередь — обычно 10–60 секунд");
    }
  };

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Загрузка...</div>;
  }
  if (!org) return null;

  const latest = checks[0];
  const chartData = [...checks]
    .reverse()
    .slice(-10)
    .map((c) => ({
      date: new Date(c.checked_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
      maps: c.maps_position ?? c.position ?? null,
      wizard: c.wizard_position ?? null,
    }));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary to-accent grid place-items-center">
              <MapPin className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight">MapRank</div>
              <div className="text-xs text-muted-foreground leading-tight">{org.name}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/settings"><Settings className="h-4 w-4 mr-2" />Настройки</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => signOut().then(() => navigate("/auth"))}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Дашборд</h1>
            <p className="text-sm text-muted-foreground">Карты + колдунщик в одной проверке</p>
          </div>
          <Button size="lg" onClick={() => setDialogOpen(true)} disabled={keywords.length === 0 || geopoints.length === 0}>
            <Search className="h-4 w-4 mr-2" />Проверить сейчас
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground font-medium">Последняя проверка</CardTitle>
            </CardHeader>
            <CardContent>
              {latest ? (
                <div className="space-y-4">
                  <StatusBadge check={latest} />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">Карты</div>
                      <div className="text-3xl font-bold tracking-tight mt-1">
                        {latest.maps_position ?? latest.position ?? <span className="text-muted-foreground">—</span>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {latest.maps_indexed === false ? "не найдена" : latest.total_results ? `из ${latest.total_results}` : ""}
                      </div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">Колдунщик</div>
                      <div className="text-3xl font-bold tracking-tight mt-1">
                        {latest.wizard_position ?? <span className="text-muted-foreground">—</span>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {latest.wizard_exists === false
                          ? "блока нет"
                          : latest.wizard_exists && !latest.wizard_position
                            ? "не в блоке"
                            : latest.wizard_total ? `из ${latest.wizard_total}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs space-y-0.5 text-muted-foreground">
                    <div>«{latest.keywords?.keyword}» · {latest.geopoints?.label}</div>
                    <div>{new Date(latest.checked_at).toLocaleString("ru-RU")}</div>
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground text-sm py-8 text-center">
                  Проверок ещё не было.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground font-medium">Динамика (последние 10)</CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis reversed stroke="hsl(var(--muted-foreground))" fontSize={12} domain={[1, "auto"]} />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="maps" name="Карты" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                      <Line type="monotone" dataKey="wizard" name="Колдунщик" stroke="hsl(var(--warning))" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[220px] grid place-items-center text-muted-foreground text-sm">Нет данных</div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>История проверок</CardTitle>
            <CardDescription>Последние 20 проверок</CardDescription>
          </CardHeader>
          <CardContent>
            {checks.length === 0 ? (
              <div className="text-muted-foreground text-sm py-6 text-center">Здесь появится история</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Запрос</TableHead>
                    <TableHead>Точка</TableHead>
                    <TableHead className="text-right">Карты</TableHead>
                    <TableHead className="text-right">Колдунщик</TableHead>
                    <TableHead>Статус</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {checks.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{new Date(c.checked_at).toLocaleString("ru-RU")}</TableCell>
                      <TableCell>{c.keywords?.keyword}</TableCell>
                      <TableCell>{c.geopoints?.label}</TableCell>
                      <TableCell className="text-right font-medium">
                        {c.maps_position ?? c.position ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {c.wizard_position
                          ? <>#{c.wizard_position}{c.wizard_total ? <span className="text-muted-foreground">/{c.wizard_total}</span> : null}</>
                          : c.wizard_exists === false
                            ? <span className="text-muted-foreground text-xs">нет блока</span>
                            : c.wizard_exists
                              ? <span className="text-muted-foreground text-xs">не в блоке</span>
                              : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell><StatusBadge check={c} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Запустить проверку</DialogTitle>
            <DialogDescription>Выберите ключевое слово и гео-точку. Проверим Карты и колдунщик.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={selKw} onValueChange={setSelKw}>
              <SelectTrigger><SelectValue placeholder="Ключевое слово" /></SelectTrigger>
              <SelectContent>
                {keywords.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.keyword}{k.frequency != null ? ` · ${k.frequency.toLocaleString("ru-RU")}/мес` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selGp} onValueChange={setSelGp}>
              <SelectTrigger><SelectValue placeholder="Гео-точка" /></SelectTrigger>
              <SelectContent>
                {geopoints.map((g) => <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={runCheck} disabled={running || !selKw || !selGp}>
              {running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Постановка...</> : "Проверить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
