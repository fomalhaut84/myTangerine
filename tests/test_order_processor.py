import os
import sys
import types
import math

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

# Provide a minimal dotenv stub if python-dotenv is missing
if 'dotenv' not in sys.modules:
    sys.modules['dotenv'] = types.SimpleNamespace(load_dotenv=lambda: None)

# Provide a minimal pandas stub if pandas is not installed
try:
    import pandas as pd  # noqa: F401
except ModuleNotFoundError:  # pragma: no cover - only for test env
    pd_stub = types.SimpleNamespace()

    class Series(dict):
        pass

    def isna(x):
        return x is None or (isinstance(x, float) and math.isnan(x))

    def notna(x):
        return not isna(x)

    pd_stub.Series = Series
    pd_stub.isna = isna
    pd_stub.notna = notna

    sys.modules['pandas'] = pd_stub

from handlers.order_processor import OrderProcessor

import pandas as pd

import pytest

@pytest.mark.parametrize(
    "input_phone,expected",
    [
        ("", ""),
        ("1098765432", "010-9876-5432"),
        ("01012345678", "010-1234-5678"),
        ("010-1234-5678", "010-1234-5678"),
        ("0201234567", "0201234567"),
        ("hello", "hello"),
    ],
)
def test_format_phone_number(input_phone, expected):
    assert OrderProcessor.format_phone_number(input_phone) == expected

@pytest.mark.parametrize(
    "five,ten,expected",
    [
        ("2", "", 2),
        ("3\ubc15\uc2a4", "", 3),
        (4, "", 4),
        ("", "5", 5),
        ("", "6\ubc15\uc2a4", 6),
        ("", 7, 7),
        ("", "", 1),
        (None, None, 1),
        (None, 8, 8),
    ],
)
def test_get_quantity(five, ten, expected):
    row = pd.Series({"5kg \uc218\ub7c9": five, "10kg \uc218\ub7c9": ten})
    assert OrderProcessor.get_quantity(row) == expected
