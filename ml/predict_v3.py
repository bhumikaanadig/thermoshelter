"""Inference helper for the V3 THERMOSHELTER surrogate."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

try:
    from .predict import predict_shelter as _predict_shelter
except ImportError:  # Supports `python ml/predict_v3.py` from the project root.
    from predict import predict_shelter as _predict_shelter


DEFAULT_MODEL = Path(__file__).resolve().parent / "artifacts" / "v3" / "thermal_surrogate_v3.joblib"


def predict_shelter(input_data: dict[str, Any], model_path: str | Path | None = None) -> dict:
    """Return the six V3 summary predictions and any out-of-range warnings."""
    return _predict_shelter(input_data, model_path or DEFAULT_MODEL)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="JSON file containing one shelter configuration")
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL, help="Saved V3 .joblib model bundle")
    parser.add_argument("--output", type=Path, help="Optional path for the JSON prediction result")
    args = parser.parse_args()
    try:
        input_data = json.loads(args.input.read_text(encoding="utf-8"))
        result = predict_shelter(input_data, args.model)
    except (json.JSONDecodeError, OSError, ValueError) as error:
        parser.error(str(error))
    output = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")
        print(f"Wrote V3 prediction to {args.output}")
    else:
        print(output)


if __name__ == "__main__":
    main()
