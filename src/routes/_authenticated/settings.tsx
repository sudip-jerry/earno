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
import { ChevronLeft, HelpCircle, CheckCircle2, XCircle, LogOut, Zap, AlertTriangle } from "lucide-react";
import { useTheme, type ThemeMode } from "@/hooks/use-theme";
import { useStrictness, STRICTNESS_PRESETS, type Strictness } from "@/hooks/use-strictness";
import { useCurrency, CURRENCY_OPTIONS, CURRENCY_SYMBOL, type CurrencyCode } from "@/hooks/use-currency";

function CurrencyControl() {
  const { code, setCurrency, isUpdating } = useCurrency();
  return (
    <div className="grid grid-cols-4 gap-1.5 rounded-lg bg-muted p-1">
      {CURRENCY_OPTIONS.map((c: CurrencyCode) => {
        const active = code === c;
        return (
          <button
            key={c}
            type="button"
            disabled={isUpdating}
            onClick={() => setCurrency(c)}
            className={`h-9 rounded-md text-xs font-medium transition ${
              active ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="mr-1">{CURRENCY_SYMBOL[c].trim()}</span>
            {c}
          </button>
        );
      })}
    </div>
  );
}

function StrictnessControl() {
  const { strictness, setStrictness } = useStrictness();
  const keys: Strictness[] = ["less", "moderate", "strict"];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-muted p-1">
        {keys.map((k) => {
          const p = STRICTNESS_PRESETS[k];
          const active = strictness === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setStrictness(k)}
              className={`h-9 rounded-md text-xs font-medium transition ${
                active ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
              <span className="ml-1 text-[10px] opacity-70">({p.autoConf}%)</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">{STRICTNESS_PRESETS[strictness].description}</p>
    </div>
  );
}

function ThemeSelect() {
  const { theme, setTheme } = useTheme();
  return (
    <Select value={theme} onValueChange={(v) => setTheme(v as ThemeMode)}>
      <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="light">Light</SelectItem>
        <SelectItem value="dark">Dark</SelectItem>
        <SelectItem value="system">System</SelectItem>
      </SelectContent>
    </Select>
  );
}

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
  mode: "paper" | "live";
  ema_fast: number;
  ema_slow: number;
  timeframe: "1m" | "3m" | "5m" | "15m" | "1h" | "4h";
  leverage: number;
  take_profit_pct: number;
  stop_loss_pct: number;
  trailing_enabled: boolean;
  risk_per_trade_pct: number;
  max_open_positions: number;
  daily_loss_cap_pct: number;
  allow_short: boolean;
  auto_book: boolean;
  strategy: "vwap_pullback" | "momentum_breakout";
  cooldown_minutes: number;
  max_trades_per_day: number;
  auto_close_minutes: number;
  move_to_breakeven: boolean;
  min_scalp_score: number;
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
          "mode,ema_fast,ema_slow,timeframe,leverage,take_profit_pct,stop_loss_pct,trailing_enabled,risk_per_trade_pct,max_open_positions,daily_loss_cap_pct,allow_short,auto_book,strategy,cooldown_minutes,max_trades_per_day,auto_close_minutes,move_to_breakeven,min_scalp_score",
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

      {/* Auto Book */}
      <section className="px-5 mt-6">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
          <Zap className="size-3" /> Auto Book
        </h2>
        <div className="rounded-2xl border bg-card divide-y">
          <Row label="Auto-book trades">
            <Switch
              checked={c?.auto_book ?? false}
              onCheckedChange={(v) => updCfg.mutate({ auto_book: v })}
            />
          </Row>
          <Row label="Mode">
            <Select
              value={c?.mode ?? "paper"}
              onValueChange={(v) => {
                if (v === "live" && !confirm("Switch to LIVE? Real funds will be used.")) return;
                updCfg.mutate({ mode: v as "paper" | "live" });
              }}
            >
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="paper">Paper</SelectItem>
                <SelectItem value="live">Live</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Strategy">
            <Select
              value={c?.strategy ?? "vwap_pullback"}
              onValueChange={(v) => updCfg.mutate({ strategy: v as Cfg["strategy"] })}
            >
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="vwap_pullback">VWAP Pullback</SelectItem>
                <SelectItem value="momentum_breakout">Momentum Breakout</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Timeframe">
            <Select
              value={c?.timeframe ?? "5m"}
              onValueChange={(v) => updCfg.mutate({ timeframe: v as Cfg["timeframe"] })}
            >
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1m">1m</SelectItem>
                <SelectItem value="3m">3m</SelectItem>
                <SelectItem value="5m">5m</SelectItem>
                <SelectItem value="15m">15m</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Allow shorts">
            <Switch
              checked={c?.allow_short ?? true}
              onCheckedChange={(v) => updCfg.mutate({ allow_short: v })}
            />
          </Row>
          <Row label="Move SL to breakeven">
            <Switch
              checked={c?.move_to_breakeven ?? true}
              onCheckedChange={(v) => updCfg.mutate({ move_to_breakeven: v })}
            />
          </Row>
        </div>

        {c?.mode === "live" ? (
          <div className="mt-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-3 flex gap-2 text-xs text-destructive">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <p>
              Live mode places real futures trades. Use only after paper testing. A working CoinDCX
              API key with Futures permissions is required.
            </p>
          </div>
        ) : null}
      </section>

      {/* Strategy params */}
      <section className="px-5 mt-6">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Strategy params
        </h2>
        <div className="rounded-2xl border bg-card divide-y">
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
          <Row label="Min Scalp Score">
            <NumberStepper
              value={c?.min_scalp_score ?? 50}
              min={0}
              max={100}
              onChange={(v) => updCfg.mutate({ min_scalp_score: v })}
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
            label="Max trades/day"
            unit=""
            min={1}
            max={50}
            step={1}
            value={c?.max_trades_per_day ?? 10}
            onCommit={(v) => updCfg.mutate({ max_trades_per_day: v })}
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
          <SliderField
            label="Cooldown after loss"
            unit=" min"
            min={0}
            max={120}
            step={5}
            value={c?.cooldown_minutes ?? 15}
            onCommit={(v) => updCfg.mutate({ cooldown_minutes: v })}
          />
          <SliderField
            label="Auto-close after"
            unit=" min"
            min={1}
            max={240}
            step={1}
            value={c?.auto_close_minutes ?? 30}
            onCommit={(v) => updCfg.mutate({ auto_close_minutes: v })}
          />
        </div>
      </section>

      <section className="px-5 mt-6">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Recommendation strictness
        </h2>
        <div className="rounded-2xl border bg-card p-4">
          <StrictnessControl />
        </div>
      </section>

      <section className="px-5 mt-6">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Display currency
        </h2>
        <div className="rounded-2xl border bg-card p-4">
          <CurrencyControl />
          <p className="text-[11px] text-muted-foreground mt-2">
            All money values across the app render in this currency. Coin prices stay in USDT.
          </p>
        </div>
      </section>

      <section className="px-5 mt-6">
        <h2 className="text-sm font-semibold mb-2">Appearance</h2>

        <div className="rounded-xl border bg-card p-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Theme</div>
            <div className="text-xs text-muted-foreground">Choice is saved on this device.</div>
          </div>
          <ThemeSelect />
        </div>
      </section>




      <section className="px-5 mt-8 space-y-2">
        <Link to="/about" className="block rounded-xl border bg-card p-3 text-sm hover:bg-muted">
          About EarnO
        </Link>
        <Link to="/terms" className="block rounded-xl border bg-card p-3 text-sm hover:bg-muted">
          Terms & Disclaimer
        </Link>
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
