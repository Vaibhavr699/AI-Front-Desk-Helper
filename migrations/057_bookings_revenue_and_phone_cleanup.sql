-- Migration 057 - booking revenue and phone cleanup

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS estimated_revenue_cents INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS actual_revenue_cents INTEGER;

UPDATE bookings
   SET estimated_revenue_cents = revenue_cents
 WHERE (estimated_revenue_cents IS NULL OR estimated_revenue_cents = 0)
   AND revenue_cents IS NOT NULL
   AND revenue_cents > 0;

ALTER TABLE bookings DROP COLUMN IF EXISTS revenue_cents;

UPDATE bookings
   SET contact_phone =
     CASE
       WHEN regexp_replace(contact_phone, '[^0-9]', '', 'g') ~ '^1[0-9]{10}$'
         THEN '+' || regexp_replace(contact_phone, '[^0-9]', '', 'g')
       WHEN regexp_replace(contact_phone, '[^0-9]', '', 'g') ~ '^[0-9]{10}$'
         THEN '+1' || regexp_replace(contact_phone, '[^0-9]', '', 'g')
       WHEN contact_phone LIKE '+%'
         THEN '+' || regexp_replace(contact_phone, '[^0-9]', '', 'g')
       ELSE contact_phone
     END
 WHERE contact_phone IS NOT NULL
   AND regexp_replace(contact_phone, '[^0-9]', '', 'g') ~ '^(1[0-9]{10}|[0-9]{10})$';

CREATE INDEX IF NOT EXISTS idx_bookings_contact_phone_last10
  ON bookings ((right(regexp_replace(COALESCE(contact_phone, ''), '[^0-9]', '', 'g'), 10)));
