import importlib.util
from pathlib import Path

_path = Path(__file__).resolve().parents[2] / "data" / "hash_files.py"
_spec = importlib.util.spec_from_file_location("hash_files", _path)
hash_files = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hash_files)


def test_readme_hash_table_is_current():
    readme = hash_files.README.read_text(encoding="utf-8")
    assert hash_files.render(readme) == readme, "run: python data/hash_files.py --write"
