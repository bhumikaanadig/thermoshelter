"""Seed the unchanged THERMOSHELTER materials into Firestore."""

from __future__ import annotations

import os

try:
    from .persistence import FirestoreRepository
except ImportError:
    from persistence import FirestoreRepository


def main() -> None:
    if os.getenv("THERMOSHELTER_FIRESTORE_ENABLED", "false").lower() != "true":
        raise SystemExit("Set THERMOSHELTER_FIRESTORE_ENABLED=true before seeding materials.")
    repository = FirestoreRepository()
    if not repository.enabled:
        raise SystemExit("Set FIREBASE_PROJECT_ID before seeding materials.")
    count = repository.seed_materials()
    print(f"Seeded {count} original THERMOSHELTER material records into Firestore.")


if __name__ == "__main__":
    main()
