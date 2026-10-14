from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]
def build():
    tokens=json.loads((ROOT/'shared/ui/tokens.json').read_text(encoding='utf-8'))
    css='/* Generated from shared/ui/tokens.json. */\n:root{'+''.join('--pm-'+k+':'+(str(v)+'px' if isinstance(v,int) else '"'+v+'"' if k=='font' else v)+';' for k,v in tokens.items())+'}\n'
    css+=(ROOT/'shared/ui/components.css').read_text(encoding='utf-8')
    (ROOT/'shared/ui/toolbox-theme.css').write_text(css,encoding='utf-8')
    def color(key):
        h=tokens[key].lstrip('#');return 'Color.FromArgb('+','.join(str(int(h[i:i+2],16)) for i in (0,2,4))+')'
    cs='// Generated from shared/ui/tokens.json.\nusing System.Drawing;\nnamespace PangmenToolbox.AddIn { internal static class ToolboxTheme {\n'
    for name,key in [('Paper','paper'),('Surface','surface'),('Ink','ink'),('Muted','muted'),('Line','line'),('Accent','accent'),('AccentSoft','accent-soft')]: cs+='internal static readonly Color '+name+' = '+color(key)+';\n'
    for name,key in [('TitleSize','title'),('SectionSize','section'),('BodySize','body'),('CaptionSize','caption'),('FloatingWidth','floating-width'),('FloatingHeight','floating-height')]:cs+='internal const int '+name+' = '+str(tokens[key])+';\n'
    cs+='internal static Font Font(float px, FontStyle style=FontStyle.Regular) { return new Font("'+tokens['font']+'",px,style,GraphicsUnit.Pixel); }\n}}\n'
    (ROOT/'host/ToolboxTheme.cs').write_text(cs,encoding='utf-8-sig')
if __name__=='__main__':build()
