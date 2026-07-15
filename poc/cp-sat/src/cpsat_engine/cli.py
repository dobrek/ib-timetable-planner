"""File-transport CLI (Phase 4): ``cpsat --input dump.json --output result.json --mode …``.

The only throwaway part of the POC — a thin wrapper over ``solve``. Kept separate so the package
stays transport-agnostic: a future service wraps ``solve`` in HTTP without touching this file.
"""

import sys


def main() -> int:
    """Console entry point. Implemented in Phase 4."""
    print("cpsat CLI is not implemented yet (arrives in Phase 4).", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
