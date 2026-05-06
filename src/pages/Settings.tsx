import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Plus, X, MapPin, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import MapPicker from "@/components/MapPicker";

const MAX_GP = 3;

type KeywordRow = {
  id: string;
  keyword: string;
  frequency: number | null;
  frequency_status: string | null;
  frequency_at: string | null;
};

export default function Settings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [geopoints, setGeopoints] = useState<{ id: string; label: string; lat: number; lon: number }[]>([]);
  const [kwInput, setKwInput] = useState("");
  const [gpLabel, setGpLabel] = useState("");
  const [gpLat, setGpLat] = useState(55.7558);
  const [gpLon, setGpLon] = useState(37.6176);
  const [refreshingAll, setRefreshingAll] = useState(false);

  const load = async () => {
    const { data: orgs } = await supabase.from("organizations").select("*").limit(1);
    if (!orgs || orgs.length === 0) return navigate("/onboarding");
    const o = orgs[0];
    setOrgId(o.id);
    setOrgName(o.name);
    if (o.lat && o.lon) { setGpLat(o.lat); setGpLon(o.lon); }
    const [{ data: kws }, { data: gps }] = await Promise.all([
      supabase.from("keywords")
        .select("id, keyword, frequency, frequency_status, frequency_at")
        .eq("org_id", o.id),
      supabase.from("geopoints").select("id, label, lat, lon").eq("org_id", o.id),
    ]);
    setKeywords((kws as KeywordRow[]) ?? []);
    setGeopoints(gps ?? []);
  };
  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

  // Realtime: pick up frequency updates from worker
  useEffect(() => {
    if (!orgId) return;
    const ch = supabase
      .channel(`kw-${orgId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "keywords", filter: `org_id=eq.${orgId}` },
        (payload) => {
          const u = payload.new as KeywordRow;
          setKeywords((prev) => prev.map((k) => (k.id === u.id ? { ...k, ...u } : k)));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orgId]);

  const enqueueFreq = async (ids: string[]) => {
    if (ids.length === 0) return;
    await supabase.functions.invoke("enqueue-wordstat", { body: { keyword_ids: ids } });
  };

  const refreshAll = async () => {
    if (keywords.length === 0) return;
    setRefreshingAll(true);
    setKeywords((prev) => prev.map((k) => ({ ...k, frequency_status: "pending" })));
    await enqueueFreq(keywords.map((k) => k.id));
    setRefreshingAll(false);
    toast.success("Поставлено в очередь");
  };

  const addKw = async () => {
    if (!orgId || !user || !kwInput.trim()) return;
    const { data, error } = await supabase
      .from("keywords")
      .insert({ org_id: orgId, user_id: user.id, keyword: kwInput.trim() })
      .select("id, keyword, frequency, frequency_status, frequency_at").single();
    if (error) return toast.error(error.message);
    setKeywords([...keywords, data as KeywordRow]);
    setKwInput("");
    enqueueFreq([data.id]);
  };
  const delKw = async (id: string) => {
    const { error } = await supabase.from("keywords").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setKeywords(keywords.filter((k) => k.id !== id));
  };

  const addGp = async () => {
    if (!orgId || !user || !gpLabel.trim()) return;
    if (geopoints.length >= MAX_GP) return toast.error(`Максимум ${MAX_GP}`);
    const { data, error } = await supabase
      .from("geopoints")
      .insert({ org_id: orgId, user_id: user.id, label: gpLabel.trim(), lat: gpLat, lon: gpLon })
      .select("id, label, lat, lon").single();
    if (error) return toast.error(error.message);
    setGeopoints([...geopoints, data]);
    setGpLabel("");
  };
  const delGp = async (id: string) => {
    const { error } = await supabase.from("geopoints").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setGeopoints(geopoints.filter((g) => g.id !== id));
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild><Link to="/"><ArrowLeft className="h-4 w-4 mr-2" />Назад</Link></Button>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-accent grid place-items-center">
              <MapPin className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">Настройки</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Карточка</CardTitle>
            <CardDescription>{orgName}</CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
            <div>
              <CardTitle>Ключевые запросы</CardTitle>
              <CardDescription>Без ограничения. Частотность по региону карточки.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={refreshAll}
              disabled={refreshingAll || keywords.length === 0}>
              <RefreshCw className={`h-4 w-4 mr-1 ${refreshingAll ? "animate-spin" : ""}`} />
              Обновить частотности
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input value={kwInput} onChange={(e) => setKwInput(e.target.value)} placeholder="новый запрос"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKw())} />
              <Button onClick={addKw}><Plus className="h-4 w-4" /></Button>
            </div>
            {keywords.map((k) => (
              <div key={k.id} className="flex items-center justify-between bg-muted px-3 py-2 rounded-lg gap-2">
                <span className="flex-1 truncate">{k.keyword}</span>
                <FrequencyBadge k={k} onRefresh={() => enqueueFreq([k.id])} />
                <button onClick={() => delKw(k.id)}><X className="h-4 w-4 text-muted-foreground" /></button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Гео-точки</CardTitle>
            <CardDescription>До {MAX_GP}. Перетащите маркер или кликните по карте.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid sm:grid-cols-3 gap-2">
              <Input value={gpLabel} onChange={(e) => setGpLabel(e.target.value)} placeholder="Название" />
              <Input type="number" step="0.0001" value={gpLat} onChange={(e) => setGpLat(parseFloat(e.target.value))} />
              <Input type="number" step="0.0001" value={gpLon} onChange={(e) => setGpLon(parseFloat(e.target.value))} />
            </div>
            <MapPicker
              lat={gpLat} lon={gpLon} draggable
              onChange={(la, lo) => { setGpLat(la); setGpLon(lo); }}
              className="w-full h-72 rounded-lg overflow-hidden border"
            />
            <Button variant="secondary" onClick={addGp} disabled={geopoints.length >= MAX_GP}>
              <Plus className="h-4 w-4 mr-1" />Добавить точку
            </Button>
            {geopoints.map((g) => (
              <div key={g.id} className="flex items-center justify-between bg-muted px-3 py-2 rounded-lg">
                <div>
                  <div className="text-sm font-medium">{g.label}</div>
                  <div className="text-xs text-muted-foreground">{g.lat.toFixed(4)}, {g.lon.toFixed(4)}</div>
                </div>
                <button onClick={() => delGp(g.id)}><X className="h-4 w-4 text-muted-foreground" /></button>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function formatFreq(n: number) {
  return n.toLocaleString("ru-RU");
}

function FrequencyBadge({ k, onRefresh }: { k: KeywordRow; onRefresh: () => void }) {
  const status = k.frequency_status ?? "pending";
  if (status === "pending") {
    return <Badge variant="secondary" className="whitespace-nowrap">считаем…</Badge>;
  }
  if (status === "error") {
    return (
      <button onClick={onRefresh} title="Повторить">
        <Badge variant="destructive" className="whitespace-nowrap cursor-pointer">
          ошибка · повторить
        </Badge>
      </button>
    );
  }
  // ok
  return (
    <button onClick={onRefresh} title="Пересчитать" className="flex items-center gap-1">
      <Badge variant="outline" className="whitespace-nowrap">
        {k.frequency != null ? `${formatFreq(k.frequency)} /мес` : "—"}
      </Badge>
      <RefreshCw className="h-3 w-3 text-muted-foreground" />
    </button>
  );
}

