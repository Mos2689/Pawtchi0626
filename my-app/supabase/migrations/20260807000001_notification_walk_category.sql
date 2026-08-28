-- A preference category for walk content.
--
-- Walk notifications need their own switch rather than folding into
-- `cat_milestones`. The reason is the hardest case the walk strategy has to
-- handle: an owner stops walking because of a sprain, a surgery, or because the
-- dog died. "Hasn't walked in three weeks" and "the dog is gone" produce
-- identical telemetry, and at any real scale both are certain to occur.
--
-- Such an owner needs a way to silence walk content that does not also cost
-- them meal reminders and health signals. A shared toggle would have made
-- "leave me alone about walks" an all-or-nothing choice, which is exactly the
-- moment an app gets deleted.
--
-- Defaults to true, matching every other category: existing owners keep working
-- as before, and the 116 owners with no preferences row at all fall back to the
-- same default via lib/notifications/preferences.ts.

ALTER TABLE public.owner_preferences
  ADD COLUMN IF NOT EXISTS cat_walk boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.owner_preferences.cat_walk IS
  'Post-walk observations (campaign category "walk"). Separate from cat_milestones so an owner who has stopped walking can silence walk content without losing care reminders.';
