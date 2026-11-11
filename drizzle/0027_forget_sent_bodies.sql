-- A sent email keeps only its envelope (who, when, which loop, the provider's id).
-- Its html and text were someone's private loop, kept after they were needed.
-- From this release the send itself clears them (src/lib/email/send.ts, SENT_BODY);
-- this clears the ones already sent. Rows the outbox only captured (provider id
-- `outbox_...`, local dev and tests) never left, so they keep theirs.
-- Safe to run again, and harmless to the release before it, which never reads
-- the body of a sent row.
UPDATE "outbox" SET "html" = '', "text" = '' WHERE "status" = 'sent' AND "provider_id" IS NOT NULL AND "provider_id" NOT LIKE 'outbox\_%';
