"""Extract deterministic review frames from PowerPoint's own video export."""
import argparse
import json
from pathlib import Path
import cv2
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('revision', nargs='?', default='01')
args = parser.parse_args()
root = Path(__file__).resolve().parent / '.build'
source = root / f'pangmen-native-{args.revision}.mp4'
target = root / f'review-{args.revision}'
target.mkdir(exist_ok=True)
cap = cv2.VideoCapture(str(source))
fps = cap.get(cv2.CAP_PROP_FPS)
count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
report = {'fps': fps, 'frames': count, 'seconds': count / fps, 'images': [], 'starts': []}
# PowerPoint writes variable timestamps. Find chapter boundaries from the static
# slide title, then use decoded presentation timestamps rather than average FPS.
templates = []
def title(frame):
    return cv2.resize(cv2.cvtColor(frame[40:106, 60:1060], cv2.COLOR_BGR2GRAY), (500, 33)).astype(np.float32)
for slide in range(1, 13):
    cap.set(cv2.CAP_PROP_POS_MSEC, ((slide - 1) * 6 + 2) * 1000)
    ok, frame = cap.read()
    if not ok: raise RuntimeError('Cannot read slide template')
    templates.append(title(frame))
cap.release()
cap = cv2.VideoCapture(str(source))
current, started, taken = 0, 0, set()
while True:
    ok, frame = cap.read()
    if not ok: break
    timestamp = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
    scores = [np.mean((title(frame) - template) ** 2) for template in templates]
    slide = int(np.argmin(scores)) + 1
    if slide != current:
        if slide != current + 1: raise RuntimeError(f'Unexpected chapter order {current} -> {slide}')
        current, started = slide, timestamp
        report['starts'].append({'slide': slide, 'timestamp': timestamp})
    elapsed = timestamp - started
    for local in [0.2, 0.8, 1.2, 2.0, 3.3, 4.8, 5.5]:
        if elapsed >= local and (slide, local) not in taken:
            file = target / f'slide-{slide:02d}-{local:.1f}.png'
            file.write_bytes(cv2.imencode('.png', frame)[1].tobytes())
            report['images'].append({'slide': slide, 'time': local, 'timestamp': timestamp, 'file': str(file)})
            taken.add((slide, local))
if len(taken) != 84: raise RuntimeError(f'Incomplete review frames: {len(taken)}')
cap.release()
(target / 'frames.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'fps': fps, 'frames': count, 'seconds': count / fps, 'directory': str(target)}, ensure_ascii=False))
