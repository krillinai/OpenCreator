"""Resolve the same local model for component installation and speech synthesis."""
import json
import os
from pathlib import Path
import sys

from huggingface_hub import hf_hub_download, snapshot_download
from huggingface_hub.errors import LocalEntryNotFoundError
from safetensors import safe_open


FILES = (
    "config.json", "tokenizer.json", "tokenizer_config.json", "model.safetensors",
    "audio_tokenizer/config.json", "audio_tokenizer/preprocessor_config.json",
    "audio_tokenizer/model.safetensors",
)


def valid_file(path):
    try:
        if path.suffix == ".safetensors":
            with safe_open(str(path), framework="np") as weights:
                return bool(weights.keys())
        with path.open(encoding="utf-8") as f:
            return bool(json.load(f))
    except Exception:
        return False


def resolve_model(install):
    model = os.environ.get("OPENCREATOR_OMNIVOICE_MODEL") or "k2-fsa/OmniVoice"
    directory = Path(model).expanduser()
    local = directory.exists() or directory.is_absolute() or model.startswith(".")
    if not local:
        try:
            directory = Path(snapshot_download(model, allow_patterns=list(FILES), local_files_only=True))
        except LocalEntryNotFoundError:
            directory = None
    missing = [f for f in FILES if directory is None or not valid_file(directory / f)]
    if missing and install:
        if local:
            raise ValueError("Invalid or missing model files: " + ", ".join(missing)
                             + ". Check OPENCREATOR_OMNIVOICE_MODEL or unset it to use the default download.")
        directory = Path(snapshot_download(model, allow_patterns=[*FILES, "chat_template.jinja"]))
        for name in FILES:
            if not valid_file(directory / name):
                hf_hub_download(model, name, revision=directory.name, force_download=True)
                if not valid_file(directory / name):
                    raise ValueError("OmniVoice model validation failed: " + name)
        missing = []
    return {"state": "missing" if missing else "ready",
            "path": str(directory.resolve()) if directory is not None else None}


if __name__ == "__main__":
    print(json.dumps(resolve_model(sys.argv[1] == "install")))
