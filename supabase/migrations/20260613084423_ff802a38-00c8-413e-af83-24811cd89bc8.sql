ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'INR'
  CHECK (currency IN ('INR','USD','EUR','GBP','AED','SGD','JPY'));