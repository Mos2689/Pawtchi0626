-- Click attribution for emailed CTAs.
--
-- `opened_at` already means "the recipient's client loaded the tracking pixel,
-- or a push was tapped". A click is a stronger and different fact: somebody
-- pressed the button in the email and was handed to the app. Overloading
-- `opened_at` would make the two indistinguishable in every funnel that already
-- reads it, so this is its own column.
--
-- Written only by the public `engagement-click` function, which sets it once
-- (`IS NULL` guard) so a forwarded or re-tapped link cannot overwrite the
-- moment of the first click.
ALTER TABLE public.notification_history
  ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.notification_history.clicked_at IS
  'First tap on an emailed CTA, set once by the engagement-click edge function. Distinct from opened_at (pixel load / push tap).';

-- Partial: the only question ever asked of this column is "which sends were
-- clicked", and the clicked rows are the small minority.
CREATE INDEX IF NOT EXISTS notification_history_clicked_at_idx
  ON public.notification_history (clicked_at)
  WHERE clicked_at IS NOT NULL;
