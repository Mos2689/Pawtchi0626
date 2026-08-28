-- Walk weather — conditions captured at walk time, for the Walk Story.
--
-- weather holds a best-effort Open-Meteo reading as { tempC, code, label }.
-- Fetched fire-and-forget in walkSync after the session row is saved, using
-- coordinates coarsened to ~1 km (see lib/walk/weather.ts); a failed fetch
-- leaves this NULL and the story simply skips the weather card.
--
-- NULL = no reading (offline, timeout, or a row from before this feature).

ALTER TABLE walk_sessions
  ADD COLUMN IF NOT EXISTS weather JSONB;
