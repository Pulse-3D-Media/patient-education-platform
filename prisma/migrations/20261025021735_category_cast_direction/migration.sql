-- K2, part two: the temporary cast in 20261025020858_categories_as_text points the
-- wrong way. Tried against the testing branch with the live code, "text AS Category"
-- does not let it compare a text column with a value it marks as "Category"
-- ("operator does not exist: text = Category"). The way that works is the other
-- direction: an old "Category" value may be read as text. That migration was already
-- applied to the testing branch, and an applied migration is never edited, so this
-- one fixes it forward. Production gets both in one `migrate deploy`, a moment apart.
--
-- Still TEMPORARY: dropped, with the old "Category" type, by the later clean-up
-- migration once K2 has been live for a while.

BEGIN;

DROP CAST (text AS "Category");
CREATE CAST ("Category" AS text) WITH INOUT AS IMPLICIT;

COMMIT;
