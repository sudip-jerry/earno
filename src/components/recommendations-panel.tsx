import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getMyRecommendations,
  applyMyRecommendations,
  autoApplyCriticalRecommendations,
  type RagStatus,
  type Recommendation,
} from "@/lib/recommendations.functions";

function ragStyles(s: RagStatus) {
  if (s === "red")
    return {
      dot: "bg-red-500",
      pill: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40",
      label: "High",
    };
  if (s === "amber")
    return {
      dot: "bg-amber-500",
      pill: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40",
      label: "Medium",
    };
  return {
    dot: "bg-emerald-500",
    pill: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40",
    label: "Healthy",
  };
}

const AUTO_APPLY_KEY = "earno.autoApplyCritical";

export function RecommendationsPanel() {
  const qc = useQueryClient();
  const getFn = useServerFn(getMyRecommendations);
  const applyFn = useServerFn(applyMyRecommendations);
  const autoApplyFn = useServerFn(autoApplyCriticalRecommendations);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [autoApply, setAutoApply] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem(AUTO_APPLY_KEY);
    return v === null ? true : v === "1";
  });
  // Prevent overlapping auto-apply calls while one is in-flight.
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AUTO_APPLY_KEY, autoApply ? "1" : "0");
    }
  }, [autoApply]);

  const q = useQuery({
    queryKey: ["my_recommendations"],
    queryFn: () => getFn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const apply = useMutation({
    mutationFn: (ids: string[]) => applyFn({ data: { ids } as never }),
    onSuccess: (r: { applied: string[] }) => {
      toast.success(
        `Applied ${r.applied.length} change${r.applied.length === 1 ? "" : "s"}. Next scanner cycle will use them.`,
      );
      setSelected(new Set());
      setExpanded(false);
      qc.invalidateQueries({ queryKey: ["my_recommendations"] });
      qc.invalidateQueries({ queryKey: ["dashboard_stats"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Dynamically auto-apply critical (red) recommendations whenever the bot
  // is running and the user has auto-apply enabled. The server skips writes
  // when the patch would be a no-op against current config, so this is safe
  // to fire on every refetch — it only writes when something actually changes.
  useEffect(() => {
    if (!autoApply) return;
    const data = q.data;
    if (!data || !data.isRunning || data.overall !== "red") return;
    const redKinds = data.recommendations.filter((r) => r.severity === "red").map((r) => r.kind);
    if (redKinds.length === 0) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    autoApplyFn({ data: { kinds: redKinds } as never })
      .then((r: { applied: string[]; skipped?: string }) => {
        if (r.applied.length > 0) {
          toast.warning(
            `Auto-tuned ${r.applied.length} critical setting${r.applied.length === 1 ? "" : "s"}. Recorded in Recent Activity.`,
          );
          qc.invalidateQueries({ queryKey: ["my_recommendations"] });
          qc.invalidateQueries({ queryKey: ["dashboard_stats"] });
        }
      })
      .catch(() => {})
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [q.data, autoApply, autoApplyFn, qc]);

  if (q.isLoading || !q.data) {
    return (
      <section className="mx-5 mt-4">
        <div className="rounded-2xl border bg-card p-3 text-xs text-muted-foreground">
          Checking your settings…
        </div>
      </section>
    );
  }

  const data = q.data;
  const recs = data.recommendations;
  const overall = ragStyles(data.overall);
  const canApply = recs.length > 0 && data.overall !== "green";

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(recs.map((r) => r.id)));
  }

  return (
    <section className="mx-5 mt-4">
      <div className="rounded-2xl border bg-card overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        >
          <span className={`size-2.5 rounded-full ${overall.dot} shrink-0`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="size-3.5 text-primary shrink-0" />
              <p className="text-sm font-semibold truncate">Recommendations</p>
              <span
                className={`text-[10px] font-semibold px-1.5 h-4 inline-flex items-center rounded-full border ${overall.pill} shrink-0`}
              >
                {overall.label}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
              {data.headline}
              {recs.length > 0 && ` · ${recs.length} suggested`}
            </p>
          </div>
          {expanded ? (
            <ChevronUp className="size-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground shrink-0" />
          )}
        </button>

        {expanded && (
          <div className="border-t bg-background/40">
            <div className="flex items-center justify-between px-4 pt-3 pb-1 gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium leading-tight">Auto-apply critical changes</p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                  Dynamic — fires whenever red alerts trigger and the bot is running.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoApply}
                onClick={() => setAutoApply((v) => !v)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  autoApply ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`inline-block size-4 transform rounded-full bg-background shadow transition-transform ${
                    autoApply ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            {recs.length === 0 ? (
              <p className="px-4 py-5 text-xs text-muted-foreground text-center">
                No tuning needed right now. We'll re-check after the next scan.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                    Select changes to apply
                  </p>
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-[11px] text-primary font-medium hover:underline"
                  >
                    Select all
                  </button>
                </div>
                <ul className="px-3 pb-2 space-y-1.5">
                  {recs.map((r) => (
                    <RecRow
                      key={r.id}
                      rec={r}
                      checked={selected.has(r.id)}
                      onToggle={() => toggle(r.id)}
                    />
                  ))}
                </ul>
                <div className="px-4 pb-4 pt-1 flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-8 text-xs flex-1"
                    disabled={!canApply || selected.size === 0 || apply.isPending}
                    onClick={() => apply.mutate([...selected])}
                  >
                    {apply.isPending
                      ? "Applying…"
                      : `Apply ${selected.size || ""} ${
                          selected.size === 1 ? "change" : "changes"
                        }`.trim()}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={() => {
                      setSelected(new Set());
                      setExpanded(false);
                    }}
                  >
                    Dismiss
                  </Button>
                </div>
                <p className="px-4 pb-3 text-[10px] text-muted-foreground">
                  Changes apply to your paper-mode settings and take effect on the next scanner
                  cycle.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function RecRow({
  rec,
  checked,
  onToggle,
}: {
  rec: Recommendation;
  checked: boolean;
  onToggle: () => void;
}) {
  const sev = ragStyles(rec.severity);
  return (
    <li>
      <label
        className={`flex items-start gap-3 rounded-lg border bg-card p-2.5 cursor-pointer transition-colors ${
          checked ? "border-primary/60 bg-primary/5" : "hover:bg-muted/40"
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-0.5 size-4 accent-primary shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`size-2 rounded-full ${sev.dot} shrink-0`} />
            <p className="text-xs font-semibold leading-tight">{rec.title}</p>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">{rec.why}</p>
          <p className="text-[11px] mt-1">
            <span className="text-primary font-medium">Will do: </span>
            <span className="text-foreground">{rec.willDo}</span>
          </p>
        </div>
      </label>
    </li>
  );
}
