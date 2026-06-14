import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createChart,
  CandlestickSeries,
  LineStyle,
  ColorType,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
} from "lightweight-charts";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { getChartCandles } from "@/lib/chart.functions";
import { useLivePrices } from "@/hooks/use-live-prices";

type Interval = "1m" | "5m" | "15m";

export type PositionChartProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  openedAt: string;
  /** Open position fields */
  takeProfit?: number | null;
  stopLoss?: number | null;
  /** Closed position fields */
  exitPrice?: number | null;
  closedAt?: string | null;
  exitReason?: string | null;
  healthStatus?: string | null;
  mode?: string | null;
};

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function PositionChartSheet(props: PositionChartProps) {
  const {
    open,
    onOpenChange,
    symbol,
    side,
    entryPrice,
    openedAt,
    takeProfit,
    stopLoss,
    exitPrice,
    closedAt,
    exitReason,
    healthStatus,
    mode,
  } = props;

  const [interval, setInterval] = useState<Interval>("5m");
  const isClosed = !!closedAt;

  const fetchCandles = useServerFn(getChartCandles);
  const candlesQ = useQuery({
    queryKey: ["chart_candles", symbol, interval],
    queryFn: () => fetchCandles({ data: { symbol, interval, limit: 240 } }),
    enabled: open,
    refetchInterval: open && !isClosed ? 15_000 : false,
    staleTime: 10_000,
  });

  // Live mark price for open trades
  const { prices } = useLivePrices(open && !isClosed ? [symbol] : [], open && !isClosed);
  const livePrice = !isClosed ? prices[symbol] : null;
  const currentPrice = livePrice ?? exitPrice ?? null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);

  // Create chart
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const el = containerRef.current;
    const styles = getComputedStyle(document.documentElement);
    const cssVar = (n: string) => styles.getPropertyValue(n).trim();
    const fg = `hsl(${cssVar("--foreground") || "0 0% 95%"})`;
    const muted = `hsl(${cssVar("--muted-foreground") || "0 0% 60%"})`;
    const border = `hsl(${cssVar("--border") || "0 0% 20%"})`;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: muted,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: border, style: LineStyle.Dotted },
        horzLines: { color: border, style: LineStyle.Dotted },
      },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
      handleScale: { axisPressedMouseMove: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "hsl(142 71% 45%)",
      downColor: "hsl(0 84% 60%)",
      borderUpColor: "hsl(142 71% 45%)",
      borderDownColor: "hsl(0 84% 60%)",
      wickUpColor: "hsl(142 71% 45%)",
      wickDownColor: "hsl(0 84% 60%)",
      priceFormat: { type: "price", precision: 6, minMove: 0.000001 },
    });
    chartRef.current = chart;
    seriesRef.current = series;
    void fg;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
    };
  }, [open]);

  // Update candles + lines + markers
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const candles = candlesQ.data?.candles ?? [];
    if (!candles.length) return;
    series.setData(
      candles.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    chart.timeScale().fitContent();

    // Clear old price lines
    for (const l of linesRef.current) {
      try { series.removePriceLine(l); } catch { /* noop */ }
    }
    linesRef.current = [];

    const add = (price: number | null | undefined, color: string, title: string, style = LineStyle.Solid) => {
      if (price == null || !Number.isFinite(Number(price))) return;
      const l = series.createPriceLine({
        price: Number(price),
        color,
        lineWidth: 1,
        lineStyle: style,
        axisLabelVisible: true,
        title,
      });
      linesRef.current.push(l);
    };

    add(entryPrice, "hsl(217 91% 60%)", "Entry");
    if (isClosed) {
      add(exitPrice ?? null, "hsl(38 92% 50%)", "Exit");
    } else {
      add(takeProfit ?? null, "hsl(142 71% 45%)", "Target", LineStyle.Dashed);
      add(stopLoss ?? null, "hsl(0 84% 60%)", "Stop", LineStyle.Dashed);
      if (currentPrice != null) add(currentPrice, "hsl(280 70% 65%)", "Current", LineStyle.Dotted);
    }

    // Markers
    const openedTs = Math.floor(new Date(openedAt).getTime() / 1000);
    const closedTs = closedAt ? Math.floor(new Date(closedAt).getTime() / 1000) : null;
    const firstT = candles[0].time;
    const lastT = candles[candles.length - 1].time;
    const clamp = (t: number) => Math.max(firstT, Math.min(lastT, t));

    const markers: Array<{
      time: Time;
      position: "aboveBar" | "belowBar";
      color: string;
      shape: "arrowUp" | "arrowDown" | "circle";
      text: string;
    }> = [];
    markers.push({
      time: clamp(openedTs) as Time,
      position: side === "long" ? "belowBar" : "aboveBar",
      color: "hsl(217 91% 60%)",
      shape: side === "long" ? "arrowUp" : "arrowDown",
      text: side === "long" ? "Entry L" : "Entry S",
    });
    if (closedTs) {
      markers.push({
        time: clamp(closedTs) as Time,
        position: side === "long" ? "aboveBar" : "belowBar",
        color: "hsl(38 92% 50%)",
        shape: "circle",
        text: "Exit",
      });
    }
    createSeriesMarkers(series, markers);
  }, [candlesQ.data, entryPrice, takeProfit, stopLoss, exitPrice, openedAt, closedAt, side, isClosed, currentPrice]);

  const reasonLabel = useMemo(() => {
    if (!exitReason) return null;
    const map: Record<string, string> = {
      take_profit: "Take Profit",
      stop_loss: "Stop Loss",
      time_exit: "Time Exit",
      trend_invalidated: "Trend Invalidated",
      manual_limit: "Manual Close",
      kill_switch: "Emergency Stop",
      risk_protection: "Risk Protection",
    };
    return map[exitReason] ?? exitReason.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }, [exitReason]);

  const sideCls = side === "long"
    ? "bg-emerald-500/10 text-emerald-500"
    : "bg-destructive/10 text-destructive";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[88svh] p-0 flex flex-col rounded-t-2xl">
        <SheetHeader className="px-5 pt-4 pb-2 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <SheetTitle className="text-base">{symbol}</SheetTitle>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${sideCls}`}>
              {side === "long" ? "Long" : "Short"}
            </span>
            {mode ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                {mode}
              </span>
            ) : null}
            {isClosed ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded border">Closed</span>
            ) : null}
          </div>
          <SheetDescription className="sr-only">
            Price chart with entry, target, stop and current price lines.
          </SheetDescription>
        </SheetHeader>

        <div className="px-5 pt-1 pb-2 flex items-center justify-between gap-2">
          <div className="inline-flex rounded-full border bg-muted p-0.5">
            {(["1m", "5m", "15m"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setInterval(t)}
                className={`px-3 h-7 text-[11px] font-medium rounded-full transition-colors ${
                  interval === t
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {currentPrice != null ? (
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {isClosed ? "Exit" : "Live"}
              </p>
              <p className="text-sm font-semibold tabular-nums">{fmtPrice(currentPrice)}</p>
            </div>
          ) : null}
        </div>

        <div className="relative flex-1 px-2">
          <div ref={containerRef} className="absolute inset-0 px-2 pb-2" />
          {candlesQ.isLoading && !candlesQ.data ? (
            <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
              Loading chart…
            </div>
          ) : null}
          {!candlesQ.isLoading && candlesQ.data && candlesQ.data.candles.length === 0 ? (
            <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
              No candle data available.
            </div>
          ) : null}
        </div>

        <div className="px-5 pt-2 pb-4 border-t bg-card/40">
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <p className="text-muted-foreground">Entry</p>
              <p className="tabular-nums font-medium mt-0.5">{fmtPrice(entryPrice)}</p>
            </div>
            {isClosed ? (
              <div>
                <p className="text-muted-foreground">Exit</p>
                <p className="tabular-nums font-medium mt-0.5">{fmtPrice(exitPrice)}</p>
              </div>
            ) : (
              <div>
                <p className="text-muted-foreground">Target</p>
                <p className="tabular-nums font-medium mt-0.5 text-emerald-500">{fmtPrice(takeProfit)}</p>
              </div>
            )}
            {isClosed ? (
              <div className="text-right">
                <p className="text-muted-foreground">Close Reason</p>
                <p className="font-medium mt-0.5">{reasonLabel ?? "—"}</p>
              </div>
            ) : (
              <div className="text-right">
                <p className="text-muted-foreground">Stop</p>
                <p className="tabular-nums font-medium mt-0.5 text-destructive">{fmtPrice(stopLoss)}</p>
              </div>
            )}
          </div>
          {healthStatus ? (
            <p className="mt-2 text-[10px] text-muted-foreground">
              Trade health: <span className="text-foreground font-medium">{healthStatus}</span>
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
