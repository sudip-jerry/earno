import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import earnoLogo from "@/assets/earno-logo.png";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — EarnO" },
      { name: "description", content: "Sign in to your EarnO automated futures trading bot." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Clean up legacy forced-logout keys so old installs stop signing users out.
    localStorage.removeItem("earno_remember_me");
    localStorage.removeItem("earno_remember_me_until");
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);


  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created. You're in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    setRememberMeStorage(rememberMe);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Google sign-in failed");
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-svh bg-background flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src={earnoLogo} alt="EarnO" className="h-14 w-auto" />
          <p className="text-sm font-medium tracking-widest uppercase text-primary text-center">
            Grow your money while you sleep
          </p>
        </div>

        <form onSubmit={handleEmail} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="remember"
              checked={rememberMe}
              onCheckedChange={(v) => setRememberMe(v === true)}
            />
            <Label htmlFor="remember" className="text-sm text-muted-foreground cursor-pointer">
              Keep me logged in for 24 hours
            </Label>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {mode === "signup" ? "Create account" : "Sign in"}
          </Button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogle}
          disabled={loading}
        >
          Continue with Google
        </Button>

        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="w-full mt-6 text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === "signin" ? "No account? Create one" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
