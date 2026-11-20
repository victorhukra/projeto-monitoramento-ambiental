"""Lê as configurações do ambiente e, quando presente, do arquivo backend/.env."""
import os
from dataclasses import dataclass
from pathlib import Path


def _load_local_env():
    # Variáveis já definidas no ambiente têm prioridade sobre o arquivo local.
    env_file = Path(__file__).resolve().parents[1] / '.env'
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def _env_value(key):
    return os.getenv(key, '').strip() or None


@dataclass(frozen=True)
class Settings:
    model_path: Path | None = None
    manifest_path: Path | None = None
    supabase_url: str | None = None
    supabase_key: str | None = None
    frontend_origin: str = 'http://localhost:5173'

    @classmethod
    def from_env(cls):
        _load_local_env()
        model_path = _env_value('MODEL_PATH')
        manifest_path = _env_value('MODEL_MANIFEST_PATH')
        return cls(
            model_path=Path(model_path) if model_path else None,
            manifest_path=Path(manifest_path) if manifest_path else None,
            supabase_url=(_env_value('SUPABASE_URL') or '').rstrip('/') or None,
            supabase_key=_env_value('SUPABASE_SERVICE_ROLE_KEY'),
            frontend_origin=_env_value('FRONTEND_ORIGIN') or 'http://localhost:5173',
        )
