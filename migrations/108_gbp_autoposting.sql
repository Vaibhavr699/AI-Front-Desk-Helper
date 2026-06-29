SELECT column_name FROM information_schema.columns
WHERE table_name='gbp_post_schedule' AND column_name IN ('image_cursor','last_run_note');
SELECT to_regclass('public.gbp_image_pool');
