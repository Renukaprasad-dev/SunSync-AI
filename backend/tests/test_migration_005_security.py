from pathlib import Path
import re
import pytest

APP_TABLES = [
    "sites",
    "machines",
    "tariffs",
    "solar_profiles",
    "base_loads",
    "optimization_runs",
    "scenarios",
]

PERMISSIVE_POLICIES = [
    "Allow anon read demo sites",
    "Allow anon read demo machines",
    "Allow anon read demo tariffs",
    "Allow anon read demo solar",
    "Allow anon read demo base_loads",
    "Allow anon read demo scenarios",
]


@pytest.fixture
def repo_root():
    return Path(__file__).resolve().parent.parent.parent


def test_migration_005_drops_all_permissive_anon_policies(repo_root):
    mig_005 = repo_root / "supabase" / "migrations" / "005_restrict_anonymous_table_access.sql"
    assert mig_005.exists(), f"Missing migration file: {mig_005}"

    sql = mig_005.read_text(encoding="utf-8")

    # Assert all 6 permissive anonymous policies are dropped with IF EXISTS
    for policy in PERMISSIVE_POLICIES:
        pattern = rf'DROP\s+POLICY\s+IF\s+EXISTS\s+"{re.escape(policy)}"'
        assert re.search(pattern, sql, re.IGNORECASE), f"Migration 005 must drop policy: {policy}"


def test_migration_005_revokes_anon_and_public_table_privileges(repo_root):
    mig_005 = repo_root / "supabase" / "migrations" / "005_restrict_anonymous_table_access.sql"
    sql = mig_005.read_text(encoding="utf-8")

    # Assert REVOKE ALL ON TABLE <tbl> FROM anon, public for each application table
    for tbl in APP_TABLES:
        pattern = rf"REVOKE\s+ALL\s+ON\s+TABLE\s+public\.{tbl}\s+FROM\s+anon,\s*public;"
        assert re.search(pattern, sql, re.IGNORECASE), (
            f"Migration 005 must revoke ALL on public.{tbl} from anon, public"
        )


def test_migration_005_narrows_service_role_table_and_sequence_privileges(repo_root):
    mig_005 = repo_root / "supabase" / "migrations" / "005_restrict_anonymous_table_access.sql"
    sql = mig_005.read_text(encoding="utf-8")

    # Assert all existing service_role table privileges are cleared before granting
    # the narrowed set (SELECT, INSERT, UPDATE, DELETE) on every application table.
    for tbl in APP_TABLES:
        revoke_pattern = rf"REVOKE\s+ALL\s+ON\s+TABLE\s+public\.{tbl}\s+FROM\s+service_role;"
        assert re.search(revoke_pattern, sql, re.IGNORECASE), (
            f"Migration 005 must revoke ALL on public.{tbl} from service_role"
        )

        pattern = rf"GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+public\.{tbl}\s+TO\s+service_role;"
        grant_match = re.search(pattern, sql, re.IGNORECASE)
        assert grant_match, (
            f"Migration 005 must grant narrowed SELECT, INSERT, UPDATE, DELETE on public.{tbl} to service_role"
        )
        revoke_match = re.search(revoke_pattern, sql, re.IGNORECASE)
        assert revoke_match.start() < grant_match.start(), (
            f"Migration 005 must revoke existing service_role privileges before granting on public.{tbl}"
        )

    # Assert sequences are revoked from anon, public
    assert re.search(
        r"REVOKE\s+ALL\s+ON\s+ALL\s+SEQUENCES\s+IN\s+SCHEMA\s+public\s+FROM\s+anon,\s*public;",
        sql,
        re.IGNORECASE,
    ), "Migration 005 must revoke sequence privileges from anon, public"

    # Do not grant service_role blanket privileges on all public sequences.
    assert not re.search(
        r"GRANT\s+ALL\s+ON\s+ALL\s+SEQUENCES\s+IN\s+SCHEMA\s+public\s+TO\s+service_role;",
        sql,
        re.IGNORECASE,
    ), "Migration 005 must not grant ALL on every public sequence to service_role"

def test_migration_005_does_not_modify_historical_migrations(repo_root):
    migrations_dir = repo_root / "supabase" / "migrations"

    # Historical files must exist
    mig_001 = migrations_dir / "001_initial_schema.sql"
    mig_002 = migrations_dir / "002_atomic_config_rpc.sql"
    mig_003 = migrations_dir / "003_visitor_sandbox_ownership.sql"
    mig_004 = migrations_dir / "004_site_limits_and_session_cleanup.sql"

    assert mig_001.exists()
    assert mig_002.exists()
    assert mig_003.exists()
    assert mig_004.exists()

    # Historical migrations must maintain their canonical landmark definitions
    sql_001 = mig_001.read_text(encoding="utf-8")
    assert "CREATE TABLE IF NOT EXISTS sites" in sql_001
    assert "CREATE TABLE IF NOT EXISTS machines" in sql_001

    sql_002 = mig_002.read_text(encoding="utf-8")
    assert "save_site_configuration" in sql_002
    assert "save_site_configuration_atomic" in sql_002
    assert "save_site_config_atomic" in sql_002

    sql_003 = mig_003.read_text(encoding="utf-8")
    assert "owner_session_id" in sql_003

    sql_004 = mig_004.read_text(encoding="utf-8")
    assert "create_owned_site_with_limit" in sql_004


