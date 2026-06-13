import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

function checkRememberMeExpiry() {
  const rememberMe = localStorage.getItem("earno_remember_me");
  const untilRaw = localStorage.getItem("earno_remember_me_until");
  if (rememberMe === "1" && untilRaw) {
    const until = parseInt(untilRaw, 10);
    if (!isNaN(until) && Date.now() > until) {
      localStorage.removeItem("earno_remember_me");
      localStorage.removeItem("earno_remember_me_until");
      return supabase.auth.signOut();
    }
  }
  return Promise.resolve();
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    await checkRememberMeExpiry();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  useEffect(() => {
    const id = setInterval(() => {
      checkRememberMeExpiry();
    }, 60000);
    return () => clearInterval(id);
  }, []);

  return <Outlet />;
}
