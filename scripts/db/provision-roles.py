#!/usr/bin/env python3
"""Provision dedicated development roles without resetting data or passwords."""

import base64
import hashlib
import hmac
import json
from pathlib import Path
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
ROLES = {
    "shanflow_app": "POSTGRES_APP_PASSWORD",
    "shanflow_migrator": "POSTGRES_MIGRATOR_PASSWORD",
}


def run(args: list[str], sql: str | None = None) -> str:
    result = subprocess.run(
        args, input=sql, cwd=ROOT, capture_output=True, text=True, check=False
    )
    if result.returncode:
        # Never print subprocess SQL, Compose environments, or server messages:
        # these can contain credentials, including SCRAM password verifiers.
        raise RuntimeError("Command failed; check Docker, bootstrap access and ownership preconditions in the SQL file")
    return result.stdout


def scram_verifier(password: str) -> str:
    # Printable ASCII avoids ambiguous SASLprep normalization. Generate local
    # passwords with secrets.token_hex(32) or a password manager.
    if len(password) < 16 or any(not 32 <= ord(char) <= 126 for char in password):
        raise RuntimeError("New role passwords must contain at least 16 printable ASCII characters")
    salt = secrets.token_bytes(16)
    iterations = 4096
    salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    client_key = hmac.digest(salted, b"Client Key", "sha256")
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.digest(salted, b"Server Key", "sha256")
    def encode(value: bytes) -> str:
        return base64.b64encode(value).decode("ascii")

    return f"SCRAM-SHA-256${iterations}:{encode(salt)}${encode(stored_key)}:{encode(server_key)}"


def main() -> None:
    config = json.loads(run(["docker", "compose", "config", "--format", "json"]))
    postgres = config["services"]["postgres"]["environment"]
    database = postgres["POSTGRES_DB"]
    bootstrap = postgres["POSTGRES_USER"]
    if database != "shanflow" or bootstrap in ROLES:
        raise RuntimeError("Expected database shanflow and a separate bootstrap role")

    psql = [
        "docker", "compose", "exec", "-T", "postgres", "psql", "-X", "-q",
        "-A", "-t", "-U", bootstrap, "-d", database,
        "--set", "ON_ERROR_STOP=1", "--set", f"database={database}",
    ]
    # The official image allows bootstrap access over the container's local
    # Unix socket. No bootstrap password is placed in process arguments.
    if run(psql, "SELECT rolsuper FROM pg_roles WHERE rolname = current_user;").strip() != "t":
        raise RuntimeError("Provisioning requires the bootstrap superuser")
    existing = set(run(psql, "SELECT rolname FROM pg_roles;").splitlines())
    env = dict(
        line.split("=", 1)
        for line in run(["docker", "compose", "config", "--environment"]).splitlines()
        if "=" in line
    )
    create_statements = []
    for role, variable in ROLES.items():
        if role in existing:
            continue  # Existing passwords are never changed or even required.
        password = env.get(variable, "")
        if not password:
            raise RuntimeError(f"Set {variable} in root .env for the new role")
        verifier = scram_verifier(password)
        create_statements.append(
            f"DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{role}') "
            f"THEN CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE "
            f"NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD '{verifier}'; END IF; END $$;"
        )

    permissions = (ROOT / "scripts/db/provision-roles.sql").read_text()
    # Suppress session statement/error logging before transmitting password
    # verifiers. Plaintext role passwords never leave this process.
    sql = """SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_duration = off;
SET log_min_duration_statement = -1;
SET log_min_duration_sample = -1;
SET log_transaction_sample_rate = 0;
BEGIN;
SELECT pg_advisory_xact_lock(73914, 13);
""" + "\n".join(create_statements) + "\n" + permissions + "\nCOMMIT;\n"
    run(psql, sql)
    # This session runs in autocommit for CREATE DATABASE, then the SQL file
    # uses explicit transactions for ACLs. It does not recreate existing shadow.
    shadow = (ROOT / "scripts/db/provision-shadow.sql").read_text()
    run(psql, shadow)
    print("Provisioned runtime/migration roles and development shadow database; existing passwords and data preserved.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        # RuntimeError messages are deliberately credential-free.
        print(str(error) if isinstance(error, RuntimeError) else "Provisioning failed; check Docker and configuration", file=sys.stderr)
        sys.exit(1)
