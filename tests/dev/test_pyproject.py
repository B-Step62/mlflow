from pathlib import Path

from dev.pyproject import _PUBLIC_PYPI_INDEX, _sanitize_uv_lock_indexes


def test_sanitize_rewrites_only_disallowed_indexes(tmp_path: Path) -> None:
    lock = tmp_path / "uv.lock"
    lock.write_text(
        '[[package]]\n'
        'name = "torch"\n'
        'source = { registry = "https://download.pytorch.org/whl/cpu" }\n'
        '\n'
        '[[package]]\n'
        'name = "foo"\n'
        'source = { registry = "https://private-mirror.example.com/simple" }\n'
        '\n'
        '[[package]]\n'
        'name = "bar"\n'
        f'source = {{ registry = "{_PUBLIC_PYPI_INDEX}" }}\n'
    )

    _sanitize_uv_lock_indexes(lock)

    assert lock.read_text() == (
        '[[package]]\n'
        'name = "torch"\n'
        'source = { registry = "https://download.pytorch.org/whl/cpu" }\n'
        '\n'
        '[[package]]\n'
        'name = "foo"\n'
        f'source = {{ registry = "{_PUBLIC_PYPI_INDEX}" }}\n'
        '\n'
        '[[package]]\n'
        'name = "bar"\n'
        f'source = {{ registry = "{_PUBLIC_PYPI_INDEX}" }}\n'
    )


def test_sanitize_is_no_op_when_already_clean(tmp_path: Path) -> None:
    lock = tmp_path / "uv.lock"
    original = (
        '[[package]]\n'
        'name = "foo"\n'
        f'source = {{ registry = "{_PUBLIC_PYPI_INDEX}" }}\n'
    )
    lock.write_text(original)
    mtime_before = lock.stat().st_mtime_ns

    _sanitize_uv_lock_indexes(lock)

    assert lock.read_text() == original
    assert lock.stat().st_mtime_ns == mtime_before
