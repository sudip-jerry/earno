import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  saveCredentials,
  getCredentialStatus,
  testConnection,
  updateConfig,
  getWalletBalances,
} from "@/lib/bot.functions";
import { getMyEntitlements } from "@/lib/plans.functions";
import { PLAN_NAME, type PlanTier } from "@/lib/plans";
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
import {
  ChevronLeft,
  HelpCircle,
  CheckCircle2,
  XCircle,
  LogOut,
  Zap,
  AlertTriangle,
  Save,
  RotateCcw,
  ShieldCheck,
  Crown,
  Sparkles,
  Rocket,
  ChevronRight,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { useTheme, type ThemeMode } from "@/hooks/use-theme";
import { useStrictness, STRICTNESS_PRESETS, type Strictness } from "@/hooks/use-strictness";
import { useCurrency, CURRENCY_OPTIONS, CURRENCY_SYMBOL, type CurrencyCode } from "@/hooks/use-currency";
import { STYLE_PRESETS, type TradingStyle } from "@/lib/risk-engine";

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
  const updateFn = useServerFn(updateConfig);
  const qc = useQueryClient();
  const keys: Strictness[] = ["less", "moderate", "strict"];

  const presetPatch = (k: Strictness) => {
    const p = STRICTNESS_PRESETS[k];
    // Reset auto-tunable fields back to sane defaults for the chosen strictness.
    return {
      auto_book_confidence_threshold: p.autoConf,
      max_trades_per_day: 50,
      cooldown_minutes: k === "strict" ? 30 : k === "moderate" ? 20 : 15,
      risk_per_trade_pct: k === "strict" ? 0.75 : 1,
      symbol_blacklist_threshold: 3,
      symbol_sl_cooldown_minutes: 180,
    } as Record<string, unknown>;
  };

  const handleChange = async (k: Strictness) => {
    setStrictness(k);
    try {
      await updateFn({ data: { auto_book_confidence_threshold: STRICTNESS_PRESETS[k].autoConf } as never });
      toast.success(`Auto-book threshold set to ${STRICTNESS_PRESETS[k].autoConf}%`);
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update threshold");
    }
  };

  const handleReset = async () => {
    try {
      await updateFn({ data: presetPatch(strictness) as never });
      toast.success(`Reset auto-tuned values to "${STRICTNESS_PRESETS[strictness].label}"`);
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    }
  };

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
              onClick={() => handleChange(k)}
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
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground flex-1">
          {STRICTNESS_PRESETS[strictness].description}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleReset}
          className="h-7 px-2 text-[11px] gap-1 shrink-0"
        >
          <RotateCcw className="w-3 h-3" />
          Reset auto-tuned
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground/70">
        Resets threshold, trades/day, cooldown, risk %, and blacklist back to "{STRICTNESS_PRESETS[strictness].label}" defaults — undoes any tightening from Earno's auto-tune.
      </p>
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
      { title: "Settings — Earn'O" },
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
  trading_style: "conservative" | "balanced" | "aggressive";
  min_sl_pct: number;
  atr_multiplier: number;
  max_auto_sl_pct: number;
  target_multiplier: number;
  min_rr: number;
  live_wallet_source: "futures" | "spot";
  live_allocation_mode: "full" | "amount" | "percent";
  live_allocation_amount: number;
  live_allocation_pct: number;
  symbol_blocklist: string[];
};

const DEFAULTS: Cfg = {
  mode: "paper",
  ema_fast: 9,
  ema_slow: 21,
  timeframe: "5m",
  leverage: 2,
  take_profit_pct: 3,
  stop_loss_pct: 1.5,
  trailing_enabled: true,
  risk_per_trade_pct: 1,
  max_open_positions: 2,
  daily_loss_cap_pct: 3,
  allow_short: true,
  auto_book: false,
  strategy: "vwap_pullback",
  cooldown_minutes: 15,
  max_trades_per_day: 50,
  auto_close_minutes: 30,
  move_to_breakeven: true,
  min_scalp_score: 50,
  trading_style: "balanced",
  min_sl_pct: 1.2,
  atr_multiplier: 1.5,
  max_auto_sl_pct: 4,
  target_multiplier: 1.7,
  min_rr: 1.5,
  live_wallet_source: "futures",
  live_allocation_mode: "amount",
  live_allocation_amount: 0,
  live_allocation_pct: 100,
};


function SettingsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const saveFn = useServerFn(saveCredentials);
  const statusFn = useServerFn(getCredentialStatus);
  const testFn = useServerFn(testConnection);
  const updateFn = useServerFn(updateConfig);
  const walletsFn = useServerFn(getWalletBalances);
  const entFn = useServerFn(getMyEntitlements);
  const { theme, setTheme } = useTheme();

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [pending, setPending] = useState<Partial<Cfg>>({});

  const status = useQuery({
    queryKey: ["cred_status"],
    queryFn: () => statusFn({ data: undefined }),
  });

  const ent = useQuery({ queryKey: ["entitlements"], queryFn: () => entFn() });
  const tier: PlanTier = ent.data?.tier ?? "free";
  const isAdmin = !!ent.data?.isAdmin;

  const profile = useQuery({
    queryKey: ["my_profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("display_name,email")
        .eq("id", u.user.id)
        .maybeSingle();
      return {
        display_name: (data?.display_name as string | null) ?? (u.user.user_metadata?.full_name as string | undefined) ?? null,
        email: (data?.email as string | null) ?? u.user.email ?? null,
        avatar_url: (u.user.user_metadata?.avatar_url as string | undefined) ?? null,
      };
    },
  });

  const cfg = useQuery({
    queryKey: ["bot_config_full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_config")
        .select(
          "mode,ema_fast,ema_slow,timeframe,leverage,take_profit_pct,stop_loss_pct,trailing_enabled,risk_per_trade_pct,max_open_positions,daily_loss_cap_pct,allow_short,auto_book,strategy,cooldown_minutes,max_trades_per_day,auto_close_minutes,move_to_breakeven,min_scalp_score,trading_style,min_sl_pct,atr_multiplier,max_auto_sl_pct,target_multiplier,min_rr,live_wallet_source,live_allocation_mode,live_allocation_amount,live_allocation_pct",
        )
        .maybeSingle();
      if (error) throw error;
      return data as Cfg | null;
    },
  });

  const c = cfg.data;

  const get = <K extends keyof Cfg>(k: K): Cfg[K] =>
    (pending[k] ?? c?.[k] ?? DEFAULTS[k]) as Cfg[K];

  const set = <K extends keyof Cfg>(k: K, v: Cfg[K]) =>
    setPending((p) => ({ ...p, [k]: v }));

  const hasChanges = Object.keys(pending).length > 0;

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot_config_full"] });
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    localStorage.removeItem("earno_remember_me");
    localStorage.removeItem("earno_remember_me_until");
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

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

      {/* Account section — Profile, plan, admin, help, appearance */}
      <section className="px-5">
        <div className="rounded-2xl border bg-card overflow-hidden">
          {/* Profile row */}
          <div className="flex items-center gap-3 p-4">
            <div className="size-11 rounded-full bg-primary/10 text-primary grid place-items-center font-semibold overflow-hidden shrink-0">
              {profile.data?.avatar_url ? (
                <img src={profile.data.avatar_url} alt="" className="size-full object-cover" />
              ) : (
                (profile.data?.display_name?.[0] ?? profile.data?.email?.[0] ?? "U").toUpperCase()
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{profile.data?.display_name ?? "Welcome"}</p>
              <p className="text-[11px] text-muted-foreground truncate">{profile.data?.email ?? ""}</p>
            </div>
            <span className={`text-[10px] px-2 h-5 inline-flex items-center rounded-full font-medium shrink-0 ${
              tier === "unlimited" ? "bg-primary text-primary-foreground" :
              tier === "auto5" ? "bg-primary/10 text-primary" :
              "bg-muted text-muted-foreground"
            }`}>
              {PLAN_NAME[tier]}
            </span>
          </div>

          <div className="border-t divide-y">
            <AccountRow
              to="/upgrade"
              icon={tier === "unlimited" ? <Crown className="size-4 text-primary" /> : <Sparkles className="size-4 text-primary" />}
              label={"Plan & Upgrade"}
              hint={tier === "unlimited" ? "You're on Unlimited" : tier === "auto5" ? "Auto-Trader plan" : "Free plan — upgrade for auto-trading"}
            />
            {isAdmin && (
              <AccountRow
                to="/admin"
                icon={<ShieldCheck className="size-4 text-primary" />}
                label="Admin"
                hint="Manage users, plans, app settings"
              />
            )}
            <AccountRow
              to="/help"
              icon={<HelpCircle className="size-4 text-muted-foreground" />}
              label={"Help & Support"}
              hint="FAQs and how-to guides"
            />
            <AccountRow
              to="/about"
              icon={<Rocket className="size-4 text-muted-foreground" />}
              label="About earn'O"
              hint="What we do and how the bot works"
            />
            <div className="flex items-center gap-3 p-4">
              <div className="size-8 rounded-full bg-muted grid place-items-center shrink-0">
                {theme === "dark" ? <Moon className="size-4" /> : theme === "light" ? <Sun className="size-4" /> : <Monitor className="size-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Appearance</p>
                <p className="text-[11px] text-muted-foreground">Light, dark, or follow system</p>
              </div>
              <Select value={theme} onValueChange={(v) => setTheme(v as ThemeMode)}>
                <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </section>



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
              checked={get("auto_book")}
              onCheckedChange={(v) => set("auto_book", v)}
            />
          </Row>
          <Row label="Mode">
            <Select
              value={get("mode")}
              onValueChange={(v) => {
                if (v === "live" && !confirm("Switch to LIVE? Real funds will be used.")) return;
                set("mode", v as "paper" | "live");
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
              value={get("strategy")}
              onValueChange={(v) => set("strategy", v as Cfg["strategy"])}
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
              value={get("timeframe")}
              onValueChange={(v) => set("timeframe", v as Cfg["timeframe"])}
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
              checked={get("allow_short")}
              onCheckedChange={(v) => set("allow_short", v)}
            />
          </Row>
          <Row label="Move SL to breakeven">
            <Switch
              checked={get("move_to_breakeven")}
              onCheckedChange={(v) => set("move_to_breakeven", v)}
            />
          </Row>
        </div>

        {get("mode") === "live" ? (
          <>
            <div className="mt-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-3 flex gap-2 text-xs text-destructive">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <p>
                Live mode places real futures trades. Use only after paper testing. A working CoinDCX
                API key with Futures permissions is required.
              </p>
            </div>
            <LiveFunding
              walletsFn={walletsFn}
              source={get("live_wallet_source")}
              mode={get("live_allocation_mode")}
              amount={get("live_allocation_amount")}
              pct={get("live_allocation_pct")}
              setSource={(v) => set("live_wallet_source", v)}
              setMode={(v) => set("live_allocation_mode", v)}
              setAmount={(v) => set("live_allocation_amount", v)}
              setPct={(v) => set("live_allocation_pct", v)}
              hasCreds={!!status.data?.hasCredentials}
            />
          </>
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
              value={get("ema_fast")}
              min={2}
              max={50}
              onChange={(v) => set("ema_fast", v)}
            />
          </Row>
          <Row label="EMA slow">
            <NumberStepper
              value={get("ema_slow")}
              min={5}
              max={200}
              onChange={(v) => set("ema_slow", v)}
            />
          </Row>
          <Row label="Minimum Confidence">
            <NumberStepper
              value={get("min_scalp_score")}
              min={0}
              max={100}
              onChange={(v) => set("min_scalp_score", v)}
            />
          </Row>
        </div>
      </section>

      {/* Trading Style preset */}
      <section className="px-5 mt-6">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Trading Style
        </h2>
        <div className="grid grid-cols-1 gap-2">
          {(Object.keys(STYLE_PRESETS) as TradingStyle[]).map((k) => {
            const p = STYLE_PRESETS[k];
            const active = get("trading_style") === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  set("trading_style", k);
                  set("risk_per_trade_pct", p.riskPct);
                  set("min_sl_pct", p.minSL);
                  set("atr_multiplier", p.atrMult);
                  set("max_auto_sl_pct", p.maxAutoSL);
                  set("target_multiplier", p.targetMult);
                  set("min_rr", p.minRR);
                }}
                className={`text-left rounded-2xl border bg-card p-3 transition ${
                  active ? "border-primary ring-2 ring-primary/30" : "hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">{p.label}</p>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Risk {p.riskPct}% · Max SL {p.maxAutoSL}%
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">{p.description}</p>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
          Wider stops reduce noise exits but require smaller position sizes. Risk per trade
          controls the maximum money lost if stop loss is hit.
        </p>
      </section>

      {/* Advanced risk settings (collapsed by default) */}
      <section className="px-5 mt-6">
        <details className="rounded-2xl border bg-card overflow-hidden group">
          <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between text-sm font-medium">
            <span>Advanced settings</span>
            <span className="text-[11px] text-muted-foreground group-open:hidden">Show</span>
            <span className="text-[11px] text-muted-foreground hidden group-open:inline">Hide</span>
          </summary>
          <div className="px-4 pb-4 pt-1 space-y-5">
            <SliderField
              label="Minimum SL"
              unit="%"
              min={0.5}
              max={5}
              step={0.1}
              value={get("min_sl_pct")}
              onChange={(v) => set("min_sl_pct", v)}
            />
            <SliderField
              label="ATR Multiplier"
              unit="x"
              min={0.5}
              max={4}
              step={0.1}
              value={get("atr_multiplier")}
              onChange={(v) => set("atr_multiplier", v)}
            />
            <SliderField
              label="Maximum Auto-book SL"
              unit="%"
              min={1}
              max={10}
              step={0.5}
              value={get("max_auto_sl_pct")}
              onChange={(v) => set("max_auto_sl_pct", v)}
            />
            <SliderField
              label="Risk per Trade"
              unit="%"
              min={0.25}
              max={3}
              step={0.25}
              value={get("risk_per_trade_pct")}
              onChange={(v) => set("risk_per_trade_pct", v)}
            />
            <p className="text-[11px] text-muted-foreground -mt-2">
              Risk per trade controls the maximum money lost if stop loss is hit.
            </p>
            <SliderField
              label="Target Multiplier"
              unit="x"
              min={1}
              max={4}
              step={0.1}
              value={get("target_multiplier")}
              onChange={(v) => set("target_multiplier", v)}
            />
            <SliderField
              label="Minimum Risk-Reward"
              unit=" : 1"
              min={1}
              max={4}
              step={0.1}
              value={get("min_rr")}
              onChange={(v) => set("min_rr", v)}
            />
            <SliderField
              label="Daily Loss Cap"
              unit="%"
              min={1}
              max={20}
              step={1}
              value={get("daily_loss_cap_pct")}
              onChange={(v) => set("daily_loss_cap_pct", v)}
            />
            <SliderField
              label="Max Open Positions"
              unit=""
              min={1}
              max={5}
              step={1}
              value={get("max_open_positions")}
              onChange={(v) => set("max_open_positions", v)}
            />
            <SliderField
              label="Cooldown After Loss"
              unit=" min"
              min={0}
              max={120}
              step={5}
              value={get("cooldown_minutes")}
              onChange={(v) => set("cooldown_minutes", v)}
            />
            <SliderField
              label="Max trades/day"
              unit=""
              min={1}
              max={50}
              step={1}
              value={get("max_trades_per_day")}
              onChange={(v) => set("max_trades_per_day", v)}
            />
            <SliderField
              label="Auto-close after"
              unit=" min"
              min={1}
              max={240}
              step={1}
              value={get("auto_close_minutes")}
              onChange={(v) => set("auto_close_minutes", v)}
            />
            <SliderField
              label="Leverage"
              unit="x"
              min={2}
              max={5}
              step={1}
              value={get("leverage")}
              onChange={(v) => set("leverage", v)}
            />
            <Row label="Trailing stop" inset={false}>
              <Switch
                checked={get("trailing_enabled")}
                onCheckedChange={(v) => set("trailing_enabled", v)}
              />
            </Row>
          </div>
        </details>
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




      {hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 p-4 flex gap-3 z-50 safe-area-pb">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setPending({})}
            disabled={updCfg.isPending}
          >
            <RotateCcw className="size-4 mr-2" />
            Reset
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              updCfg.mutate(pending, {
                onSuccess: () => setPending({}),
              });
            }}
            disabled={updCfg.isPending}
          >
            <Save className="size-4 mr-2" />
            Save changes
          </Button>
        </div>
      )}

      <section className="px-5 mt-8 space-y-2">
        <Link to="/about" className="block rounded-xl border bg-card p-3 text-sm hover:bg-muted">
          About Earn'O
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

function LiveFunding({
  walletsFn,
  source,
  mode,
  amount,
  pct,
  setSource,
  setMode,
  setAmount,
  setPct,
  hasCreds,
}: {
  walletsFn: () => Promise<{ ok: true; spot: number; futures: number; spotError: string | null; futuresError: string | null } | { ok: false; error: string }>;
  source: "futures" | "spot";
  mode: "full" | "amount" | "percent";
  amount: number;
  pct: number;
  setSource: (v: "futures" | "spot") => void;
  setMode: (v: "full" | "amount" | "percent") => void;
  setAmount: (v: number) => void;
  setPct: (v: number) => void;
  hasCreds: boolean;
}) {
  const wallets = useQuery({
    queryKey: ["wallet_balances"],
    queryFn: () => walletsFn(),
    enabled: hasCreds,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const available =
    wallets.data && wallets.data.ok
      ? source === "futures"
        ? wallets.data.futures
        : wallets.data.spot
      : 0;
  const allocated =
    mode === "full"
      ? available
      : mode === "percent"
        ? Math.max(0, (available * pct) / 100)
        : Math.min(amount, available);

  return (
    <div className="mt-3 rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Live funding</h3>
        <button
          type="button"
          onClick={() => wallets.refetch()}
          className="text-[11px] text-muted-foreground hover:text-foreground"
          disabled={!hasCreds || wallets.isFetching}
        >
          {wallets.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div>
        <Label className="text-xs">Fund from wallet</Label>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5 rounded-lg bg-muted p-1">
          {(["futures", "spot"] as const).map((w) => {
            const active = source === w;
            const bal = wallets.data?.ok ? (w === "futures" ? wallets.data.futures : wallets.data.spot) : null;
            return (
              <button
                key={w}
                type="button"
                onClick={() => setSource(w)}
                className={`h-12 rounded-md text-xs font-medium transition flex flex-col items-center justify-center ${
                  active ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="capitalize">{w === "futures" ? "Futures wallet" : "Trade wallet"}</span>
                <span className="text-[10px] opacity-70 tabular-nums">
                  {bal != null ? `${bal.toFixed(2)} USDT` : hasCreds ? "—" : "Save API key"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label className="text-xs">Allocation</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <SelectTrigger className="w-full mt-1.5"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="full">Use full wallet</SelectItem>
            <SelectItem value="amount">Fixed USDT amount</SelectItem>
            <SelectItem value="percent">% of wallet</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "amount" ? (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label htmlFor="alloc-amt" className="text-xs">Amount (USDT)</Label>
            {available > 0 ? (
              <button
                type="button"
                onClick={() => setAmount(Number(available.toFixed(2)))}
                className="text-[11px] text-primary hover:underline"
              >
                Use available ({available.toFixed(2)})
              </button>
            ) : null}
          </div>
          <Input
            id="alloc-amt"
            type="number"
            min={0}
            step={1}
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
      ) : null}

      {mode === "percent" ? (
        <div>
          <div className="flex justify-between items-baseline mb-2">
            <Label className="text-xs">% of wallet</Label>
            <span className="text-sm font-medium tabular-nums">{pct}%</span>
          </div>
          <Slider min={1} max={100} step={1} value={[pct]} onValueChange={(v) => setPct(v[0]!)} />
        </div>
      ) : null}

      <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Available</span>
          <span className="tabular-nums">{available.toFixed(2)} USDT</span>
        </div>
        <div className="flex justify-between font-medium">
          <span>Bot will use</span>
          <span className="tabular-nums">{allocated.toFixed(2)} USDT</span>
        </div>
        {mode === "amount" && amount > available && available > 0 ? (
          <p className="text-destructive text-[11px]">
            Amount exceeds available balance — bot will cap at {available.toFixed(2)} USDT.
          </p>
        ) : null}
        {!hasCreds ? (
          <p className="text-muted-foreground text-[11px]">Save your CoinDCX API key above to see live balances.</p>
        ) : null}
        {wallets.data && !wallets.data.ok ? (
          <p className="text-destructive text-[11px]">{wallets.data.error}</p>
        ) : null}
      </div>
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
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
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
        onValueCommit={(v) => onChange(v[0]!)}
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

function AccountRow({
  to,
  icon,
  label,
  hint,
}: {
  to: "/upgrade" | "/admin" | "/help" | "/about";
  icon: React.ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <Link to={to} className="flex items-center gap-3 p-4 hover:bg-muted/40 transition">
      <div className="size-8 rounded-full bg-muted grid place-items-center shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="text-[11px] text-muted-foreground truncate">{hint}</p> : null}
      </div>
      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
