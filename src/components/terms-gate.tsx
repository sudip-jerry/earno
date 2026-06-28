import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TERMS_VERSION } from "@/routes/_authenticated/terms";
import { toast } from "sonner";

export function TermsGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [needsAccept, setNeedsAccept] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return setChecking(false);
      const { data } = await supabase
        .from("profiles")
        .select("terms_accepted_at,terms_version")
        .eq("id", u.user.id)
        .maybeSingle();
      const ok = !!data?.terms_accepted_at && data?.terms_version === TERMS_VERSION;
      setNeedsAccept(!ok);
      setChecking(false);
    })();
  }, []);

  const accept = async () => {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase
      .from("profiles")
      .update({ terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION })
      .eq("id", u.user.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    setNeedsAccept(false);
  };

  if (checking) return null;
  if (!needsAccept) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur grid place-items-center p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card shadow-lg flex flex-col max-h-[90svh]">
        <div className="p-5 border-b">
          <h2 className="text-lg font-semibold">Before you continue</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Please review and accept the Earn'O Terms & Risk Disclaimer.
          </p>
        </div>
        <ScrollArea className="flex-1 px-5 py-4 text-sm text-muted-foreground space-y-3">
          <p>
            <strong className="text-foreground">You control your account.</strong> Earn'O never
            custodies funds. Your CoinDCX API keys stay encrypted and Futures-scoped.
          </p>
          <p>
            <strong className="text-foreground">You assume trading risk.</strong> Leveraged crypto
            futures can result in total loss. You're solely responsible for orders placed under your
            configuration.
          </p>
          <p>
            <strong className="text-foreground">No guaranteed returns.</strong> Past performance and
            paper results do not indicate future outcomes.
          </p>
          <p>
            <strong className="text-foreground">Automation is opt-in.</strong> Auto-book is off by
            default and can be paused anytime.
          </p>
          <p>
            Earn'O provides automated strategy execution, quantitative market analysis, and
            user-controlled automation — not guaranteed profits, "beating the market", or risk-free
            trading.
          </p>
          <p>
            Read the full{" "}
            <Link to="/terms" className="text-primary underline">
              Terms & Disclaimer
            </Link>
            .
          </p>
        </ScrollArea>
        <div className="p-5 border-t space-y-3">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              className="mt-0.5"
            />
            <span>
              I have read and agree to the Terms & Risk Disclaimer, and I consent to Earn'O
              automating trades on my CoinDCX account when I enable it.
            </span>
          </label>
          <Button className="w-full" disabled={!agreed || saving} onClick={accept}>
            {saving ? "Saving…" : "Agree & continue"}
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/auth";
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
