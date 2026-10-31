import json
import re
from pathlib import Path

def test_migration_and_seed():
    root = Path(__file__).resolve().parent.parent.parent
    migration_file = root / "supabase" / "migrations" / "001_initial_schema.sql"
    seed_file = root / "supabase" / "seed.sql"

    assert migration_file.exists(), f"{migration_file} does not exist"
    assert seed_file.exists(), f"{seed_file} does not exist"

    migration_sql = migration_file.read_text(encoding="utf-8")
    seed_sql = seed_file.read_text(encoding="utf-8")

    for tbl in ["sites", "machines", "tariffs", "solar_profiles", "base_loads", "optimization_runs", "scenarios"]:
        assert f"CREATE TABLE IF NOT EXISTS {tbl}" in migration_sql, f"Missing table {tbl}"
        assert f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY;" in migration_sql

    # Validate 96-interval JSON arrays in seed
    arrays = re.findall(r"'(\[.*?\])'::jsonb", seed_sql, re.DOTALL)
    assert len(arrays) == 5, f"Expected 5 JSON arrays, found {len(arrays)}"
    for idx, arr_str in enumerate(arrays):
        data = json.loads(arr_str)
        assert len(data) == 96, f"Array {idx} has length {len(data)}, expected 96"
        for val in data:
            assert isinstance(val, (int, float))

    print("Phase 1 schema and seed verified successfully! 96-slot grid validated.")

if __name__ == "__main__":
    test_migration_and_seed()
