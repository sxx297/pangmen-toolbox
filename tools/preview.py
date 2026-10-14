"""Loopback-only development preview. Does not serve source, builds or private keys."""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse,unquote
ROOT=Path(__file__).resolve().parents[1]
MAP={'shapes':ROOT/'features/shapes/prototype','animations':ROOT/'features/animations/preview','export':ROOT/'features/export/ui','shared':ROOT/'shared/ui','brand':ROOT/'features/shapes/host/assets'}
class Preview(SimpleHTTPRequestHandler):
    def translate_path(self,path):
        pieces=unquote(urlparse(path).path).strip('/').split('/')
        base=MAP.get(pieces[0],ROOT/'preview')
        relative='/'.join(pieces[1:]) if pieces[0] in MAP else '/'.join(pieces) or 'index.html'
        target=(base/relative).resolve()
        if not target.is_relative_to(base.resolve()) or target.suffix.lower() not in ['.html','.css','.js','.png','.svg','.ico']:return str(ROOT/'preview/not-found')
        return str(target)
    def do_GET(self):
        if urlparse(self.path).path=='/export/pdf-export.css':
            data=((ROOT/'features/export/ui/pdf-export.css').read_text(encoding='utf-8-sig')+'\n'+(ROOT/'shared/ui/toolbox-theme.css').read_text(encoding='utf-8')).encode('utf-8')
            self.send_response(200);self.send_header('Content-Type','text/css; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
        super().do_GET()
    def end_headers(self):
        self.send_header('Cache-Control','no-store');super().end_headers()
if __name__=='__main__':
    print('http://127.0.0.1:8780',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8780),Preview).serve_forever()
