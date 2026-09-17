import asyncio
import asyncpg

async def main():
    url = "postgresql://postgres.bbxbwnjrsdlnlkyjebio:aU0iwC7umLW3Zqgf@aws-1-us-west-2.pooler.supabase.com:6543/postgres"
    conn = await asyncpg.connect(url, statement_cache_size=0)
    
    rows = await conn.fetch("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name;
    """)
    
    tables = [r["table_name"] for r in rows]
    print("==================================================")
    print("TABELAS CRIADAS COM SUCESSO NO SUPABASE (iahub):")
    for t in tables:
        print(f" - {t}")
    print("==================================================")
    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
