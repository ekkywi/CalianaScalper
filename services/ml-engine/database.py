# services/ml-engine/database.py

import os
import pandas as pd
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

DB_USER = os.getenv("DB_USER")
DB_PASS = os.getenv("DB_PASS")
DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")
DB_NAME = os.getenv("DB_NAME")

DATABASE_URL = f"postgresql+psycopg2://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

try:
    engine = create_engine(DATABASE_URL)
    logger.info("Mesin Database SQLAlchemy berhasil diinisialisasi.")
except Exception as e:
    logger.error(f"Gagal menginisialisasi database: {e}")

def fetch_historical_candles(symbol: str, limit: int = 1000) -> pd.DataFrame:
    """
    Menarik data historis dari PostgreSQL dan mengembalikannya sebagai Pandas DataFrame.
    Menggunakan parameterized query untuk mencegah SQL Injection.
    """
    query = text("""
        SELECT "startTime", "closeTime", "open", "high", "low", "close", "volume"
        FROM candles
        WHERE symbol = :symbol
        ORDER BY "closeTime" DESC
        LIMIT :limit
    """)
    
    try:
        df = pd.read_sql(query, engine, params={"symbol": symbol, "limit": limit})
        
        if df.empty:
            logger.warning(f"Tidak ada data historis ditemukan untuk {symbol}.")
            return df
            
        df = df.sort_values(by="closeTime").reset_index(drop=True)
        
        cols = ["open", "high", "low", "close", "volume"]
        df[cols] = df[cols].astype(float)
        
        return df
    except Exception as e:
        logger.error(f"Gagal menarik data dari database: {e}")
        return pd.DataFrame()