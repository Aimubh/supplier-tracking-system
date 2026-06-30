"""
Vendex database layer — asyncpg (PostgreSQL).

Set DATABASE_URL in your .env, e.g.:
  DATABASE_URL=postgresql://user:pass@host/dbname

Neon free tier example:
  DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/vendex?sslmode=require
"""

import os
import asyncio
import json
import asyncpg
from asyncpg import Pool
from dotenv import load_dotenv

# Load .env from project root (one level up from backend/)
_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(_root, ".env"), override=False)
load_dotenv(os.path.join(_root, ".env.local"), override=False)

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Add it to your .env file at the project root.\n"
        f"  Expected location: {os.path.join(_root, '.env')}"
    )

# Connection pool — created once at startup, reused across all requests.
_pool: Pool | None = None
_pool_lock = asyncio.Lock()

# Write lock kept for operations that must be serialised (batch inserts etc.)
_write_lock = asyncio.Lock()


async def get_pool() -> Pool:
    global _pool
    if _pool is not None:
        return _pool
    async with _pool_lock:
        if _pool is None:
            _pool = await asyncpg.create_pool(
                DATABASE_URL,
                min_size=2,
                max_size=10,
                command_timeout=60,
                # Neon/Serverless specific optimizations
                statement_cache_size=0, 
                max_inactive_connection_lifetime=30.0,
            )
    return _pool


# ── Schema init ───────────────────────────────────────────────────────────────

async def init_db():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            reel_url TEXT NOT NULL,
            platform TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            extracted_frame_url TEXT,
            detected_product_name TEXT,
            detected_keywords TEXT DEFAULT '[]',
            error_message TEXT,
            result_count INTEGER DEFAULT 0,
            pipeline_stages TEXT DEFAULT '[]',
            progress_percent INTEGER DEFAULT 0,
            detailed_logs TEXT DEFAULT '[]',
            duration_seconds REAL,
            label TEXT,
            csv_row_id TEXT
        );
        """)

        await conn.execute("""
        CREATE TABLE IF NOT EXISTS suppliers (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            product_name TEXT NOT NULL,
            product_description TEXT,
            product_image_url TEXT,
            product_category TEXT,
            supplier_name TEXT NOT NULL,
            supplier_type TEXT NOT NULL,
            company_name TEXT NOT NULL,
            country TEXT NOT NULL,
            country_code TEXT NOT NULL,
            city TEXT,
            verified INTEGER DEFAULT 0,
            gold_supplier INTEGER DEFAULT 0,
            trade_assurance INTEGER DEFAULT 0,
            years_on_platform INTEGER,
            unit_price_usd REAL,
            unit_price_cny REAL,
            unit_price_inr REAL NOT NULL,
            original_currency TEXT NOT NULL,
            original_price REAL NOT NULL,
            price_range_min REAL,
            price_range_max REAL,
            moq INTEGER NOT NULL,
            moq_unit TEXT DEFAULT 'pieces',
            shipping_methods TEXT DEFAULT '[]',
            estimated_shipping_cost_usd REAL,
            estimated_shipping_cost_inr REAL,
            total_price_inr REAL NOT NULL,
            estimated_delivery_days INTEGER,
            rating REAL DEFAULT 0,
            review_count INTEGER DEFAULT 0,
            response_rate TEXT,
            response_time TEXT,
            reorder_rate TEXT,
            on_time_delivery_rate TEXT,
            location TEXT,
            warranty TEXT,
            certifications TEXT DEFAULT '[]',
            sample_available INTEGER DEFAULT 0,
            sample_price_usd REAL,
            sample_price_inr REAL,
            platform TEXT DEFAULT 'alibaba',
            product_url TEXT NOT NULL,
            item_id TEXT,
            store_id TEXT,
            match_score REAL NOT NULL,
            match_source TEXT NOT NULL,
            created_at TEXT NOT NULL,
            product_properties TEXT DEFAULT '{}',
            raw_api_response TEXT DEFAULT '{}'
        );
        """)

        await conn.execute("""
        CREATE TABLE IF NOT EXISTS csv_rows (
            id TEXT PRIMARY KEY,
            upload_id TEXT NOT NULL,
            upload_name TEXT NOT NULL,
            sr_no TEXT,
            sent_by TEXT,
            sku_name TEXT,
            product_link TEXT,
            product_image TEXT,
            inquiry_sent TEXT,
            extra_data TEXT DEFAULT '{}',
            job_id TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT NOT NULL
        );
        """)

        # Indexes (IF NOT EXISTS is idempotent)
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_csv_rows_upload_id ON csv_rows(upload_id);")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_suppliers_job_id ON suppliers(job_id);")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_suppliers_country ON suppliers(country_code);")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);")


# ── Helpers ───────────────────────────────────────────────────────────────────

def to_camel(s: str) -> str:
    parts = s.split('_')
    camel = [parts[0]]
    for word in parts[1:]:
        if word.upper() in ('INR', 'USD', 'CNY'):
            camel.append(word.upper())
        else:
            camel.append(word.capitalize())
    return "".join(camel)


def _row_to_dict(row) -> dict:
    """Convert asyncpg Record to plain dict."""
    return dict(row)


# ── Jobs ──────────────────────────────────────────────────────────────────────

async def get_job(job_id: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM jobs WHERE id = $1", job_id)
    if not row:
        return None
    d = _row_to_dict(row)
    for key in ('detected_keywords', 'pipeline_stages', 'detailed_logs'):
        d[key] = json.loads(d.get(key) or '[]')
    return {to_camel(k): v for k, v in d.items()}


async def save_job(job_data: dict):
    fields = list(job_data.keys())
    values = []
    for k in fields:
        v = job_data[k]
        if k in ('detected_keywords', 'pipeline_stages', 'detailed_logs') and isinstance(v, list):
            values.append(json.dumps(v))
        else:
            values.append(v)

    placeholders = ", ".join(f"${i+1}" for i in range(len(fields)))
    cols = ", ".join(fields)
    updates = ", ".join(f"{f} = EXCLUDED.{f}" for f in fields if f != 'id')

    query = f"""
        INSERT INTO jobs ({cols}) VALUES ({placeholders})
        ON CONFLICT (id) DO UPDATE SET {updates}
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(query, *values)


