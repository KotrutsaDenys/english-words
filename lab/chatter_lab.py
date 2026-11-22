import time, traceback
from common import T, save, irish_refs

refs = {}
try:
    refs = irish_refs()
except Exception:
    traceback.print_exc()

def run(prefix, model, prompts):
    for name, ref in prompts.items():
        try:
            t0 = time.time()
            kw = {'audio_prompt_path': ref} if ref else {}
            save(prefix + name, [model.generate(t, **kw).squeeze(0).numpy() for t in T], model.sr)
            print('  time', round(time.time() - t0, 1), flush=True)
        except Exception:
            print('FAIL', prefix + name); traceback.print_exc()

pick = {('irish-' + k): v for k, v in refs.items() if k in ('p245', 'p288', 'p340', 'p298')}
try:
    from chatterbox.tts_turbo import ChatterboxTurboTTS
    run('chatterturbo-', ChatterboxTurboTTS.from_pretrained(device='cpu'), dict({'default': None}, **pick))
except Exception:
    traceback.print_exc()
try:
    from chatterbox.tts import ChatterboxTTS
    run('chatterbox-', ChatterboxTTS.from_pretrained(device='cpu'), dict({'default': None}, **pick))
except Exception:
    traceback.print_exc()
