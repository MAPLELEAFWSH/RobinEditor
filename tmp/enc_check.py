import os

d = r'E:\deepseek-harness\RobinEditor\src\lib\modules\yaku'
for f in sorted(os.listdir(d)):
    p = os.path.join(d, f)
    b = open(p, 'rb').read()
    b.decode('utf-8')
    bom = b[:3] == b'\xef\xbb\xbf'
    crlf = b'\r\n' in b
    print('%-14s %8dB  utf-8 ok  bom=%s  crlf=%s  lines=%d' % (f, len(b), bom, crlf, len(b.decode("utf-8").splitlines())))
