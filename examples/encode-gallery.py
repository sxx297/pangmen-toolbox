"""Encode native PowerPoint videos. Requires Pillow and imageio-ffmpeg.
python examples/encode-gallery.py <working-output> <media-output>
"""
from pathlib import Path
import argparse, json, subprocess, zipfile
import imageio_ffmpeg
from PIL import Image, ImageChops, ImageStat

parser=argparse.ArgumentParser()
parser.add_argument('working',type=Path)
parser.add_argument('media',type=Path)
parser.add_argument('--resume',action='store_true')
args=parser.parse_args()
args.media.mkdir(parents=True,exist_ok=True)
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
inventory=json.loads((args.working/'inventory.json').read_text(encoding='utf-8'))
results=[]
for item in inventory['animations']:
    name=item['id'];video=args.working/(name+'.mp4');gif=args.media/(name+'.gif')
    if not video.exists():raise FileNotFoundError(video)
    if not(args.resume and gif.exists()):
        poster=args.working/(name+'-poster.png')
        seek='0.10' if item['category']=='exit' else '4.30'
        subprocess.run([ffmpeg,'-v','error','-y','-ss',seek,'-i',str(video),'-frames:v','1',str(poster)],check=True)
        if item['category']=='loop':
            inputs=['-ss','0.45','-t',str(item['duration']),'-i',str(video)]
            prefix='[0:v]setpts=PTS-STARTPTS'
        else:
            inputs=['-loop','1','-t','0.5','-i',str(poster),'-t','4.5','-i',str(video)]
            prefix='[0:v]fps=20,setpts=PTS-STARTPTS[a];[1:v]fps=20,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0'
        filters=prefix+',fps=20,scale=400:275:flags=lanczos,split[c][d];[c]palettegen=max_colors=192:stats_mode=diff[p];[d][p]paletteuse=dither=sierra2_4a'
        subprocess.run([ffmpeg,'-v','error','-y',*inputs,'-filter_complex',filters,'-loop','0',str(gif)],check=True)
    with Image.open(gif) as im:
        first=im.convert('RGB');count=im.n_frames;variation=0;duration=0
        for i in range(count):
            im.seek(i);duration+=im.info.get('duration',0)
            variation=max(variation,sum(ImageStat.Stat(ImageChops.difference(first,im.convert('RGB'))).mean))
        assert count>1 and variation>0.05,(name,count,variation)
    with zipfile.ZipFile(args.working/(name+'.pptx')) as z:
        slide=z.read('ppt/slides/slide1.xml').decode('utf-8')
        assert '<p:timing>' in slide,name
        assert '思源黑体 CN Bold' in slide,name
    results.append(dict(id=name,frames=count,duration_ms=duration,bytes=gif.stat().st_size,variation=round(variation,2)))
    print(f"Encoded {name}: {count} frames, {gif.stat().st_size} bytes",flush=True)
(args.working/'gif-validation.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(f"Validated {len(results)} GIFs, {sum(r['bytes'] for r in results)/1024/1024:.2f} MiB")
