try:
    from pymongo import MongoClient
except ModuleNotFoundError:  # pragma: no cover - only for test env
    class MongoClient:  # type: ignore
        def __init__(self, *args, **kwargs):
            raise ImportError("pymongo is required")

import pandas as pd
from typing import Any
from config.config import Config
from exceptions.exceptions import DatabaseError

class MongoDBHandler:
    def __init__(self, config: Config):
        self.config = config
        self.client = MongoClient(self.config.MONGODB_URI)
        self.db = self.client[self.config.MONGODB_DB_NAME]
        self.collection = self.db[self.config.MONGODB_COLLECTION_NAME]
        self.first_id: Any | None = None
        self.last_id: Any | None = None

    def get_new_orders(self) -> pd.DataFrame:
        try:
            docs = list(self.collection.find({"confirmed": {"$ne": True}}))
            if not docs:
                return pd.DataFrame()
            self.first_id = docs[0]["_id"]
            self.last_id = docs[-1]["_id"]
            df = pd.DataFrame(docs)
            if "타임스탬프" in df.columns:
                df["타임스탬프"] = pd.to_datetime(df["타임스탬프"])
            return df
        except Exception as e:  # pragma: no cover - connection errors
            raise DatabaseError(f"Failed to fetch orders: {e}")

    def mark_orders_as_confirmed(self) -> None:
        if self.first_id is None or self.last_id is None:
            return
        try:
            self.collection.update_many(
                {"_id": {"$gte": self.first_id, "$lte": self.last_id}},
                {"$set": {"confirmed": True}},
            )
        except Exception as e:  # pragma: no cover - connection errors
            raise DatabaseError(f"Failed to update orders: {e}")

