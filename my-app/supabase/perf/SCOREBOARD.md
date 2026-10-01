# Performance scoreboard

All checks are read-only. Run them before and after every perf change, and compare against the baseline. A change that doesn't move these numbers gets reverted. A change that moves the wrong one gets switched off.

## Baseline — build 98, measured 2026-10-01 (last 24 h of app traffic)

**Time inside Supabase** (`x_envoy_upstream_service_time`), app traffic only:

| Edge | Requests | p50 | p95 |
|---|---:|---:|---:|
| Mumbai (BOM) | 524 | 2,044 ms | 11,401 ms |
| Sydney (SYD) | 320 | 664 ms | 18,342 ms |
| Brisbane (BNE) | 102 | 494 ms | 6,951 ms |
| Melbourne (MEL) | 19 | 3,991 ms | 11,932 ms |

**Slowest endpoints** (p50 inside Supabase):

| Endpoint | p50 | Notes |
|---|---:|---|
| `get_pet_dashboard` | 7.7 s | DB mean 1,046 ms; 8 statement timeouts per day |
| `food_scans` | 7.1 s | the table has 371 rows |
| `daily_logs` | 7.0 s | |
| `activities` | 6.7 s | |
| `streaks` | 2.8 s | |
| `register_push_token` | 2.4 s | |
| `community_pack_detail` | 1.37 s | |
| `community_trails_for_me` | 1.6 s | |

**Launch burst, per user:** 3-second windows show p50 5, p90 18, max 23 requests.

**Errors per day:**
- `register_push_token`: 13 × 400. The iOS token-rotation listener sends the native APNs token.
- `get_pet_dashboard`: 8 × 500 (statement timeout).
- `community_memory`: 3 × 400 (`walk_not_attended`, expected).
- storage: 2 × 544.

**Database signals:**
- PostgREST `set_config` mean 8.2 ms. Healthy is under 1 ms.
- Schema-cache reload mean 2.8 s, max 25 s.
- `get_notification_candidates` mean 862 ms, `get_email_candidates` mean 600 ms.
- A `pets` sequential scan of 241 rows took 19.6 ms, which shows CPU starvation at times.

**Stuck walks:** 1 meetup has been "active" for 8 days 19 h. It's now tracked by `community_stale_walk_watch`.

## Targets

- In-Supabase p50 under 100 ms and p95 under 1 s on every endpoint.
- `set_config` mean under 1 ms.
- `get_pet_dashboard` warm under 20 ms, with 0 timeouts.
- Launch burst p90 at or under 8 requests (Train 2).
- No new error types; `register_push_token` 400s at 0 (Train 2).

## Queries

### 1. Time inside Supabase, by edge
`query_logs` (Supabase MCP) or Logs Explorer:

```sql
select log_attributes['request.cf.country'] as country, log_attributes['request.cf.colo'] as colo, count() as requests,
  round(quantile(0.5)(toFloat64OrZero(log_attributes['response.headers.x_envoy_upstream_service_time']))) as upstream_p50_ms,
  round(quantile(0.95)(toFloat64OrZero(log_attributes['response.headers.x_envoy_upstream_service_time']))) as upstream_p95_ms,
  round(quantile(0.5)(toFloat64OrZero(log_attributes['response.origin_time']))) as origin_p50_ms
from logs
where source = 'edge_logs' and log_attributes['request.headers.x_client_info'] like '%react-native%'
group by country, colo order by requests desc
```

### 2. Per endpoint
Same filter as query 1, grouped by the endpoint expression used on 2026-10-01: `rpc:<fn>`, `rest:<table>`, `storage`, `auth:<x>`.

### 3. Launch burst
Group app requests by `request.sb.auth_user` and 3-second window, then take p50, p90 and max of the counts.

### 4. Errors
Edge logs with `status_code >= 400`, grouped by endpoint and status. Postgres logs with `parsed.error_severity in ('ERROR','FATAL')`, grouped by message.

### 5. Database
```sql
select left(regexp_replace(query, '\s+', ' ', 'g'), 110) q, calls, round(mean_exec_time::numeric,1) mean_ms, round(max_exec_time::numeric) max_ms
from extensions.pg_stat_statements where calls > 5 order by total_exec_time desc limit 18;
```

### 6. Dashboard parity
Run as the owner in a rolled-back transaction. The md5 of `get_pet_dashboard(...)::text` must equal the pre-change hash for the same pet and date. Verified identical on 2026-10-01: owner `ca17d007…`, non-owner `06ba590b…`.
