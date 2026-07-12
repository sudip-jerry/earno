import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMyEntitlements } from "@/lib/plans.functions";
import { BeginnerShell } from "@/components/beginner-shell";
import { SimpleMore } from "@/components/home-simple/simple-more";

export const Route = createFileRoute("/_authenticated/more")({
  head: () => ({
    meta: [
      { title: "More — Earn'O" },
      { name: "description", content: "Help, your plan, trading mode, and settings." },
    ],
  }),
  component: MorePage,
});

function MorePage() {
  const navigate = useNavigate();
  const [hideBalance, setHideBalance] = useState(false);

  const cfg = useQuery({
    queryKey: ["bot_config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_config")
        .select("mode,is_running,paper_equity,daily_loss_cap_pct")
        .maybeSingle();
      if (error) throw error;
      return data as { mode: "paper" | "live" } | null;
    },
  });
  const currentMode = (cfg.data?.mode ?? "paper") as "paper" | "live";

  const entFn = useServerFn(getMyEntitlements);
  const ent = useQuery({ queryKey: ["entitlements"], queryFn: () => entFn() });
  const isAdmin = !!ent.data?.isAdmin;

  return (
    <BeginnerShell>
      <SimpleMore
        hideBalance={hideBalance}
        onToggleHideBalance={() => setHideBalance((v) => !v)}
        currentMode={currentMode}
        onManageMode={() => navigate({ to: "/bot" })}
        isAdmin={isAdmin}
      />
    </BeginnerShell>
  );
}
