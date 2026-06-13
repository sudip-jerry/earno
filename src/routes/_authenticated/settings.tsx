import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  saveCredentials,
  getCredentialStatus,
  testConnection,
  updateConfig,
} from "@/lib/bot.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ChevronLeft, HelpCircle, CheckCircle2, XCircle, LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — EarnO" },
      { name: "description", content: "Configure your CoinDCX API keys, strategy, and risk caps." },
    ],
  }),
  component: SettingsPage,
});

type Cfg = {
  ema_fast: number;
  ema_slow: number;
  timeframe: "5m" | "15m" | "1h" | "4h";
  leverage: number;
  take_profit_pct: number;
  stop_loss_pct: number;
  trailing_enabled: boolean;
  risk_per_trade_pct: number;
  max_open_positions: number;
  daily_loss_cap_pct: number;
  allow_short: boolean;
};

function SettingsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const saveFn = useServerFn(saveCredentials);
  const statusFn = useServerFn(getCredentialStatus);
  const testFn = useServerFn(testConnection);
  const updateFn = useServerFn(updateConfig);

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");

  const status = useQuery({
    queryKey: ["cred_status"],
    queryFn: () => statusFn({ data: undefined }),
  });

  const cfg = useQuery({
    queryKey: ["bot_config_full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_config")
        .select(
          "ema_fast,ema_slow,timeframe,leverage,take_profit_pct,stop_loss_pct,trailing_enabled,risk_per_trade_pct,max_open_positions,daily_loss_cap_pct,allow_short",
        )
        .maybeSingle();
      if (error) throw error;
      return data as Cfg | null;
    },
  });

  const save = useMutation({
    mutationFn: async () => saveFn({ data: { apiKey, apiSecret } }),
    onSuccess: () => {
      toast.success("API keys saved. Testing connection…");
      setApiKey("");
      setApiSecret("");
      qc.invalidateQueries({ queryKey: ["cred_status"] });
      test.mutate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const test = useMutation({
    mutationFn: async () => testFn({ data: undefined }),
    onSuccess: (r) => {
      if (r.ok) toast.success(`Connected. USDT balance: ${r.usdtBalance}`);
      else toast.error(`CoinDCX rejected: ${r.error}`);
      qc.invalidateQueries({ queryKey: ["cred_status"] });
    },
  });

  const updCfg = useMutation({
    mutationFn: async (patch: Partial<Cfg>) => updateFn({ data: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bot_config_full"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    localStorage.removeItem("earno_remember_me");
    localStorage.removeItem("earno_remember_me_until");
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const c = cfg.data;

  return (
    <div className="min-h-svh bg-background pb-12">
      <header className="px-5 pt-6 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/" className="size-9 grid place-items-center rounded-full hover:bg-muted -ml-2">
            <ChevronLeft className="size-5" />
          </Link>
          <h1 className="text-xl font-semibold">Settings</h1>
        </div>
        <Link to="/help" className="size-9 grid place-items-center rounded-full hover:bg-muted">
          <HelpCircle className="size-5 text-muted-foreground" />
        </Link>
      </header>

      {/* CoinDCX credentials */}
      <section className="px-5">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          CoinDCX API
        </h2>
        <div className="rounded-2xl border bg-card p-4">
          {status.data?.hasCredentials ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                {status.data.isValid ? (
                  <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
                ) : (
                  <XCircle className="size-5 text-muted-foreground shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{status.data.keyPreview}</p>
                  <p className="text-xs text-muted-foreground">
                    {status.data.isValid ? "Connected" : "Not verified"}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => test.mutate()}
                disabled={test.isPending}
              >
                Test
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No API key saved yet.</p>
          )}

          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="key" className="text-xs">
                API key
              </Label>
              <Input
                id="key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste CoinDCX API key"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="secret" className="text-xs">
                API secret
              </Label>
              <Input
                id="secret"
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="Paste API secret"
              />
            </div>
            <Button
              className="w-full"
              onClick={() => save.mutate()}
              disabled={save.isPending || !apiKey || !apiSecret}
            >
              Save & test
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Enable <span className="font-medium">Futures</span> permissions on your CoinDCX API
              key. Keys are stored encrypted and never sent to the browser.
            </p>
          </div>
        </div>
      </section>

      {/* Strategy */}
      <section className="px-5 mt-6">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Strategy
        </h2>
        <div className="rounded-2xl border bg-card divide-y">
          <Row label="Timeframe">
            <Select
              value={c?.timeframe ?? "15m"}
              onValueChange={(v) =>
                updCfg.mutate({ timeframe: v as Cfg["timeframe"] })
              }
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5m">5m</SelectItem>
                <SelectItem value="15m">15m</SelectItem>
                <SelectItem value="1h">1h</SelectItem>
                <SelectItem value="4h">4h</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="EMA fast">
            <NumberStepper
              value={c?.ema_fast ?? 9}
              min={2}
              max={50}
              onChange={(v) => updCfg.mutate({ ema_fast: v })}
            />
          </Row>
          <Row label="EMA slow">
            <NumberStepper
              value={c?.ema_slow ?? 21}
              min={5}
              max={200}
              onChange={(v) => updCfg.mutate({ ema_slow: v })}
            />
          </Row>
          <Row label="Allow shorts">
            <Switch
              checked={c?.allow_short ?? true}
              onCheckedChange={(v) => updCfg.mutate({ allow_short: v })}
            />
          </Row>
        </div>
      </section>

      {/* Risk */}
      <section className="px-5 mt-6">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Risk
        </h2>
        <div className="rounded-2xl border bg-card p-4 space-y-5">
          <SliderField
            label="Leverage"
            unit="x"
            min={2}
            max={5}
            step={1}
            value={c?.leverage ?? 3}
            onCommit={(v) => updCfg.mutate({ leverage: v })}
          />
          <SliderField
            label="Take profit"
            unit="%"
            min={0.5}
            max={10}
            step={0.5}
            value={c?.take_profit_pct ?? 3}
            onCommit={(v) => updCfg.mutate({ take_profit_pct: v })}
          />
          <SliderField
            label="Stop loss"
            unit="%"
            min={0.5}
            max={10}
            step={0.5}
            value={c?.stop_loss_pct ?? 2}
            onCommit={(v) => updCfg.mutate({ stop_loss_pct: v })}
          />
          <Row label="Trailing stop" inset={false}>
            <Switch
              checked={c?.trailing_enabled ?? true}
              onCheckedChange={(v) => updCfg.mutate({ trailing_enabled: v })}
            />
          </Row>
          <SliderField
            label="Risk per trade"
            unit="%"
            min={0.5}
            max={5}
            step={0.5}
            value={c?.risk_per_trade_pct ?? 2}
            onCommit={(v) => updCfg.mutate({ risk_per_trade_pct: v })}
          />
          <SliderField
            label="Max open positions"
            unit=""
            min={1}
            max={5}
            step={1}
            value={c?.max_open_positions ?? 3}
            onCommit={(v) => updCfg.mutate({ max_open_positions: v })}
          />
          <SliderField
            label="Daily loss cap"
            unit="%"
            min={1}
            max={20}
            step={1}
            value={c?.daily_loss_cap_pct ?? 6}
            onCommit={(v) => updCfg.mutate({ daily_loss_cap_pct: v })}
          />
        </div>
      </section>

      <section className="px-5 mt-8">
        <Button variant="ghost" className="w-full text-muted-foreground" onClick={signOut}>
          <LogOut className="size-4 mr-2" />
          Sign out
        </Button>
      </section>
    </div>
  );
}

function Row({
  label,
  children,
  inset = true,
}: {
  label: string;
  children: React.ReactNode;
  inset?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${inset ? "px-4 py-3" : ""}`}>
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

function SliderField({
  label,
  unit,
  min,
  max,
  step,
  value,
  onCommit,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(value);
  // Sync when server value changes
  useState(() => setLocal(value));
  return (
    <div>
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-sm">{label}</span>
        <span className="text-sm font-medium tabular-nums">
          {local}
          {unit}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[local]}
        onValueChange={(v) => setLocal(v[0]!)}
        onValueCommit={(v) => onCommit(v[0]!)}
      />
    </div>
  );
}

function NumberStepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        size="icon"
        variant="outline"
        className="size-7"
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </Button>
      <span className="w-8 text-center text-sm tabular-nums">{value}</span>
      <Button
        size="icon"
        variant="outline"
        className="size-7"
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </Button>
    </div>
  );
}
