import argparse
import json
from pathlib import Path

from .pipeline import run

parser = argparse.ArgumentParser(description="Collect up to 50 NEW public configs; never probe endpoints")
parser.add_argument("--root", type=Path, default=Path.cwd())
parser.add_argument("--limit", type=int, default=50)
parser.add_argument("--service", action="store_true", help="Collect through the deployed authoritative service and archive its public results")
args = parser.parse_args()
try:
    if args.service:
        from .service import run_service
        status = run_service(args.root, args.limit)
    else:
        status = run(args.root, args.limit)
except (ValueError, OSError, KeyError, TypeError) as error:
    parser.exit(2, f"Collector stopped without a commit: {error}\n")
print(json.dumps({key: status[key] for key in ("state", "added", "totalUnique", "duplicateCount", "invalidCount")}, indent=2))
raise SystemExit(1 if status["state"] == "failed" else 0)
