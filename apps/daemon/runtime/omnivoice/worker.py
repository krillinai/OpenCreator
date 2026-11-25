"""Private speech worker owned by the desktop daemon. stdout carries readiness only."""
import hmac
import io
import json
import os
from pathlib import Path
import select
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


def stop_with_parent():
    if os.name == "nt":
        # A blocking CRT read on stdin can deadlock native imports (NumPy/PyTorch).
        import _winapi
        import msvcrt
        handle = msvcrt.get_osfhandle(sys.stdin.fileno())
        while True:
            try:
                _winapi.PeekNamedPipe(handle, 0)
            except OSError:
                break
            time.sleep(0.5)
    else:
        select.select([sys.stdin], [], [])
    os._exit(0)


def generate_speech(model, options):
    import numpy as np

    # A short utterance can be entirely trimmed by OmniVoice's silence filter.
    for _ in range(3):
        try:
            samples = model.generate(**options)[0]
        except ValueError as exc:
            if "zero-size array to reduction operation maximum" not in str(exc):
                raise
            continue
        if samples.size and np.isfinite(samples).all() and np.abs(samples).max() > 0.0001:
            return samples
    raise ValueError("OmniVoice generated silent audio. Check the text and reference recording.")


class SpeechServer(HTTPServer):
    request_queue_size = 128


class SpeechHandler(BaseHTTPRequestHandler):
    timeout = 15

    def log_message(self, *args):
        pass

    def do_POST(self):
        if self.path != "/speech" or not hmac.compare_digest(
            self.headers.get("Authorization", ""), "Bearer " + self.server.token
        ):
            self.send_error(403)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 256 * 1024:
                self.send_error(400)
                return
            request = json.loads(self.rfile.read(size))
            # A canceled request may have been queued behind another video.
            if select.select([self.connection], [], [], 0)[0]:
                return
            reference = request.get("reference") or None
            if reference and (not Path(reference).is_absolute() or not Path(reference).is_file()):
                raise ValueError("Reference recording not found")
            options = dict(text=request["text"], language=request["language"], speed=request.get("speed", 1))
            if reference:
                stat = os.stat(reference)
                key = (reference, stat.st_size, stat.st_mtime_ns)
                if self.server.prompt_key != key:
                    self.server.prompt = self.server.model.create_voice_clone_prompt(ref_audio=reference)
                    self.server.prompt_key = key
                options["voice_clone_prompt"] = self.server.prompt
            samples = generate_speech(self.server.model, options)
            output = io.BytesIO()
            fmt = request.get("format", "wav")
            if fmt not in ("mp3", "wav"):
                raise ValueError("Unsupported audio format")
            self.server.soundfile.write(output, samples, 24000, format=fmt)
            payload = output.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav" if fmt == "wav" else "audio/mpeg")
        except Exception as exc:
            payload = ("OmniVoice: " + str(exc).splitlines()[0][:400]).encode("utf-8")
            self.send_response(422)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    threading.Thread(target=stop_with_parent, daemon=True).start()
    import torch
    import soundfile
    from omnivoice import OmniVoice

    device = "mps" if torch.backends.mps.is_available() else "cuda:0" if torch.cuda.is_available() else "cpu"
    model = OmniVoice.from_pretrained(
        os.environ.get("OPENCREATOR_OMNIVOICE_MODEL", "k2-fsa/OmniVoice"),
        device_map=device, dtype=torch.float32 if device == "cpu" else torch.float16,
        asr_model_name=os.environ.get("OPENCREATOR_OMNIVOICE_ASR_MODEL"),
    )
    with SpeechServer(("127.0.0.1", 0), SpeechHandler) as server:
        server.model = model
        server.token = os.environ.pop("OPENCREATOR_OMNIVOICE_TOKEN")
        server.soundfile = soundfile
        server.prompt_key = None
        print(f"OMNIVOICE_READY {server.server_port} {device}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
