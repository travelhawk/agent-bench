# sql-refactor

Task:
Refactor a slow and incorrect "top customers in last 30 days" query on PostgreSQL.

Schema:
- `orders(id, customer_id, amount_cents, status, created_at)`
- `customers(id, email, country_code, is_active)`

Current query:
```sql
SELECT c.id, c.email, SUM(o.amount_cents) AS total
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.status = 'paid'
  AND o.created_at >= NOW() - INTERVAL '30 days'
  AND c.is_active = true
GROUP BY c.id, c.email
ORDER BY total DESC
LIMIT 20;
```

Problems to solve:
- `LEFT JOIN` is effectively turned into `INNER JOIN` by `WHERE` filters on `o.*`.
- Query scans too many rows under high order volume.

Required implementation:
- Return only active customers with paid orders in the last 30 days.
- Keep output columns exactly: `id`, `email`, `total`.
- Provide an optimized query and index recommendations.
- Explain why the new query is equivalent/correct.

Verification:
- Include `EXPLAIN`-oriented reasoning (index usage, reduced scan scope).
- Ensure deterministic ordering for ties by adding a secondary order key (`c.id ASC`).

Expected outcome:
- Correct 30-day paid totals per active customer.
- Better execution characteristics on large `orders` table.
- Stable ordering across repeated executions.

