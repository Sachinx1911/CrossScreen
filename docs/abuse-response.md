# Responding to a report

Phase 3a §3.2's own words are the reason this file exists: **an unmonitored
button is worse than none.** A Report affordance that reaches a table nobody
reads is not a safety feature — it is a device for making someone who was
mistreated believe they were heard.

## Who reads reports, until there is a team to do it

Solo, part-time, for now (roadmap.md). That is a real constraint on response
time, not a gap to pretend around: a report will sometimes wait hours rather
than minutes. What it must not do is wait indefinitely, or land somewhere
nobody ever queries.

## Where a report lands

`session.report` (either side, any point after joining) writes one row to
`abuse_log`:

```sql
SELECT occurred_at, ip_hash, detail->>'sessionId' AS session_id,
       detail->>'role' AS reported_by, detail->>'reason' AS reason
FROM abuse_log
WHERE event = 'reported'
ORDER BY occurred_at DESC
LIMIT 50;
```

`session_id` is the internal id — never the join code, which is not durable
and would not still identify anything by the time someone reads this. Cross
reference it against `session_events` for the same session to see who did
what and when:

```sql
SELECT occurred_at, event, participant_id, detail
FROM session_events
WHERE session_id = '<the id from the query above>'
ORDER BY occurred_at;
```

`session_locked` and `too_many_sessions` rows in the same `abuse_log` table
are the automated half of this — code-guessing and endpoint abuse the rate
limiter already stopped without anyone reading anything. A human report is
for the half that limits and locks cannot catch: someone who got in
legitimately and then did something wrong.

## What to actually do

1. **Read the session's own event trail** (query above) before deciding
   anything — a report names a session, not a verdict.
2. **A credible tech-support-scam report is the one case that gets acted on
   immediately, not queued**: if a live session matches the pattern the
   first-share notice warns about (`SafetyNotice.tsx`), end it. There is no
   admin endpoint for this yet — today that means finding the session in
   `session_events` and, if it is still active, waiting for it to expire on
   its own schedule (`SESSION_TIMEOUTS`) or reaching for direct database
   access as a last resort. **This is the sharpest edge of running this
   phase solo**, named here rather than left implicit: a real incident right
   now needs a person at a keyboard, not a button in the product.
3. **Everything else — a rude viewer, a confused report, one that turns out
   to be nothing — gets read, and gets no reply**, because there is no
   contact path back to whoever reported it (sessions are anonymous by
   design, ADR-0007). The reporter's own confirmation ("Report received —
   thank you") is deliberately the entire interaction on their side; nothing
   promises more than that.
4. **A pattern across multiple reports naming the same behaviour** — not
   caught by any single session — is worth a note in this file or a follow-up
   ADR, not just a query result forgotten the next day.

## What does not exist yet, on purpose

No alerting, no paging, no dashboard. Prometheus/Grafana are explicitly out
of scope for this phase (`phase-3a-production.md`'s Out of scope line) —
querying `abuse_log` by hand is the process until the volume of reports
makes that genuinely too slow, at which point that volume is itself the
justification for building more. Checking it is a habit to keep, not
something the system enforces: put "read `abuse_log`" on whatever schedule
this project's own operator actually keeps.
