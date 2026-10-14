"""Create intrinsic-size thumbnails; GitHub's GIF player overrides HTML widths."""
import argparse
from pathlib import Path
from PIL import Image, ImageSequence

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('gallery', type=Path)
args = parser.parse_args()


def thumbnail(source, folder, size):
    target = source.parent / folder / source.name
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        if image.format == 'GIF':
            frames, durations = [], []
            for frame in ImageSequence.Iterator(image):
                resized = frame.convert('RGB').resize(size, Image.Resampling.LANCZOS)
                resized.info.clear()  # Source palette transparency is invalid after RGB resampling.
                frames.append(resized)
                durations.append(frame.info.get('duration', 50))
            frames[0].save(target, save_all=True, append_images=frames[1:],
                           duration=durations, loop=image.info.get('loop', 0),
                           disposal=2, optimize=False)
            with Image.open(target) as check:
                assert check.size == size and check.n_frames > 1, target
                assert sum(f.info.get('duration', 0) for f in ImageSequence.Iterator(check)) == sum(durations), target
        else:
            image.convert('RGB').resize(size, Image.Resampling.LANCZOS).save(target)


sources = sorted(p for p in args.gallery.iterdir() if p.suffix in ('.gif', '.png'))
for source in sources:
    thumbnail(source, 'thumbs', (200, 138))
for name in ('anvil.gif', 'number-roll.gif', 'material-spectrumFrame.png', 'material-glass.png'):
    thumbnail(args.gallery / name, 'featured', (160, 110))
print(f'Created {len(sources)} gallery thumbnails and 4 equal-size featured thumbnails')
