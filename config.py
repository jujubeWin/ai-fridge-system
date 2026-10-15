import os

from dotenv import load_dotenv

load_dotenv()

MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
MYSQL_DB = os.getenv("MYSQL_DB", "fridge_ai")
MYSQL_CHARSET = os.getenv("MYSQL_CHARSET", "utf8mb4")
ZHIPU_API_KEY = os.getenv("ZHIPU_API_KEY", "")