def test_verify_005_script_structure_and_coverage(repo_root):
    verify_file = repo_root / "supabase" / "verify_005.sql"
    assert verify_file.exists(), "verify_005.sql must exist"

    sql = verify_file.read_text(encoding="utf-8")
    code_without_comments = re.sub(r"--.*", "", sql)

    # Verification must check RLS on tables
    assert "rowsecurity" in sql, "verify_005.sql must check table rowsecurity"

    # Verification must check absence of both anon AND public policies
    assert re.search(r"'anon'\s*=\s*ANY\(roles\)\s+OR\s+'public'\s*=\s*ANY\(roles\)", sql), (
        "verify_005.sql must inspect policies for both anon and public roles"
    )

    # Verification must check anon has no table privileges (which checks effective access including PUBLIC)
    assert "has_table_privilege('anon'" in sql, (
        "verify_005.sql must check has_table_privilege for anon"
    )

    # Verification must check PUBLIC retains no table privileges via catalog ACL (aclexplode where grantee = 0)
    assert "aclexplode" in sql, "verify_005.sql must check catalog ACL via aclexplode"
    assert re.search(r"a\.grantee\s*=\s*0", sql), (
        "verify_005.sql must check a.grantee = 0 for PUBLIC privileges"
    )

    # Verification must check sequence privileges
    assert "has_sequence_privilege('anon'" in sql, (
        "verify_005.sql must check has_sequence_privilege for anon"
    )

    # Verification must check service_role retains table privileges
    assert "has_table_privilege('service_role'" in sql, (
        "verify_005.sql must check has_table_privilege for service_role"
    )
    # Verification must reject every table privilege outside the intended set.
    for privilege in ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]:
        assert privilege in sql, f"verify_005.sql must check service_role lacks {privilege}"
    assert "v_forbidden_service_privs" in sql, (
        "verify_005.sql must check service_role lacks all forbidden table privileges"
    )
    assert re.search(
        r"FOREACH\s+v_priv\s+IN\s+ARRAY\s+v_forbidden_service_privs\s+LOOP\s+"
        r"IF\s+has_table_privilege\('service_role',\s*'public\.'\s*\|\|\s*v_tbl,\s*v_priv\)\s+THEN",
        code_without_comments,
        re.IGNORECASE,
    ), "verify_005.sql must fail when service_role has a forbidden table privilege"

    # Requirement 1: Verification must NEVER call has_function_privilege('PUBLIC', ...)
    assert not re.search(r"has_function_privilege\(\s*['\"]PUBLIC['\"]", code_without_comments, re.IGNORECASE), (
        "verify_005.sql must not call has_function_privilege('PUBLIC', ...) as PUBLIC is not a pg_roles entry"
    )

    # Requirement 2 & 3: Verification must check service_role permitted and anon denied (effective EXECUTE via PUBLIC)
    for func_sig in [
        "public.save_site_configuration(uuid, jsonb, jsonb, jsonb, integer)",
        "public.save_site_configuration_atomic(uuid, jsonb, jsonb, jsonb, integer)",
        "public.save_site_config_atomic(uuid, jsonb, jsonb, jsonb, integer)",
        "public.cleanup_expired_visitor_sandboxes(interval)",
        "public.create_owned_site_with_limit(jsonb, varchar, integer)",
    ]:
        assert f"has_function_privilege('service_role', '{func_sig}', 'EXECUTE')" in sql, (
            f"verify_005.sql must check service_role EXECUTE for {func_sig}"
        )
        assert f"has_function_privilege('anon', '{func_sig}', 'EXECUTE')" in sql, (
            f"verify_005.sql must check anon rejection (and PUBLIC-inherited access) for {func_sig}"
        )

    # Must be read-only (no INSERT, UPDATE, DELETE, DROP, ALTER outside comments/messages)
    code_without_literals = re.sub(r"'.*?'", "", code_without_comments)
    assert not re.search(r"\bINSERT\s+INTO\b", code_without_literals, re.IGNORECASE)
    assert not re.search(r"\bUPDATE\s+public\.\b", code_without_literals, re.IGNORECASE)
    assert not re.search(r"\bDELETE\s+FROM\s+public\.\b", code_without_literals, re.IGNORECASE)
    assert not re.search(r"\bDROP\s+TABLE\b", code_without_literals, re.IGNORECASE)