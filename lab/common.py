import json, os, subprocess
import numpy as np
import soundfile as sf

T = json.load(open(os.path.join(os.path.dirname(__file__), 'texts.json')))
OUT = os.path.join(os.path.dirname(__file__), 'out')
os.makedirs(OUT, exist_ok=True)
IRISH = ['p245', 'p298', 'p364', 'p288', 'p295', 'p340', 'p266', 'p283']   # VCTK, CC BY 4.0


def save(name, parts, sr):
    gap = np.zeros(int(sr * 0.7), dtype=np.float32)
    a = np.concatenate([np.concatenate([np.asarray(p, dtype=np.float32).reshape(-1), gap]) for p in parts])
    wav = os.path.join(OUT, name + '.wav')
    sf.write(wav, a, sr)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-b:a', '96k',
                    os.path.join(OUT, name + '.mp3')], check=True)
    os.unlink(wav)
    print('ok', name, round(len(a) / sr, 1), 's', flush=True)


def irish_refs():
    from huggingface_hub import list_repo_files, hf_hub_download
    files = list_repo_files('kyutai/tts-voices')
    print('vctk sample:', [f for f in files if 'vctk' in f.lower()][:5], flush=True)
    refs = {}
    for sp in IRISH:
        c = sorted(f for f in files if 'vctk' in f.lower() and sp in f and f.endswith('.wav'))
        if c:
            refs[sp] = hf_hub_download('kyutai/tts-voices', c[0])
    print('irish refs:', list(refs), flush=True)
    return refs
