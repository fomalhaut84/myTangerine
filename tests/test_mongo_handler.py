import os
import sys
import types

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
try:
    import pandas as pd  # noqa: F401
except ModuleNotFoundError:  # pragma: no cover - only for test env
    pd = types.SimpleNamespace()

    import math

    class Series(dict):
        pass

    class DataFrame(list):
        def __init__(self, data=None):
            super().__init__(data or [])
            self.data = list(data or [])
            self._cols = list(self.data[0].keys()) if self.data else []

        @property
        def columns(self):
            return self._cols

        def __getitem__(self, key):
            return [row[key] for row in self.data]

        def __setitem__(self, key, values):
            for row, val in zip(self.data, values):
                row[key] = val

        @property
        def empty(self):
            return len(self.data) == 0

    def isna(x):
        return x is None or (isinstance(x, float) and math.isnan(x))

    def notna(x):
        return not isna(x)

    def to_datetime(x):
        return x

    pd.Series = Series
    pd.DataFrame = DataFrame
    pd.isna = isna
    pd.notna = notna
    pd.to_datetime = to_datetime
    sys.modules['pandas'] = pd

import handlers.mongo_handler as mongo_handler

class DummyCollection:
    def __init__(self, docs):
        self.docs = docs
        self.updated = None

    def find(self, query):
        return self.docs

    def update_many(self, flt, upd):
        self.updated = (flt, upd)

class DummyClient:
    def __init__(self, docs):
        self.docs = docs
    def __getitem__(self, name):
        return self
    @property
    def collection(self):
        return DummyCollection(self.docs)
    def __getattr__(self, name):
        return self.collection


def test_get_new_orders(monkeypatch):
    docs = [{"_id": 1, "타임스탬프": "2024-01-01 10:00:00", "비고": ""}]
    monkeypatch.setattr(mongo_handler, 'MongoClient', lambda uri: DummyClient(docs))
    cfg = types.SimpleNamespace(MONGODB_URI='', MONGODB_DB_NAME='', MONGODB_COLLECTION_NAME='')
    handler = mongo_handler.MongoDBHandler(cfg)
    handler.collection = DummyCollection(docs)
    df = handler.get_new_orders()
    assert not df.empty
    handler.mark_orders_as_confirmed()
    assert handler.first_id == 1