async def update_job(job_id: str, updates: dict):
    if not updates:
        return
    set_clauses = []
    values = []
    for i, (k, v) in enumerate(updates.items(), start=1):
        set_clauses.append(f"{k} = ${i}")
        if k in ('detected_keywords', 'pipeline_stages', 'detailed_logs') and isinstance(v, list):
            values.append(json.dumps(v))
        else:
            values.append(v)
    values.append(job_id)
    query = f"UPDATE jobs SET {', '.join(set_clauses)} WHERE id = ${len(values)}"
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(query, *values)


async def get_all_jobs(status=None, limit=50, offset=0):
    pool = await get_pool()
    async with pool.acquire() as conn:
        if status:
            rows = await conn.fetch(
                "SELECT * FROM jobs WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
                status, limit, offset
            )
        else:
            rows = await conn.fetch(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2",
                limit, offset
            )

    jobs = []
    for row in rows:
        d = _row_to_dict(row)
        for key in ('detected_keywords', 'pipeline_stages', 'detailed_logs'):
            d[key] = json.loads(d.get(key) or '[]')
        jobs.append({to_camel(k): v for k, v in d.items()})
    return jobs


async def delete_job_with_suppliers(job_id: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM suppliers WHERE job_id = $1", job_id)
        await conn.execute("DELETE FROM jobs WHERE id = $1", job_id)


# ── Suppliers ─────────────────────────────────────────────────────────────────

async def save_supplier(supplier_data: dict):
    fields = list(supplier_data.keys())
    values = []
    for k in fields:
        v = supplier_data[k]
        if k in ('shipping_methods', 'certifications', 'product_properties', 'raw_api_response') and isinstance(v, (list, dict)):
            values.append(json.dumps(v))
        elif isinstance(v, bool):
            values.append(1 if v else 0)
        else:
            values.append(v)

    placeholders = ", ".join(f"${i+1}" for i in range(len(fields)))
    cols = ", ".join(fields)
    updates = ", ".join(f"{f} = EXCLUDED.{f}" for f in fields if f != 'id')

    query = f"""
        INSERT INTO suppliers ({cols}) VALUES ({placeholders})
        ON CONFLICT (id) DO UPDATE SET {updates}
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(query, *values)


# ── CSV rows ──────────────────────────────────────────────────────────────────

async def save_csv_rows(rows: list):
    pool = await get_pool()
    async with pool.acquire() as conn:
        for row in rows:
            fields = list(row.keys())
            values = [json.dumps(row[k]) if isinstance(row[k], (dict, list)) else row[k] for k in fields]
            placeholders = ", ".join(f"${i+1}" for i in range(len(fields)))
            cols = ", ".join(fields)
            updates = ", ".join(f"{f} = EXCLUDED.{f}" for f in fields if f != 'id')
            query = f"""
                INSERT INTO csv_rows ({cols}) VALUES ({placeholders})
                ON CONFLICT (id) DO UPDATE SET {updates}
            """
            await conn.execute(query, *values)


async def get_csv_rows(upload_id: str = None):
    pool = await get_pool()
    async with pool.acquire() as conn:
        if upload_id:
            rows = await conn.fetch(
                "SELECT * FROM csv_rows WHERE upload_id = $1 ORDER BY created_at ASC", upload_id
            )
        else:
            rows = await conn.fetch("SELECT * FROM csv_rows ORDER BY created_at DESC")

    result = []
    for row in rows:
        d = _row_to_dict(row)
        if d.get('extra_data'):
            try:
                d['extra_data'] = json.loads(d['extra_data'])
            except Exception:
                pass
        result.append({to_camel(k): v for k, v in d.items()})
    return result


async def update_csv_row(row_id: str, updates: dict):
    if not updates:
        return
    set_clauses = [f"{k} = ${i+1}" for i, k in enumerate(updates)]
    values = list(updates.values()) + [row_id]
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            f"UPDATE csv_rows SET {', '.join(set_clauses)} WHERE id = ${len(values)}",
            *values
        )


async def delete_csv_upload(upload_id: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM csv_rows WHERE upload_id = $1", upload_id)
