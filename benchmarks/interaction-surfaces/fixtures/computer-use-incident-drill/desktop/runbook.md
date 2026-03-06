# Session Edge Recovery Runbook

1. If stale token reuse is confirmed, disable stale token reuse before restarting cache workers.
2. Restart the token-cache worker pool after the guardrail flag is off.
3. Validate that refresh latency falls below 1.5s before closing the incident.
4. Notify identity-oncall if customer re-login failures continue for more than 10 minutes.
