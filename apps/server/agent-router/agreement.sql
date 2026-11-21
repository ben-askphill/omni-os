-- How often each shadow router agrees with the Conductor on the first message of a #conductor thread
-- (agent_router_shadow, agent-router/shadow.ts). Read-only: sqlite3 -readonly data/omni.db < apps/server/agent-router/agreement.sql
--
-- A router agrees when its first pick is one of the agents the Conductor delegated to in that turn, or both left the
-- message to the Conductor ('conductor-self'). Only rows whose turn has ended count, and only the routers that
-- answered: a failed or missing router is left out of its own rate, so `scored` can differ per router.
--   agree_pct          first pick matches the Conductor
--   answer_or_delegate both answer it themselves, or both delegate (to any agent)
--   agent_if_both      among messages both delegated: the same agent
--   jev+haiku          Jev decides answer or delegate; when it delegates, Haiku's first agent (not conductor-self) is the
--                      pick, else Jev's best agent. Scored only where both routers answered.
WITH r AS (
  SELECT thread_id,
    CASE WHEN json_array_length(conductor_picks) = 0 THEN json_array('conductor-self') ELSE conductor_picks END AS gold,
    json_extract(jev_picks, '$[0]') AS jev,
    json_extract(haiku_picks, '$[0]') AS haiku,
    (SELECT key FROM json_each(jev_scores) WHERE key != 'conductor-self' ORDER BY value DESC LIMIT 1) AS jev_agent,
    (SELECT value FROM json_each(haiku_picks) WHERE value != 'conductor-self' LIMIT 1) AS haiku_agent
  FROM agent_router_shadow
  WHERE conductor_at IS NOT NULL
),
picks AS (
  SELECT gold, 'jev' AS router, jev AS pick FROM r
  UNION ALL SELECT gold, 'haiku', haiku FROM r
  UNION ALL SELECT gold, 'jev+haiku',
    CASE WHEN jev IS NULL OR haiku IS NULL THEN NULL WHEN jev = 'conductor-self' THEN 'conductor-self' ELSE coalesce(haiku_agent, jev_agent) END
  FROM r
),
scored AS (
  SELECT router, pick,
    EXISTS (SELECT 1 FROM json_each(gold) WHERE value = pick) AS hit,
    (pick = 'conductor-self') = (json_extract(gold, '$[0]') = 'conductor-self') AS same_mode,
    pick != 'conductor-self' AND json_extract(gold, '$[0]') != 'conductor-self' AS both_delegate
  FROM picks
  WHERE pick IS NOT NULL
)
SELECT router,
  count(*) AS scored,
  sum(hit) AS agree,
  round(100.0 * sum(hit) / count(*), 1) AS agree_pct,
  round(100.0 * sum(same_mode) / count(*), 1) AS answer_or_delegate,
  sum(both_delegate) AS both_delegated,
  round(100.0 * sum(hit AND both_delegate) / nullif(sum(both_delegate), 0), 1) AS agent_if_both
FROM scored
GROUP BY router
ORDER BY CASE router WHEN 'jev' THEN 1 WHEN 'haiku' THEN 2 ELSE 3 END;
