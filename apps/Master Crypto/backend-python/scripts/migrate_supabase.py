import asyncio
import os
import sys
import asyncpg

# Conecta via asyncpg diretamente usando o Transaction Pooler
async def run_migration():
    migration_file = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../../supabase/migrations/20260914000000_initial_schema.sql")
    )

    with open(migration_file, "r", encoding="utf-8") as f:
        sql_script = f.read()

    # URL no formato asyncpg
    url = "postgresql://postgres.bbxbwnjrsdlnlkyjebio:aU0iwC7umLW3Zqgf@aws-1-us-west-2.pooler.supabase.com:6543/postgres"

    print("Conectando diretamente via asyncpg ao Supabase PostgreSQL Pooler...")
    conn = await asyncpg.connect(url, statement_cache_size=0)

    try:
        print("Executando o script de migração no Supabase...")
        await conn.execute(sql_script)
        print("==================================================")
        print("MIGRAÇÃO DE SCHEMA CONCLUÍDA COM SUCESSO NO SUPABASE!")
        print("==================================================")
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(run_migration())
