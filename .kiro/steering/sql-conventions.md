# SQL Conventions

## Naming
- Tables: plural snake_case (`user_accounts`, `order_items`)
- Columns: snake_case (`first_name`, `created_at`)
- Indexes: `idx_{table}_{columns}` (`idx_users_email`)
- Foreign keys: `fk_{table}_{ref_table}` (`fk_orders_users`)
- Constraints: `chk_{table}_{column}` for checks, `uq_{table}_{column}` for unique

## Migration Files
- Sequential numbered files: `001_`, `002_`, etc.
- Each migration is idempotent (uses IF NOT EXISTS / IF EXISTS)
- Include both UP and DOWN sections separated by `-- UP` and `-- DOWN` comments

## Query Style
- Keywords in UPPERCASE (SELECT, FROM, WHERE)
- One clause per line for readability
- Use CTEs over subqueries
- Always alias joined tables
- Terminate statements with semicolons

## PostgreSQL Specifics
- Prefer `TEXT` over `VARCHAR` when no length constraint is needed
- Use `TIMESTAMPTZ` over `TIMESTAMP` for time-aware columns
- Use `BIGINT` for primary keys expected to grow large
- Use `JSONB` over `JSON` for indexed JSON data