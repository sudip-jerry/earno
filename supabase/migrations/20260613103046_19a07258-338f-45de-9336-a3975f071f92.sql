
-- Roles
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

DROP POLICY IF EXISTS "own role read" ON public.user_roles;
CREATE POLICY "own role read" ON public.user_roles FOR SELECT
  TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "admin manage roles" ON public.user_roles;
CREATE POLICY "admin manage roles" ON public.user_roles FOR ALL
  TO authenticated USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Plans
DO $$ BEGIN
  CREATE TYPE public.plan_tier AS ENUM ('free','reco','auto5','unlimited');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_plans (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier public.plan_tier NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active', -- active | canceled | expired
  source text NOT NULL DEFAULT 'system', -- system | admin | coupon | razorpay
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  razorpay_subscription_id text,
  razorpay_customer_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.user_plans TO authenticated;
GRANT ALL ON public.user_plans TO service_role;
ALTER TABLE public.user_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own plan read" ON public.user_plans;
CREATE POLICY "own plan read" ON public.user_plans FOR SELECT
  TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "admin manage plans" ON public.user_plans;
CREATE POLICY "admin manage plans" ON public.user_plans FOR ALL
  TO authenticated USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP TRIGGER IF EXISTS trg_user_plans_updated ON public.user_plans;
CREATE TRIGGER trg_user_plans_updated BEFORE UPDATE ON public.user_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.current_plan_tier(_user_id uuid)
RETURNS public.plan_tier LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.has_role(_user_id,'admin') THEN 'unlimited'::public.plan_tier
    ELSE COALESCE((
      SELECT CASE WHEN expires_at IS NULL OR expires_at > now() THEN tier ELSE 'free'::public.plan_tier END
      FROM public.user_plans WHERE user_id = _user_id
    ),'free'::public.plan_tier)
  END
$$;

-- Coupons
CREATE TABLE IF NOT EXISTS public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  tier public.plan_tier NOT NULL,
  duration_days int NOT NULL DEFAULT 30,
  max_uses int,
  used_count int NOT NULL DEFAULT 0,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);
GRANT SELECT ON public.coupons TO authenticated;
GRANT ALL ON public.coupons TO service_role;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin read coupons" ON public.coupons;
CREATE POLICY "admin read coupons" ON public.coupons FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "admin manage coupons" ON public.coupons;
CREATE POLICY "admin manage coupons" ON public.coupons FOR ALL
  TO authenticated USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, user_id)
);
GRANT SELECT ON public.coupon_redemptions TO authenticated;
GRANT ALL ON public.coupon_redemptions TO service_role;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own redemption read" ON public.coupon_redemptions;
CREATE POLICY "own redemption read" ON public.coupon_redemptions FOR SELECT
  TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- App settings (singleton)
CREATE TABLE IF NOT EXISTS public.app_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  paywall_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "any signed-in read settings" ON public.app_settings;
CREATE POLICY "any signed-in read settings" ON public.app_settings FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "admin write settings" ON public.app_settings;
CREATE POLICY "admin write settings" ON public.app_settings FOR ALL
  TO authenticated USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Seed admin
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin' FROM auth.users WHERE lower(email) = 'sudip.gupta.87@gmail.com'
ON CONFLICT DO NOTHING;

INSERT INTO public.user_plans (user_id, tier, source, started_at, expires_at)
SELECT id, 'unlimited','admin', now(), NULL
FROM auth.users WHERE lower(email) = 'sudip.gupta.87@gmail.com'
ON CONFLICT (user_id) DO UPDATE SET tier='unlimited', source='admin', expires_at=NULL;
