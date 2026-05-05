import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Search, MapPin, Plus, X } from "lucide-react";
import MapPicker from "@/components/MapPicker";

interface OrgResult {
  name: string;
  address: string;
  yandex_id: string;
  lat: number;
  lon: number;
}

const MAX_KEYWORDS = 3;
const MAX_GEOPOINTS = 3;

export default function Onboarding() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // step 1
  const [mode, setMode] = useState<"search" | "url">("search");
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [orgUrl, setOrgUrl] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<OrgResult[]>([]);
  const [selected, setSelected] = useState<OrgResult | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  // step 2
  const [keywords, setKeywords] = useState<string[]>([]);
  const [kwInput, setKwInput] = useState("");

  // step 3
  const [geoLabel, setGeoLabel] = useState("");
  const [geoLat, setGeoLat] = useState(55.7558);
  const [geoLon, setGeoLon] = useState(37.6176);
  const [geopoints, setGeopoints] = useState<{ label: string; lat: number; lon: number }[]>([]);

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate("/auth", { replace: true });
      return;
    }
    // If user already has an org, skip onboarding
    supabase.from("organizations").select("id").limit(1).then(({ data }) => {
      if (data && data.length > 0) navigate("/", { replace: true });
    });
  }, [user, loading, navigate]);

  const search = async () => {
    const body = mode === "url" ? { url: orgUrl } : { query, city };
    if (mode === "url" ? !orgUrl.trim() : !query.trim()) return;
    setSearching(true);
    const { data, error } = await supabase.functions.invoke("search-org", { body });
    setSearching(false);
    if (error) {
      const msg = (data as any)?.error || error.message || "Неизвестная ошибка";
      toast.error("Ошибка поиска: " + msg);
      return;
    }
    const list = data?.results ?? [];
    setResults(list);
    if (list.length === 1) setSelected(list[0]);
    if (list.length === 0) toast.info("Ничего не найдено");
  };

  const saveOrg = async () => {
    if (!selected || !user) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("organizations")
      .insert({
        user_id: user.id,
        name: selected.name,
        city,
        yandex_id: selected.yandex_id,
        address: selected.address,
        lat: selected.lat,
        lon: selected.lon,
      })
      .select("id, lat, lon")
      .single();
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOrgId(data.id);
    if (data.lat && data.lon) {
      setGeoLat(data.lat);
      setGeoLon(data.lon);
      setGeoLabel(selected.address || selected.name);
    }
    setStep(2);
  };

  const addKw = () => {
    const v = kwInput.trim();
    if (!v) return;
    if (keywords.length >= MAX_KEYWORDS) {
      toast.error(`Максимум ${MAX_KEYWORDS} ключевых слов`);
      return;
    }
    setKeywords([...keywords, v]);
    setKwInput("");
  };

  const addGeopoint = () => {
    if (geopoints.length >= MAX_GEOPOINTS) {
      toast.error(`Максимум ${MAX_GEOPOINTS} гео-точек`);
      return;
    }
    if (!geoLabel.trim()) {
      toast.error("Укажите название точки");
      return;
    }
    setGeopoints([...geopoints, { label: geoLabel, lat: geoLat, lon: geoLon }]);
    setGeoLabel("");
  };

  const finish = async () => {
    if (!orgId || !user) return;
    if (keywords.length === 0) return toast.error("Добавьте хотя бы один ключ");
    if (geopoints.length === 0) return toast.error("Добавьте хотя бы одну гео-точку");
    setBusy(true);
    const { error: kwErr } = await supabase
      .from("keywords")
      .insert(keywords.map((k) => ({ org_id: orgId, user_id: user.id, keyword: k })));
    const { error: gpErr } = await supabase
      .from("geopoints")
      .insert(geopoints.map((g) => ({ org_id: orgId, user_id: user.id, ...g })));
    setBusy(false);
    if (kwErr || gpErr) {
      toast.error((kwErr || gpErr)!.message);
      return;
    }
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary to-accent grid place-items-center">
            <MapPin className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold">MapRank</span>
          <span className="ml-auto text-sm text-muted-foreground">Шаг {step} из 3</span>
        </div>

        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Найдите свою организацию</CardTitle>
              <CardDescription>Введите название и город — мы найдём карточку в Яндекс Бизнесе.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Input
                  className="sm:col-span-2"
                  placeholder="Название (например, Стоматология Улыбка)"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && search()}
                />
                <Input placeholder="Город" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <Button onClick={search} disabled={searching || !query.trim()}>
                {searching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                Найти
              </Button>

              {results.length > 0 && (
                <div className="space-y-2 mt-2">
                  {results.map((r) => (
                    <button
                      key={r.yandex_id}
                      onClick={() => setSelected(r)}
                      className={`w-full text-left p-3 rounded-lg border transition ${
                        selected?.yandex_id === r.yandex_id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      <div className="font-medium">{r.name}</div>
                      <div className="text-sm text-muted-foreground">{r.address}</div>
                    </button>
                  ))}
                </div>
              )}

              <Button className="w-full" disabled={!selected || busy} onClick={saveOrg}>
                Продолжить
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>Ключевые запросы</CardTitle>
              <CardDescription>До {MAX_KEYWORDS} запросов, по которым проверяем позицию.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="например, стоматология рядом"
                  value={kwInput}
                  onChange={(e) => setKwInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKw())}
                />
                <Button onClick={addKw} disabled={keywords.length >= MAX_KEYWORDS}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-2">
                {keywords.map((k, i) => (
                  <div key={i} className="flex items-center justify-between bg-muted px-3 py-2 rounded-lg">
                    <span>{k}</span>
                    <button onClick={() => setKeywords(keywords.filter((_, j) => j !== i))}>
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              </div>
              <Button className="w-full" disabled={keywords.length === 0} onClick={() => setStep(3)}>
                Дальше
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>Гео-точки проверки</CardTitle>
              <CardDescription>До {MAX_GEOPOINTS} точек. Перетащите маркер или кликните по карте.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Название точки</Label>
                  <Input value={geoLabel} onChange={(e) => setGeoLabel(e.target.value)} placeholder="Тверская, 12" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label>Широта</Label>
                    <Input type="number" step="0.0001" value={geoLat} onChange={(e) => setGeoLat(parseFloat(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Долгота</Label>
                    <Input type="number" step="0.0001" value={geoLon} onChange={(e) => setGeoLon(parseFloat(e.target.value))} />
                  </div>
                </div>
              </div>
              <MapPicker
                lat={geoLat}
                lon={geoLon}
                draggable
                onChange={(la, lo) => {
                  setGeoLat(la);
                  setGeoLon(lo);
                }}
                className="w-full h-72 rounded-lg overflow-hidden border"
              />
              <Button variant="secondary" onClick={addGeopoint} disabled={geopoints.length >= MAX_GEOPOINTS}>
                <Plus className="h-4 w-4 mr-1" /> Добавить точку
              </Button>
              <div className="space-y-2">
                {geopoints.map((g, i) => (
                  <div key={i} className="flex items-center justify-between bg-muted px-3 py-2 rounded-lg">
                    <div>
                      <div className="text-sm font-medium">{g.label}</div>
                      <div className="text-xs text-muted-foreground">{g.lat.toFixed(4)}, {g.lon.toFixed(4)}</div>
                    </div>
                    <button onClick={() => setGeopoints(geopoints.filter((_, j) => j !== i))}>
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              </div>
              <Button className="w-full" disabled={busy || keywords.length === 0 || geopoints.length === 0} onClick={finish}>
                {busy ? "Сохранение..." : "Готово"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
