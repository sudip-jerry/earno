ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS instrument text
  CHECK (instrument IN ('futures','spot'));

UPDATE public.positions
SET instrument = CASE
  WHEN symbol LIKE 'B-%\_USDT' ESCAPE '\' THEN 'futures'
  WHEN symbol LIKE '%/%' THEN 'spot'
  ELSE 'futures'
END
WHERE instrument IS NULL;