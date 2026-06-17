
CREATE TABLE public.bot_config_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  changed_by uuid,
  field text NOT NULL,
  old_value text,
  new_value text,
  source text NOT NULL DEFAULT 'user',
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bot_config_audit_user_time_idx
  ON public.bot_config_audit (user_id, changed_at DESC);
CREATE INDEX bot_config_audit_time_idx
  ON public.bot_config_audit (changed_at DESC);

GRANT SELECT ON public.bot_config_audit TO authenticated;
GRANT ALL ON public.bot_config_audit TO service_role;

ALTER TABLE public.bot_config_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own audit read"
  ON public.bot_config_audit FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.tg_bot_config_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
  k text;
  ov text;
  nv text;
  actor uuid := NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
  src text := 'user';
BEGIN
  IF actor IS NULL THEN
    src := 'system';
  ELSIF actor <> NEW.user_id THEN
    src := 'admin';
  END IF;

  FOR k IN SELECT jsonb_object_keys(new_row) LOOP
    IF k IN ('updated_at','created_at','user_id') THEN CONTINUE; END IF;
    ov := old_row ->> k;
    nv := new_row ->> k;
    IF ov IS DISTINCT FROM nv THEN
      INSERT INTO public.bot_config_audit (user_id, changed_by, field, old_value, new_value, source)
      VALUES (NEW.user_id, actor, k, ov, nv, src);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_bot_config_audit
AFTER UPDATE ON public.bot_config
FOR EACH ROW EXECUTE FUNCTION public.tg_bot_config_audit();
