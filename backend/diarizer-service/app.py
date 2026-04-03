import os
import tempfile
import sys
import types
from typing import List, Dict, Any
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException, Header
from dotenv import load_dotenv

SERVICE_DIR = Path(__file__).resolve().parent
# Load diarizer-local env first, then backend env as fallback.
load_dotenv(SERVICE_DIR / ".env", override=False)
load_dotenv(SERVICE_DIR.parent / ".env", override=False)

# Backward-compat shim for pyannote calling hf_hub_download(use_auth_token=...)
import huggingface_hub as _hf
_orig_hf_hub_download = _hf.hf_hub_download


def _hf_hub_download_compat(*args, **kwargs):
    if "use_auth_token" in kwargs and "token" not in kwargs:
        kwargs["token"] = kwargs.pop("use_auth_token")
    return _orig_hf_hub_download(*args, **kwargs)


_hf.hf_hub_download = _hf_hub_download_compat

# Work around SpeechBrain optional k2 integration import on Windows.
def _register_stub(name: str, package: bool = False):
    if name in sys.modules:
        return
    mod = types.ModuleType(name)
    mod.__file__ = __file__
    if package:
        mod.__path__ = []  # type: ignore[attr-defined]
    sys.modules[name] = mod


_register_stub("speechbrain.integrations.k2_fsa")
_register_stub("speechbrain.integrations.nlp", package=True)
_register_stub("speechbrain.integrations.huggingface", package=True)
_register_stub("speechbrain.integrations.huggingface.wordemb")
_register_stub("speechbrain.pretrained")
_register_stub("speechbrain.wordemb")
_register_stub("speechbrain.k2_integration")
_register_stub("speechbrain.integrations.numba", package=True)
_register_stub("speechbrain.integrations.numba.transducer_loss")

from pyannote.audio import Pipeline


APP_TITLE = "transcription-tools diarizer"
MODEL_NAME = os.getenv("PYANNOTE_MODEL", "pyannote/speaker-diarization-3.1")
HF_TOKEN = os.getenv("HF_TOKEN", "").strip()
DIARIZER_API_KEY = os.getenv("DIARIZER_API_KEY", "").strip()

if not HF_TOKEN:
    raise RuntimeError("HF_TOKEN is required for pyannote model access")

pipeline = Pipeline.from_pretrained(MODEL_NAME, use_auth_token=HF_TOKEN)
app = FastAPI(title=APP_TITLE)


def _normalize_auth(authorization: str | None) -> str:
    if not authorization:
        return ""
    raw = authorization.strip()
    if raw.lower().startswith("bearer "):
        return raw[7:].strip()
    return raw


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "model": MODEL_NAME}


@app.post("/diarize")
async def diarize(
    file: UploadFile = File(...),
    max_speakers: int = 2,
    authorization: str | None = Header(default=None),
) -> Dict[str, List[Dict[str, Any]]]:
    if DIARIZER_API_KEY:
        provided = _normalize_auth(authorization)
        if not provided or provided != DIARIZER_API_KEY:
            raise HTTPException(status_code=401, detail="Unauthorized")

    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        temp_path = tmp.name
        content = await file.read()
        tmp.write(content)

    try:
        diarization = pipeline(temp_path, num_speakers=max(1, int(max_speakers)))
        segments: List[Dict[str, Any]] = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            segments.append(
                {
                    "speaker": str(speaker),
                    "start": float(turn.start),
                    "end": float(turn.end),
                }
            )
        return {"segments": segments}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass
