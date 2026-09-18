create table if not exists trades (
  id uuid primary key default gen_random_uuid(), symbol text not null, name text, side text not null check(side in ('BUY','SELL')),
  quantity integer not null check(quantity>0), price numeric not null check(price>0), executed_at timestamptz not null default now()
);
create table if not exists positions (
  symbol text primary key, name text not null, quantity integer not null, average_cost numeric not null, opened_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists watchlist_items (
  symbol text primary key, name text not null, rating text, state text not null, priority integer not null default 0, first_seen date not null default current_date, updated_at timestamptz not null default now()
);
create table if not exists playbooks (
  symbol text primary key, version integer not null default 1, good_low numeric, good_high numeric, breakout numeric, invalid numeric, target1 numeric, target2 numeric, max_entry numeric, summary text, next_step text, updated_at timestamptz not null default now()
);
create table if not exists playbook_versions (
  id uuid primary key default gen_random_uuid(), symbol text not null, version integer not null, payload jsonb not null, source text not null, created_at timestamptz not null default now()
);
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(), symbol text not null, level text not null, type text not null, title text not null, body text, dedupe_key text unique, created_at timestamptz not null default now(), seen_at timestamptz
);
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(), source text not null, action text not null, symbol text, before jsonb, after jsonb, created_at timestamptz not null default now()
);
