import time, traceback
from common import T, save, irish_refs
from pocket_tts import TTSModel

m = TTSModel.load_model()
voices = {p: p for p in ['alba', 'jane', 'mary', 'eve', 'anna', 'vera', 'george', 'stuart_bell',
                         'peter_yearsley', 'charles', 'paul', 'michael']}
try:
    for sp, path in irish_refs().items():
        voices['irish-' + sp] = path
except Exception:
    traceback.print_exc()
for name, v in voices.items():
    try:
        t0 = time.time()
        st = m.get_state_for_audio_prompt(v)
        save('pocket-' + name, [m.generate_audio(st, t).numpy() for t in T], m.sample_rate)
        print('  time', round(time.time() - t0, 1), flush=True)
    except Exception:
        print('FAIL', name); traceback.print_exc()
