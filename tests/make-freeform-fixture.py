"""Add imported DrawingML path forms to a disposable PowerPoint-created seed deck."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import copy
import sys

a = 'http://schemas.openxmlformats.org/drawingml/2006/main'
p = 'http://schemas.openxmlformats.org/presentationml/2006/main'
def path(data): return '<a:path w="300" h="200">' + data + '</a:path>'
def move(x,y): return f'<a:moveTo><a:pt x="{x}" y="{y}"/></a:moveTo>'
def line(x,y): return f'<a:lnTo><a:pt x="{x}" y="{y}"/></a:lnTo>'
shapes = {
    'import-hole': path(move(0,0)+line(300,0)+line(300,200)+line(0,200)+'<a:close/>'+move(100,50)+line(100,150)+line(200,150)+line(200,50)+'<a:close/>'),
    'import-arc': path(move(300,100)+'<a:arcTo wR="150" hR="100" stAng="0" swAng="21600000"/><a:close/>'),
    'import-quad': path(move(0,100)+'<a:quadBezTo><a:pt x="150" y="-80"/><a:pt x="300" y="100"/></a:quadBezTo>'+line(300,200)+line(0,200)+'<a:close/>'),
}
source, destination = map(Path,sys.argv[1:3])
assert source.resolve() != destination.resolve()
with ZipFile(source) as src, ZipFile(destination,'w',ZIP_DEFLATED) as dst:
    for entry in src.infolist():
        data = src.read(entry.filename)
        if entry.filename == 'ppt/slides/slide1.xml':
            xml = E.fromstring(data)
            tree = xml.find(f'{{{p}}}cSld/{{{p}}}spTree')
            base = tree.findall(f'{{{p}}}sp')[-1]
            maxid = max(int(e.get('id')) for e in xml.iter(f'{{{p}}}cNvPr'))
            for index,(name,paths) in enumerate(shapes.items(),1):
                shape = copy.deepcopy(base)
                nv = shape.find(f'{{{p}}}nvSpPr/{{{p}}}cNvPr')
                nv.set('id',str(maxid+index)); nv.set('name',name)
                props = shape.find(f'{{{p}}}spPr')
                for old in list(props):
                    if old.tag in [f'{{{a}}}prstGeom',f'{{{a}}}custGeom']: props.remove(old)
                geometry = E.fromstring(f'<a:custGeom xmlns:a="{a}"><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="w" b="h"/><a:pathLst>{paths}</a:pathLst></a:custGeom>')
                props.insert(1,geometry); tree.append(shape)
            data = E.tostring(xml,encoding='utf-8',xml_declaration=True)
        dst.writestr(entry,data)
