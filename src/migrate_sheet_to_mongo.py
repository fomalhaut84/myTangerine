from handlers.sheet_handler import GoogleSheetHandler
from handlers.mongo_handler import MongoDBHandler
from config.config import Config


def main() -> None:
    config = Config()
    sheet = GoogleSheetHandler(config)
    db = MongoDBHandler(config)
    df = sheet.get_new_orders()
    if df.empty:
        print("No orders to migrate")
        return
    records = df.to_dict('records')
    for r in records:
        r['confirmed'] = False
    db.collection.insert_many(records)
    print(f"Inserted {len(records)} orders")


if __name__ == '__main__':
    main()

